import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { app } from "../../app";
import { prisma } from "../../database/prisma";
import { hashPassword, tokenDigest } from "../auth/password";
import { configureRateLimitStore, InMemoryRateLimitStore } from "../auth/rate-limit";
import { createSession, SESSION_COOKIE } from "../auth/session";
import { GMAIL_CALLBACK_PATH, GMAIL_INTEGRATION_ID } from "./gmail-config";
import { googleGmailClient } from "./google-client";
import { codeChallenge, stateDigest } from "./gmail-crypto";

const testSender = "stock-approval@example.test";

const path = "/integrations/google-gmail";
const ownerToken = "mock-private-refresh";
const accessToken = "mock-private-access";
const authorizationCode = "mock-private-code";
const password = "Correct-Horse-88!Battery";
const clientEmail = `gmail-test-${randomUUID()}@example.test`;

function pauseRemote() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, pause: () => { enter(); return released; } };
}

test("owner connects Gmail, approval uses owner mail, and disconnect revokes credentials", async t => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(decodeURIComponent(target.pathname), "/stockerp_test");
  const [database] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`.catch(() => {
    throw new Error("Could not verify a connection to stockerp_test.");
  });
  assert.equal(database.name, "stockerp_test");
  assert.equal(await prisma.emailIntegrationCredential.count({ where: { id: GMAIL_INTEGRATION_ID } }), 0,
    "Use an isolated test database without a Gmail connection.");
  const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const namespace = randomUUID();
  configureRateLimitStore(new InMemoryRateLimitStore());
  const userIds: string[] = [];
  const requestIds = new Set<string>();
  let server: Server | undefined;
  let registrationId: string | undefined;

  t.after(async () => {
    try {
      if (server?.listening) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); });
      await prisma.emailIntegrationCredential.deleteMany({ where: { id: GMAIL_INTEGRATION_ID } });
      if (requestIds.size) await prisma.auditEvent.deleteMany({ where: { requestId: { in: [...requestIds] } } });
      if (registrationId) await prisma.registrationRequest.deleteMany({ where: { id: registrationId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally { await prisma.$disconnect(); }
  });

  async function fixture(label: string, verified: boolean) {
    const user = await prisma.user.create({ data: {
      email: `gmail-${label}-${namespace}@example.test`, displayName: label, passwordHash: await hashPassword(password),
      emailVerifiedAt: verified ? new Date() : null, ownerApprovedAt: new Date(),
    } });
    userIds.push(user.id);
    return user;
  }

  async function sessionFor(userId: string) {
    const { token, session } = await createSession(userId);
    return { id: session.id, cookie: `${SESSION_COOKIE}=${token}` };
  }

  const owner = await fixture("owner", true);
  const regularUser = await fixture("regular", true);
  const unverified = await fixture("unverified", false);
  const ownerSession = await sessionFor(owner.id);
  const otherSession = await sessionFor(owner.id);
  const regularSession = await sessionFor(regularUser.id);
  const unverifiedSession = await sessionFor(unverified.id);

  const values = {
    EMAIL_DELIVERY_PROVIDER: "google-gmail", REGISTRATION_OWNER_EMAIL: testSender, SOFTWARE_OWNER_USER_ID: owner.id,
    GOOGLE_OAUTH_CLIENT_ID: "mock-id", GOOGLE_OAUTH_CLIENT_SECRET: "mock-private-client-secret", GOOGLE_GMAIL_SENDER_EMAIL: testSender,
    GOOGLE_OAUTH_REDIRECT_URI: `http://localhost:4000${GMAIL_CALLBACK_PATH}`,
    FRONTEND_ORIGIN: origin, GOOGLE_OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    OWNER_REGISTRATION_OTP_HMAC_SECRET: randomBytes(32).toString("hex"),
  };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, values);

  let pkceChallenge: string | null = null;
  let exchangeFails = false;
  let revokeFails = true;
  let exchangeGate: ReturnType<typeof pauseRemote> | undefined;
  let revokeGate: ReturnType<typeof pauseRemote> | undefined;
  const mail: string[] = [];
  const authorize = t.mock.method(googleGmailClient, "authorize", async (code: string, verifier: string) => {
    assert.equal(code, authorizationCode);
    assert.equal(codeChallenge(verifier), pkceChallenge);
    await exchangeGate?.pause();
    if (exchangeFails) throw new Error(`Remote response contains ${ownerToken}`);
    return ownerToken;
  });
  const refresh = t.mock.method(googleGmailClient, "refresh", async (token: string) => {
    assert.equal(token, ownerToken);
    return { accessToken };
  });
  const send = t.mock.method(googleGmailClient, "send", async (token: string, raw: string) => {
    assert.equal(token, accessToken);
    mail.push(Buffer.from(raw, "base64url").toString());
  });
  const revoke = t.mock.method(googleGmailClient, "revoke", async (token: string) => {
    assert.equal(token, ownerToken);
    await revokeGate?.pause();
    if (revokeFails) throw new Error(`Remote revocation error with ${ownerToken}`);
  });
  const stdout = t.mock.method(process.stdout, "write", process.stdout.write.bind(process.stdout));
  const stderr = t.mock.method(process.stderr, "write", process.stderr.write.bind(process.stderr));

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()).once("error", reject);
  });
  const address = server!.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  async function request(endpoint: string, cookie?: string, body?: unknown, requestOrigin: string | null = origin) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${endpoint}`, {
      signal: AbortSignal.timeout(8_000), redirect: "manual", method: body === undefined ? "GET" : "POST",
      headers: { ...(requestOrigin === null ? {} : { Origin: requestOrigin }), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const location = response.headers.get("location") ?? "";
    for (const secret of [ownerToken, accessToken, authorizationCode, values.GOOGLE_OAUTH_CLIENT_SECRET, values.GOOGLE_OAUTH_ENCRYPTION_KEY]) {
      assert.ok(!text.includes(secret) && !location.includes(secret));
    }
    const json = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : undefined;
    if (json?.meta?.requestId) requestIds.add(json.meta.requestId);
    return { status: response.status, headers: response.headers, location, json };
  }

  async function begin() {
    const response = await request(`${path}/connect`, ownerSession.cookie, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.location, "");
    const redirect = new URL(response.json.data.authorizationUrl);
    assert.equal(redirect.origin, "https://accounts.google.com");
    assert.equal(redirect.searchParams.get("redirect_uri"), values.GOOGLE_OAUTH_REDIRECT_URI);
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
    pkceChallenge = redirect.searchParams.get("code_challenge");
    const state = redirect.searchParams.get("state");
    assert.ok(state);
    const row = await prisma.gmailOAuthState.findUniqueOrThrow({ where: { sessionId: ownerSession.id } });
    assert.equal(row.digest, stateDigest(state));
    return state;
  }

  async function callback(state: string, params = `code=${authorizationCode}`, cookie = ownerSession.cookie) {
    const result = await request(`${path}/callback?state=${state}&${params}`, cookie);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("referrer-policy"), "no-referrer");
    assert.ok(!result.location.includes(state));
    return new URL(result.location).searchParams.get("result");
  }

  for (const endpoint of ["status", "connect", "callback", "disconnect"]) {
    const body = endpoint === "connect" || endpoint === "disconnect" ? {} : undefined;
    assert.equal((await request(`${path}/${endpoint}`, undefined, body)).status, 401);
    assert.equal((await request(`${path}/${endpoint}`, regularSession.cookie, body)).status, 403);
    assert.equal((await request(`${path}/${endpoint}`, unverifiedSession.cookie, body)).status, 403);
  }
  assert.equal((await request("/auth/me", ownerSession.cookie)).json.data.canManageGmail, true);
  assert.equal((await request("/auth/me", regularSession.cookie)).json.data.canManageGmail, false);

  assert.equal((await request(`${path}/connect`, ownerSession.cookie)).status, 404);
  for (const rejectedOrigin of [null, "https://wrong.example"]) {
    const response = await request(`${path}/connect`, ownerSession.cookie, {}, rejectedOrigin);
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, "ORIGIN_REJECTED");
  }
  assert.equal(await prisma.gmailOAuthState.count({ where: { sessionId: ownerSession.id } }), 0);
  assert.equal(await prisma.emailIntegrationCredential.count({ where: { id: GMAIL_INTEGRATION_ID } }), 0);

  let state = await begin();
  assert.equal(await callback("invalid"), "INVALID_STATE");
  assert.equal(await callback(state, undefined, otherSession.cookie), "INVALID_STATE");
  assert.equal(await callback(state, "error=access_denied&error_description=untrusted"), "CONSENT_DENIED");
  assert.equal(await callback(state), "INVALID_STATE");

  state = await begin();
  await prisma.gmailOAuthState.update({ where: { sessionId: ownerSession.id }, data: { expiresAt: new Date(0) } });
  assert.equal(await callback(state), "INVALID_STATE");
  assert.equal(await callback(await begin(), "scope=email"), "INVALID_CALLBACK");
  assert.equal(authorize.mock.callCount(), 0);
  exchangeFails = true;
  assert.equal(await callback(await begin()), "EXCHANGE_FAILED");
  assert.equal((await request(`${path}/status`, ownerSession.cookie)).json.data.lastError, "EXCHANGE_FAILED");

  exchangeFails = false;
  state = await begin();
  const results = await Promise.all([callback(state), callback(state)]);
  assert.deepEqual(results.sort(), ["INVALID_STATE", "connected"]);
  assert.equal(authorize.mock.callCount(), 2);
  assert.equal((await request(`${path}/connect`, ownerSession.cookie, {})).status, 409);
  const stored = await prisma.emailIntegrationCredential.findUniqueOrThrow({ where: { id: GMAIL_INTEGRATION_ID } });
  assert.ok(stored.encryptedRefreshToken && !stored.encryptedRefreshToken.includes(ownerToken));
  assert.equal(stored.encryptionKeyVersion, 1);
  assert.deepEqual(Object.keys((await request(`${path}/status`, ownerSession.cookie)).json.data).sort(),
    ["enabled", "lastError", "lastSuccessfulSendAt", "senderEmail", "status"]);

  const registration = await request("/auth/register", undefined, { email: clientEmail, password, displayName: "Gmail registration", recipient: clientEmail });
  assert.equal(registration.status, 202);
  const continuation = registration.json.data.continuation as string;
  const pending = await prisma.registrationRequest.findUniqueOrThrow({ where: { continuationHash: tokenDigest(continuation) } });
  registrationId = pending.id;
  assert.equal(await prisma.user.count({ where: { email: clientEmail } }), 0);
  for (let attempt = 0; attempt < 150 && !mail.length; attempt++) await delay(20);
  assert.equal(mail.length, 1);
  assert.equal(refresh.mock.callCount(), 1);
  assert.equal(send.mock.callCount(), 1);
  const [headers, body] = mail[0].split("\r\n\r\n");
  assert.equal(headers.split("\r\n").find(line => line.startsWith("To:")), `To: ${testSender}`);
  assert.ok(!headers.includes(clientEmail));
  const otp = Buffer.from(body, "base64").toString().match(/Approval code: (\d{8})/)?.[1];
  assert.ok(otp);
  const confirm = await request("/auth/register/confirm", undefined, { continuation, otp });
  assert.equal(confirm.status, 200);
  const client = await prisma.user.findUniqueOrThrow({ where: { email: clientEmail } });
  userIds.push(client.id);
  assert.equal(client.emailVerifiedAt, null);
  assert.ok(client.ownerApprovedAt);
  assert.equal((await request("/auth/register/confirm", undefined, { continuation, otp })).status, 400);
  const recovery = await request("/auth/forgot-password", undefined, { email: clientEmail });
  assert.equal(recovery.status, 202);
  assert.equal(recovery.json.data.developmentResetToken, undefined);
  assert.equal(send.mock.callCount(), 1);
  assert.ok((await request(`${path}/status`, ownerSession.cookie)).json.data.lastSuccessfulSendAt);

  assert.equal((await request(`${path}/disconnect`, ownerSession.cookie, {}, "https://wrong.example")).status, 403);
  assert.equal((await request(`${path}/disconnect`, ownerSession.cookie, {})).status, 502);
  assert.equal((await request(`${path}/status`, ownerSession.cookie)).json.data.status, "DISCONNECTING");
  assert.equal((await request(`${path}/connect`, ownerSession.cookie, {})).status, 409);
  revokeFails = false;
  assert.equal((await request(`${path}/disconnect`, ownerSession.cookie, {})).status, 204);
  assert.equal(revoke.mock.callCount(), 2);
  assert.equal((await prisma.emailIntegrationCredential.findUniqueOrThrow({ where: { id: GMAIL_INTEGRATION_ID } })).encryptedRefreshToken, null);
  assert.equal((await request(`${path}/status`, ownerSession.cookie)).json.data.status, "DISCONNECTED");

  const disconnect = () => request(`${path}/disconnect`, ownerSession.cookie, {});
  const credential = () => prisma.emailIntegrationCredential.findUniqueOrThrow({ where: { id: GMAIL_INTEGRATION_ID } });

  assert.equal(await callback(await begin()), "connected");
  revokeGate = pauseRemote();
  const firstDisconnect = disconnect();
  try {
    await Promise.race([revokeGate.entered, firstDisconnect.then(() => assert.fail("Disconnect completed before revocation started."))]);
    assert.equal((await credential()).status, "DISCONNECTING");
    const overlap = await disconnect();
    assert.equal(overlap.status, 409);
    assert.equal(overlap.json.error.code, "DISCONNECT_IN_PROGRESS");
    assert.equal(revoke.mock.callCount(), 3);
  } finally {
    revokeGate.release();
    assert.equal((await firstDisconnect).status, 204);
    revokeGate = undefined;
  }

  const canceledState = await begin();
  exchangeGate = pauseRemote();
  const canceledCallback = callback(canceledState);
  try {
    await Promise.race([exchangeGate.entered, canceledCallback.then(() => assert.fail("Callback completed before exchange started."))]);
    const cancel = await disconnect();
    assert.equal(cancel.status, 409);
    assert.equal(cancel.json.error.code, "DISCONNECT_IN_PROGRESS");
    assert.equal((await credential()).status, "DISCONNECTING");
    assert.equal(await callback(canceledState), "INVALID_STATE");
    assert.equal((await request(`${path}/connect`, ownerSession.cookie, {})).status, 409);
  } finally {
    exchangeGate.release();
    assert.equal(await canceledCallback, "CONNECTION_CHANGED");
    exchangeGate = undefined;
  }
  assert.equal(revoke.mock.callCount(), 4);
  assert.equal((await credential()).status, "DISCONNECTED");
  assert.equal((await credential()).encryptedRefreshToken, null);

  // Model the operator replacing the interrupted revision after revoking the grant.
  // The paused Google mocks let us inject a late response to verify the database fence.
  const recoverySql = readFileSync(resolve(__dirname, "../../../../scripts/maintenance/recover-gmail.sql"), "utf8")
    .replace(":'expected_sender'", "$1")
    .replace(":'expected_revision'", "$2");
  async function recover(expectedRevision: string) {
    const [result] = await prisma.$queryRawUnsafe<{ revision: string }[]>(recoverySql, testSender, expectedRevision);
    return result?.revision ?? null;
  }

  async function assertRecovered(revision: string) {
    const row = await credential();
    assert.equal(row.revision, revision);
    assert.equal(row.status, "DISCONNECTED");
    assert.equal(row.encryptedRefreshToken, null);
    assert.equal(row.encryptionKeyVersion, null);
    assert.equal(row.connectedAt, null);
    assert.equal(row.lastTokenRefreshAt, null);
    assert.equal(row.lastError, null);
  }

  const conflictedState = await begin();
  const pendingResponse = await request(`${path}/connect`, otherSession.cookie, {});
  assert.equal(pendingResponse.status, 200);
  const pendingState = new URL(pendingResponse.json.data.authorizationUrl).searchParams.get("state");
  assert.ok(pendingState);
  exchangeGate = pauseRemote();
  const conflictedCallback = callback(conflictedState);
  let replacementRevision: string | null = null;
  try {
    await Promise.race([exchangeGate.entered, conflictedCallback.then(() => assert.fail("Callback completed before exchange started."))]);
    const interrupted = await credential();
    assert.match(interrupted.revision, /^connecting:/);
    assert.equal(interrupted.status, "DISCONNECTED");
    assert.equal((await disconnect()).status, 409);
    assert.equal(await recover(`connecting:${randomUUID()}`), null);
    replacementRevision = await recover(interrupted.revision);
    assert.ok(replacementRevision);
    assert.equal(await recover(interrupted.revision), null);
  } finally {
    exchangeGate.release();
    assert.equal(await conflictedCallback, "CONNECTION_CHANGED");
    exchangeGate = undefined;
  }
  await assertRecovered(replacementRevision!);
  assert.equal(revoke.mock.callCount(), 4);
  const exchangeCount = authorize.mock.callCount();
  assert.equal(await callback(pendingState, undefined, otherSession.cookie), "CONNECTION_CHANGED");
  assert.equal(authorize.mock.callCount(), exchangeCount);

  for (const fails of [false, true]) {
    assert.equal(await callback(await begin()), "connected");
    revokeFails = fails;
    revokeGate = pauseRemote();
    const interruptedDisconnect = disconnect();
    let recoveredRevision: string | null = null;
    try {
      await Promise.race([revokeGate.entered, interruptedDisconnect.then(() => assert.fail("Disconnect completed before revocation started."))]);
      const interrupted = await credential();
      assert.match(interrupted.revision, /^revoking:/);
      assert.equal(interrupted.status, "DISCONNECTING");
      assert.ok(interrupted.encryptedRefreshToken);
      assert.equal((await request(`${path}/connect`, ownerSession.cookie, {})).status, 409);
      const recoveries = await Promise.all([recover(interrupted.revision), recover(interrupted.revision)]);
      const winners = recoveries.filter(revision => revision !== null);
      assert.equal(winners.length, 1);
      [recoveredRevision] = winners;
    } finally {
      revokeGate.release();
      assert.equal((await interruptedDisconnect).status, fails ? 502 : 409);
      revokeGate = undefined;
    }
    await assertRecovered(recoveredRevision!);
  }

  assert.equal(await callback(await begin()), "connected");
  assert.equal((await disconnect()).status, 502);
  const failedRevocation = await credential();
  assert.equal(failedRevocation.lastError, "REVOCATION_FAILED");
  const recoveredFailure = await recover(failedRevocation.revision);
  assert.ok(recoveredFailure);
  await assertRecovered(recoveredFailure);

  const auditEvents = await prisma.auditEvent.findMany({ where: { OR: [
    { requestId: { in: [...requestIds] } }, { targetId: registrationId },
  ] } });
  assert.ok(auditEvents.some(event => event.action === "REGISTRATION_APPROVED"));
  const audit = JSON.stringify(auditEvents);
  const logs = [...stdout.mock.calls, ...stderr.mock.calls].map(call => String(call.arguments[0])).join("\n");
  for (const secret of [ownerToken, accessToken, authorizationCode, values.GOOGLE_OAUTH_CLIENT_SECRET, values.GOOGLE_OAUTH_ENCRYPTION_KEY, state, canceledState, conflictedState, pendingState, otp]) {
    assert.ok(!logs.includes(secret) && !audit.includes(secret));
  }
});
