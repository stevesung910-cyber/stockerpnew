import dotenv from "dotenv";
import { resolve } from "node:path";
dotenv.config({ path: resolve(process.cwd(), ".env") });
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { app } from "../../app";
import { prisma } from "../../database/prisma";
import { hashPassword, newOpaqueToken, tokenDigest } from "./password";
import { createSession, SESSION_TTL_MS } from "./session";
import { configureRateLimitStore } from "./rate-limit";
import { PostgresRateLimitStore } from "./postgres-rate-limit";
import type { OutboundEmail } from "./email-delivery";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
let server: Server; let baseUrl = "";
const userIds: string[] = []; const companyIds: string[] = []; const registrationIds: string[] = [];
const requestIds = new Set<string>();
const password = "Correct-Horse-88!Battery";
const ownerEmail = "owner-approval@example.test";
type ApiResult<T = Record<string, unknown>> = { status: number; body: T; cookie?: string; setCookieHeader?: string };

async function request<T = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}; if (options.origin !== null) headers.Origin = options.origin ?? origin;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${baseUrl}/api/v1${path}`, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const text = response.status === 204 ? "" : await response.text();
  const body = text ? JSON.parse(text) as T : {} as T;
  const requestId = (body as { meta?: { requestId?: string } }).meta?.requestId;
  if (requestId) requestIds.add(requestId);
  const setCookieHeader = response.headers.get("set-cookie");
  return { status: response.status, body, ...(setCookieHeader ? { cookie: setCookieHeader.split(";")[0], setCookieHeader } : {}) };
}

async function account(label: string, verified = true) {
  const email = `phase1-${label}-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, displayName: `Test ${label}`, passwordHash: await hashPassword("Correct-Horse-88!Battery"), emailVerifiedAt: verified ? new Date() : null, legacyRegistration: verified, ownerApprovedAt: verified ? null : new Date() }, select: { id: true, email: true } });
  userIds.push(user.id);
  const session = await createSession(user.id);
  return { ...user, cookie: `stockerp_session=${encodeURIComponent(session.token)}` };
}

async function createCompany(cookie: string, name: string) {
  const result = await request<{ data: { company: { id: string; name: string } } }>("/companies", { cookie, body: { name } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const company = result.body.data.company; companyIds.push(company.id);
  return company;
}

async function invite(cookie: string, email: string, roleCode: string) {
  return request<{ data: { invitation: { id: string }; developmentInvitationToken?: string } }>("/companies/invitations", { cookie, body: { email, roleCode } });
}

async function membership(companyId: string, userId: string) {
  return prisma.companyMembership.findUnique({ where: { userId_companyId: { userId, companyId } }, include: { role: true } });
}

async function withRegistrationMail(work: (mail: OutboundEmail[], setStatus: (status: number) => void) => Promise<void>) {
  const settings = {
    REGISTRATION_OWNER_EMAIL: ownerEmail,
    OWNER_REGISTRATION_OTP_HMAC_SECRET: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    EMAIL_PROVIDER_API_KEY: "mock-provider-test",
    EMAIL_PROVIDER_URL: "",
  };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const mail: OutboundEmail[] = [];
  let status = 202;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    mail.push(JSON.parse(Buffer.concat(chunks).toString()) as OutboundEmail);
    if (status === 0) return; // Exercise the transport timeout without returning a payload.
    res.writeHead(status);
    res.end();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", resolve);
    });
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    settings.EMAIL_PROVIDER_URL = `http://127.0.0.1:${address.port}/send`;
    Object.assign(process.env, settings);
    await work(mail, code => { status = code; });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (provider.listening) {
      await new Promise<void>(resolve => {
        provider.close(() => resolve());
        provider.closeAllConnections();
      });
    }
  }
}

async function eventually(check: () => Promise<boolean>, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail("Expected asynchronous registration status was not recorded");
    await delay(20);
  }
}

async function register(email = `phase1-register-${randomUUID()}@example.test`) {
  const response = await request<{ data: { continuation: string; message: string } }>("/auth/register", {
    body: { email: email.toUpperCase(), displayName: "Registered Person", password, recipient: email },
  });
  assert.equal(response.status, 202);
  assert.equal(response.cookie, undefined);
  assert.deepEqual(Object.keys(response.body.data).sort(), ["continuation", "message"]);
  const row = await prisma.registrationRequest.findUnique({ where: { continuationHash: tokenDigest(response.body.data.continuation) } });
  if (row) registrationIds.push(row.id);
  return { ...response.body.data, email, row };
}

function confirm(continuation: string, otp: string) {
  return request("/auth/register/confirm", { body: { continuation, otp } });
}

async function delivered(id: string, mail: OutboundEmail[], version = 1) {
  await eventually(async () => !!(await prisma.registrationRequest.findUnique({ where: { id } }))?.providerAccepted);
  const notice = mail.find(item => item.text.includes(`${id} (code version ${version})`));
  assert.ok(notice);
  assert.equal(notice.to, ownerEmail);
  const otp = /^Approval code: ([0-9]{8})$/m.exec(notice.text)?.[1];
  assert.ok(otp);
  return otp;
}

function wrongCode(otp: string) {
  return otp === "00000000" ? "00000001" : "00000000";
}

async function unlockResend(id: string) {
  await prisma.registrationRequest.update({ where: { id }, data: { lastIssuedAt: new Date(Date.now() - 61_000) } });
}

describe("StockERP Phase 1 security integration", () => {
  before(async () => {
    assert.equal(process.env.APP_ENV, "development", "test runner must use isolated local development settings");
    assert.equal(process.env.AUTH_DEV_EXPOSE_TOKENS, "true", "dev token workflow is explicitly enabled only for the dedicated test database");
    assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
    await prisma.$connect();
    const namespace = randomUUID();
    const store = new PostgresRateLimitStore();
    configureRateLimitStore({ consume: (key, max, window) => store.consume(`${namespace}:${key}`, max, window) });
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    const address = server.address(); if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (requestIds.size) await prisma.auditEvent.deleteMany({ where: { requestId: { in: [...requestIds] } } });
    if (registrationIds.length) await prisma.registrationRequest.deleteMany({ where: { id: { in: registrationIds } } });
    const ids = [...userIds]; const companies = [...companyIds];
    if (companies.length || ids.length) await prisma.auditEvent.deleteMany({ where: { OR: [...(companies.length ? [{ companyId: { in: companies } }] : []), ...(ids.length ? [{ actorUserId: { in: ids } }] : [])] } });
    if (companies.length || ids.length) await prisma.companyInvitation.deleteMany({ where: { OR: [...(companies.length ? [{ companyId: { in: companies } }] : []), ...(ids.length ? [{ invitedByUserId: { in: ids } }] : [])] } });
    if (ids.length) {
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
    }
    if (companies.length) {
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.companyRole.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.company.deleteMany({ where: { id: { in: companies } } });
    }
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  });

  it("approves through owner-only mail, then signs in and creates a workspace without verifying the mailbox", async () => {
    await withRegistrationMail(async mail => {
      const email = `concurrent-registration-${randomUUID()}@example.test`;
      const [first, second] = await Promise.all([register(email), register(email)]);
      const [pending, duplicate] = first.row ? [first, second] : [second, first];
      assert.ok(pending.row);
      const id = pending.row.id;
      assert.equal(pending.row.email, pending.email);
      assert.match(pending.row.passwordHash!, /^scrypt\$/);
      assert.equal(await prisma.user.count({ where: { email: pending.email } }), 0);
      assert.equal((await request("/auth/login", { body: { email: pending.email, password } })).status, 401);
      assert.equal(duplicate.row, null);
      assert.equal(duplicate.message, pending.message);
      assert.equal(duplicate.continuation.length, pending.continuation.length);
      const otp = await delivered(id, mail);
      assert.equal(mail.length, 1);
      assert.notEqual(pending.row.otpDigest, otp);
      const invalid = await confirm(duplicate.continuation, otp);
      assert.equal(invalid.status, 400);
      const results = await Promise.all([confirm(pending.continuation, otp), confirm(pending.continuation, otp)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      assert.ok(results.every(result => !result.cookie));
      assert.equal((await confirm(pending.continuation, otp)).status, 400);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: pending.email } });
      userIds.push(user.id);
      assert.equal(user.emailVerifiedAt, null);
      assert.ok(user.ownerApprovedAt);
      assert.equal(user.passwordHash, pending.row.passwordHash);
      assert.equal(await prisma.companyMembership.count({ where: { userId: user.id } }), 0);
      const consumed = await prisma.registrationRequest.findUniqueOrThrow({ where: { id } });
      assert.ok(consumed.consumedAt);
      assert.equal(consumed.resultingUserId, user.id);
      assert.equal(consumed.otpDigest, null);
      assert.equal(consumed.continuationHash, null);
      assert.equal(consumed.passwordHash, null);
      const events = await prisma.auditEvent.findMany({ where: { targetId: id } });
      assert.equal(events.filter(event => event.action === "REGISTRATION_APPROVED").length, 1);
      assert.ok(events.every(event => event.metadata === null));
      const reset = await request<{ data: { developmentResetToken?: string } }>("/auth/forgot-password", { body: { email: user.email } });
      assert.equal(reset.body.data.developmentResetToken, undefined);
      const login = await request("/auth/login", { body: { email: user.email, password } });
      assert.equal(login.status, 200);
      assert.ok(login.cookie);
      assert.match(login.setCookieHeader!, /HttpOnly/i);
      assert.match(login.setCookieHeader!, /SameSite=Lax/i);
      const me = await request<{ data: { user: { ownerApprovedAt: string; emailVerifiedAt: null; eligibility: string } } }>("/auth/me", { cookie: login.cookie });
      assert.equal(me.body.data.user.eligibility, "OWNER_APPROVED");
      assert.ok(me.body.data.user.ownerApprovedAt);
      assert.equal(me.body.data.user.emailVerifiedAt, null);
      assert.equal((await request("/companies", { cookie: login.cookie, body: { name: "Bad Origin" }, origin: "https://invalid.example" })).status, 403);
      await createCompany(login.cookie, "Owner Approved Workspace");
      assert.equal((await request("/inventory/reports/stock-summary", { cookie: login.cookie })).status, 200);
      assert.equal((await request("/auth/logout", { method: "POST", cookie: login.cookie })).status, 204);
      assert.equal((await request("/auth/me", { cookie: login.cookie })).status, 401);
    });
  });

  it("binds codes to their request, enforces expiration and cooldown, and preserves the attempt budget", async () => {
    await withRegistrationMail(async mail => {
      const [first, second] = await Promise.all([register(), register()]);
      assert.ok(first.row && second.row);
      const firstId = first.row.id;
      const secondId = second.row.id;
      const [otp, secondOtp] = await Promise.all([delivered(firstId, mail), delivered(secondId, mail)]);
      assert.equal((await confirm("invalid", otp)).status, 400);
      if (otp !== secondOtp) assert.equal((await confirm(first.continuation, secondOtp)).status, 400);
      else assert.equal((await confirm(first.continuation, wrongCode(otp))).status, 400);
      const resend = () => request("/auth/register/resend", { body: { continuation: first.continuation } });
      assert.equal((await resend()).status, 202);
      assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: firstId } })).challengeVersion, 1);
      await prisma.registrationRequest.update({ where: { id: firstId }, data: { otpExpiresAt: new Date(Date.now() - 1) } });
      assert.equal((await confirm(first.continuation, otp)).status, 400);
      assert.equal(await prisma.auditEvent.count({ where: { targetId: firstId, action: "REGISTRATION_OTP_EXPIRED" } }), 1);
      await unlockResend(firstId);
      const concurrent = await Promise.all([resend(), resend()]);
      assert.deepEqual(concurrent.map(response => response.status), [202, 202]);
      const replacement = await delivered(firstId, mail, 2);
      assert.notEqual(replacement, otp);
      const row = await prisma.registrationRequest.findUniqueOrThrow({ where: { id: firstId } });
      assert.equal(row.challengeVersion, 2);
      assert.equal(row.failedAttempts, 1);
      assert.equal((await confirm(first.continuation, otp)).status, 400);
      const failures = await Promise.all(Array.from({ length: 5 }, () => confirm(first.continuation, wrongCode(replacement))));
      assert.ok(failures.every(response => response.status === 400));
      assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: firstId } })).failedAttempts, 5);
      assert.equal(await prisma.auditEvent.count({ where: { targetId: firstId, action: "REGISTRATION_OTP_EXHAUSTED" } }), 1);
      await unlockResend(firstId);
      assert.equal((await resend()).status, 202);
      assert.equal((await confirm(first.continuation, replacement)).status, 400);
      assert.equal(await prisma.user.count({ where: { email: first.email } }), 0);

      await unlockResend(secondId);
      const [confirmed, requested] = await Promise.all([
        confirm(second.continuation, secondOtp),
        request("/auth/register/resend", { body: { continuation: second.continuation } }),
      ]);
      assert.equal(requested.status, 202);
      if (confirmed.status === 400) {
        const latest = await delivered(secondId, mail, 2);
        assert.equal((await confirm(second.continuation, latest)).status, 200);
      } else assert.equal(confirmed.status, 200);
      const approved = await prisma.user.findUniqueOrThrow({ where: { email: second.email } });
      userIds.push(approved.id);
    });
  });

  it("rolls back consumption and approval if account creation loses a uniqueness race", async () => {
    await withRegistrationMail(async mail => {
      const pending = await register();
      assert.ok(pending.row);
      const id = pending.row.id;
      const otp = await delivered(id, mail);
      const conflict = await prisma.user.create({
        data: { email: pending.email, displayName: "Conflicting account", passwordHash: await hashPassword(password) },
      });
      userIds.push(conflict.id);
      assert.equal((await confirm(pending.continuation, otp)).status, 400);
      const row = await prisma.registrationRequest.findUniqueOrThrow({ where: { id } });
      assert.equal(row.consumedAt, null);
      assert.equal(row.continuationHash, tokenDigest(pending.continuation));
      assert.equal(row.resultingUserId, null);
      assert.equal(await prisma.auditEvent.count({ where: { targetId: id, action: "REGISTRATION_APPROVED" } }), 0);
    });
  });

  it("fails safely for missing configuration, provider rejection and timeout without disabling a newer challenge", async t => {
    const stderr = t.mock.method(process.stderr, "write", () => true);
    await withRegistrationMail(async (mail, setStatus) => {
      const key = process.env.EMAIL_PROVIDER_API_KEY;
      delete process.env.EMAIL_PROVIDER_API_KEY;
      const unavailable = await request<{ error: { code: string } }>("/auth/register", {
        body: { email: "missing-provider@example.test", displayName: "Missing provider", password },
      });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body.error.code, "REGISTRATION_UNAVAILABLE");
      process.env.EMAIL_PROVIDER_API_KEY = key!;
      setStatus(503);
      const pending = await register();
      assert.ok(pending.row);
      const id = pending.row.id;
      const failures = () => prisma.auditEvent.count({ where: { targetId: id, action: "REGISTRATION_NOTIFICATION_FAILED" } });
      await eventually(async () => await failures() === 1);
      const rejectedCode = /^Approval code: ([0-9]{8})$/m.exec(mail[0].text)![1];
      assert.equal((await confirm(pending.continuation, rejectedCode)).status, 400);
      await unlockResend(id);
      setStatus(0);
      await request("/auth/register/resend", { body: { continuation: pending.continuation } });
      await eventually(async () => mail.length === 2);
      assert.equal(await prisma.user.count({ where: { email: pending.email } }), 0);
      await unlockResend(id);
      setStatus(202);
      await request("/auth/register/resend", { body: { continuation: pending.continuation } });
      const latest = await delivered(id, mail, 3);
      await eventually(async () => await failures() === 2, 13_000);
      const logs = stderr.mock.calls.map(call => String(call.arguments[0])).join("\n");
      assert.ok(!logs.includes(rejectedCode) && !logs.includes(latest) && !logs.includes(pending.continuation));
      assert.equal((await confirm(pending.continuation, latest)).status, 200);
      userIds.push((await prisma.user.findUniqueOrThrow({ where: { email: pending.email } })).id);
    });
  });

  it("preserves verified legacy sessions and offers password-bound mailbox verification to ineligible legacy users", async () => {
    await withRegistrationMail(async mail => {
      const verified = await account("verified-legacy");
      const me = await request<{ data: { user: { eligibility: string; ownerApprovedAt: null } } }>("/auth/me", { cookie: verified.cookie });
      assert.equal(me.body.data.user.eligibility, "LEGACY_VERIFIED");
      assert.equal(me.body.data.user.ownerApprovedAt, null);
      const email = `legacy-${randomUUID()}@example.test`;
      const user = await prisma.user.create({ data: { email, displayName: "Legacy account", passwordHash: await hashPassword(password), legacyRegistration: true } });
      userIds.push(user.id);
      const cookies = await Promise.all(Array.from({ length: 2 }, async () => {
        const token = newOpaqueToken();
        await prisma.authSession.create({ data: { tokenHash: tokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
        return `stockerp_session=${token}`;
      }));
      const oldReset = newOpaqueToken();
      await prisma.passwordResetToken.create({ data: { tokenHash: tokenDigest(oldReset), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
      assert.equal((await request("/auth/reset-password", { body: { token: oldReset, password: "Invalid-Legacy-Reset-42!" } })).status, 400);
      assert.equal((await request("/auth/login", { body: { email, password } })).status, 401);
      assert.equal((await request("/auth/me", { cookie: cookies[0] })).status, 401);
      assert.equal((await request("/companies", { cookie: cookies[0], body: { name: "Unauthorized" } })).status, 401);
      assert.equal((await request("/companies/switch", { cookie: cookies[0], body: { companyId: "other" } })).status, 401);
      assert.equal((await request("/inventory/reports/stock-summary", { cookie: cookies[0] })).status, 401);
      assert.equal((await request("/auth/verify-email/legacy-request", { body: { email, password: "incorrect" } })).status, 202);
      assert.equal(mail.length, 0);
      assert.equal((await request("/auth/verify-email/legacy-request", { body: { email, password } })).status, 202);
      assert.equal(mail[0].to, email);
      const token = /[?]token=([A-Za-z0-9_-]+)/.exec(mail[0].text)![1];
      assert.equal((await request("/auth/verify-email/confirm", { body: { token, password: "incorrect" } })).status, 400);
      assert.equal((await request("/auth/verify-email/confirm", { body: { token, password } })).status, 200);
      assert.equal((await request("/auth/verify-email/confirm", { body: { token, password } })).status, 400);
      assert.equal((await request("/auth/me", { cookie: cookies[1] })).status, 401);
      assert.equal((await request("/auth/login", { body: { email, password } })).status, 200);
    });
  });

  it("shares an atomic rate budget between store instances", async () => {
    const key = randomUUID();
    const stores = [new PostgresRateLimitStore(), new PostgresRateLimitStore()];
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) => stores[index % 2].consume(key, 4, 60_000)));
    assert.equal(decisions.filter(decision => decision.allowed).length, 4);
    assert.ok(decisions.filter(decision => !decision.allowed).every(decision => decision.retryAfterSeconds > 0));
  });

  it("allows an eligible zero-membership account to create a company and limits additional companies to Company Admin", async () => {
    const owner = await account("creation-owner", false);
    const first = await createCompany(owner.cookie, "Initial Company");
    assert.equal(await prisma.auditEvent.count({ where: { actorUserId: owner.id, companyId: first.id, action: "COMPANY_CREATED", outcome: "SUCCESS" } }), 1);
    const second = await request<{ data: { company: { id: string } } }>("/companies", { cookie: owner.cookie, body: { name: "Admin Additional Company" } });
    assert.equal(second.status, 201); companyIds.push(second.body.data.company.id);
    for (let index = 3; index <= 5; index += 1) await createCompany(owner.cookie, `Company Creation ${index}`);
    const rateLimited = await request("/companies", { cookie: owner.cookie, body: { name: "Company Creation Rate Limited" } }); assert.equal(rateLimited.status, 429);
    const ordinary = await account("creation-ordinary");
    const role = await prisma.companyRole.findUniqueOrThrow({ where: { companyId_code: { companyId: first.id, code: "SALES_EXECUTIVE" } } });
    await prisma.companyMembership.create({ data: { userId: ordinary.id, companyId: first.id, roleId: role.id } });
    const denied = await request("/companies", { cookie: ordinary.cookie, body: { name: "Unauthorized Additional Company" } });
    assert.equal(denied.status, 403);
    assert.equal(await prisma.company.count({ where: { name: "Unauthorized Additional Company" } }), 0);
  });

  it("blocks HR, ordinary-user, self and reserved Super Admin grants without mutating memberships", async () => {
    const owner = await account("role-owner"); const company = await createCompany(owner.cookie, "Role Guard Company");
    const hr = await account("hr-manager"); const hrInvite = await invite(owner.cookie, hr.email, "HR_MANAGER");
    assert.equal(hrInvite.status, 201); assert.equal(await membership(company.id, hr.id), null);
    const acceptedHr = await request("/companies/invitations/accept", { cookie: hr.cookie, body: { token: hrInvite.body.data.developmentInvitationToken } }); assert.equal(acceptedHr.status, 201);
    assert.equal((await request("/companies/switch", { cookie: hr.cookie, body: { companyId: company.id } })).status, 200);
    const ownerMembership = await membership(company.id, owner.id);
    assert.equal((await request(`/companies/members/${ownerMembership!.id}`, { method: "PATCH", cookie: owner.cookie, body: { roleCode: "SUPER_ADMIN" } })).status, 409);
    assert.equal((await membership(company.id, owner.id))?.role.code, "COMPANY_ADMIN");
    const hrRoles = await request<{ data: { roles: Array<{ code: string }> } }>("/companies/assignable-roles", { cookie: hr.cookie });
    assert.equal(hrRoles.status, 200); assert.ok(!hrRoles.body.data.roles.some(role => ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(role.code)));
    const adminRoles = await request<{ data: { roles: Array<{ code: string }> } }>("/companies/assignable-roles", { cookie: owner.cookie });
    assert.ok(adminRoles.body.data.roles.some(role => role.code === "COMPANY_ADMIN")); assert.ok(!adminRoles.body.data.roles.some(role => role.code === "SUPER_ADMIN"));
    const victim = await account("role-victim"); const victimInvite = await invite(owner.cookie, victim.email, "SALES_EXECUTIVE"); assert.equal(victimInvite.status, 201);
    const acceptedVictim = await request("/companies/invitations/accept", { cookie: victim.cookie, body: { token: victimInvite.body.data.developmentInvitationToken } }); assert.equal(acceptedVictim.status, 201);
    assert.equal((await request("/companies/switch", { cookie: victim.cookie, body: { companyId: company.id } })).status, 200);
    const victimBefore = await membership(company.id, victim.id);
    assert.equal((await invite(hr.cookie, hr.email, "COMPANY_ADMIN")).status, 403);
    assert.equal((await invite(hr.cookie, victim.email, "COMPANY_ADMIN")).status, 403);
    assert.equal((await invite(hr.cookie, victim.email, "SUPER_ADMIN")).status, 403);
    assert.equal((await invite(victim.cookie, hr.email, "COMPANY_ADMIN")).status, 403);
    assert.equal((await invite(owner.cookie, victim.email, "SUPER_ADMIN")).status, 403);
    const afterAttempts = await membership(company.id, victim.id);
    assert.equal(afterAttempts?.roleId, victimBefore?.roleId); assert.equal(afterAttempts?.status, victimBefore?.status);
    const promote = await request(`/companies/members/${victimBefore!.id}`, { method: "PATCH", cookie: hr.cookie, body: { roleCode: "COMPANY_ADMIN" } });
    assert.equal(promote.status, 403);
    const reservedPromotion = await request(`/companies/members/${victimBefore!.id}`, { method: "PATCH", cookie: owner.cookie, body: { roleCode: "SUPER_ADMIN" } }); assert.equal(reservedPromotion.status, 403);
    const afterUpdate = await membership(company.id, victim.id); assert.equal(afterUpdate?.roleId, victimBefore?.roleId);
    const permittedTarget = await account("permitted-role-target");
    const permitted = await invite(owner.cookie, permittedTarget.email, "STORE_KEEPER"); assert.equal(permitted.status, 201);
    assert.equal(await membership(company.id, permittedTarget.id), null);
    const permittedAcceptance = await request("/companies/invitations/accept", { cookie: permittedTarget.cookie, body: { token: permitted.body.data.developmentInvitationToken } }); assert.equal(permittedAcceptance.status, 201);
    assert.equal((await membership(company.id, permittedTarget.id))?.role.code, "STORE_KEEPER");
    const permittedMember = await membership(company.id, permittedTarget.id);
    const authorizedRoleChange = await request(`/companies/members/${permittedMember!.id}`, { method: "PATCH", cookie: owner.cookie, body: { roleCode: "STORE_MANAGER" } }); assert.equal(authorizedRoleChange.status, 200);
    assert.equal((await membership(company.id, permittedTarget.id))?.role.code, "STORE_MANAGER");
  });

  it("retains and revokes an invitation when email delivery fails", async () => {
    const owner = await account("delivery-failure-owner");
    const company = await createCompany(owner.cookie, `Delivery Failure ${randomUUID()}`);
    const email = `delivery-${randomUUID()}@example.test`;
    const keys = ["AUTH_DEV_EXPOSE_TOKENS", "EMAIL_PROVIDER_URL", "EMAIL_PROVIDER_API_KEY", "FRONTEND_ORIGIN"];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    let attempts = 0;
    const mock = createServer((_req, res) => {
      attempts++;
      res.writeHead(503);
      res.end("Provider unavailable");
    });

    try {
      process.env.AUTH_DEV_EXPOSE_TOKENS = "false";
      process.env.EMAIL_PROVIDER_API_KEY = "test-only-key";
      process.env.FRONTEND_ORIGIN = origin;
      await new Promise<void>((resolve, reject) => {
        mock.once("error", reject);
        mock.listen(0, "127.0.0.1", resolve);
      });
      const address = mock.address();
      assert.ok(address && typeof address !== "string");
      process.env.EMAIL_PROVIDER_URL = `http://127.0.0.1:${address.port}/send`;

      const before = await prisma.companyMembership.count({ where: { companyId: company.id } });
      const response = await request<{ error?: { code?: string } }>("/companies/invitations", {
        cookie: owner.cookie,
        body: { email, roleCode: "ACCOUNTANT" },
      });
      assert.equal(response.status, 503);
      assert.equal(response.body.error?.code, "EMAIL_DELIVERY_FAILED");
      assert.equal(attempts, 1);

      const invitation = await prisma.companyInvitation.findFirst({ where: { companyId: company.id, email } });
      assert.ok(invitation);
      assert.ok(invitation.revokedAt);
      assert.equal(invitation.acceptedAt, null);

      const event = await prisma.auditEvent.findFirst({
        where: { companyId: company.id, actorUserId: owner.id, action: "INVITATION_DELIVERY_FAILED", targetId: invitation.id },
      });
      assert.ok(event);
      assert.equal(event.outcome, "FAILURE");
      assert.deepEqual(event.metadata, { reason: "EMAIL_DELIVERY_FAILED" });

      assert.equal(await prisma.companyMembership.count({ where: { companyId: company.id } }), before);
    } finally {
      for (const key of keys) {
        const value = saved[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (mock.listening) await new Promise<void>((resolve, reject) => mock.close(err => err ? reject(err) : resolve()));
    }
  });

  it("does not create membership before invitation acceptance and enforces email match, expiry and one-use", async () => {
    const owner = await account("invite-owner"); const company = await createCompany(owner.cookie, "Invitation Flow Company");
    const target = await account("invite-target"); const invitation = await invite(owner.cookie, target.email, "ACCOUNTANT");
    assert.equal(invitation.status, 201); const token = invitation.body.data.developmentInvitationToken!;
    assert.equal(await membership(company.id, target.id), null);
    const other = await account("invite-other");
    assert.equal((await request("/companies/invitations/accept", { cookie: other.cookie, body: { token } })).status, 403);
    const created = await request("/companies/invitations/accept", { cookie: target.cookie, body: { token } }); assert.equal(created.status, 201);
    assert.equal((await membership(company.id, target.id))?.role.code, "ACCOUNTANT");
    assert.equal((await request("/companies/invitations/accept", { cookie: target.cookie, body: { token } })).status, 400);
    const duplicateMembershipInvitation = await invite(owner.cookie, target.email, "VIEWER_AUDITOR"); assert.equal(duplicateMembershipInvitation.status, 201);
    assert.equal((await request("/companies/invitations/accept", { cookie: target.cookie, body: { token: duplicateMembershipInvitation.body.data.developmentInvitationToken } })).status, 409);
    assert.equal((await membership(company.id, target.id))?.role.code, "ACCOUNTANT");
    const expired = await invite(owner.cookie, other.email, "VIEWER_AUDITOR"); assert.equal(expired.status, 201);
    await prisma.companyInvitation.update({ where: { tokenHash: tokenDigest(expired.body.data.developmentInvitationToken!) }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await request("/companies/invitations/accept", { cookie: other.cookie, body: { token: expired.body.data.developmentInvitationToken } })).status, 400);
    assert.equal(await membership(company.id, other.id), null);
  });

  it("requires verified matching email before invitation acceptance", async () => {
    const owner = await account("unverified-invite-owner"); const company = await createCompany(owner.cookie, "Verified Invite Company");
    const unverified = await account("unverified-target", false); const invitation = await invite(owner.cookie, unverified.email, "VIEWER_AUDITOR");
    assert.equal(invitation.status, 201);
    const expiredVerification = newOpaqueToken();
    const expiredVerificationRow = await prisma.emailVerificationToken.create({ data: { tokenHash: tokenDigest(expiredVerification), userId: unverified.id, expiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await request("/auth/verify-email/confirm", { body: { token: expiredVerification, password } })).status, 400);
    assert.equal((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: expiredVerificationRow.id } })).usedAt, null);
    const response = await request("/companies/invitations/accept", { cookie: unverified.cookie, body: { token: invitation.body.data.developmentInvitationToken } });
    assert.equal(response.status, 403); assert.equal(await membership(company.id, unverified.id), null);
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: new Date() } });
    const accepted = await request("/companies/invitations/accept", { cookie: unverified.cookie, body: { token: invitation.body.data.developmentInvitationToken } });
    assert.equal(accepted.status, 201);
  });

  it("revalidates company context across two admin companies and rejects previous-company membership IDs", async () => {
    const admin = await account("dual-admin"); const companyA = await createCompany(admin.cookie, "Dual Admin A");
    const createdB = await request<{ data: { company: { id: string } } }>("/companies", { cookie: admin.cookie, body: { name: "Dual Admin B" } });
    assert.equal(createdB.status, 201); const companyB = createdB.body.data.company; companyIds.push(companyB.id);
    assert.equal((await request("/companies/switch", { cookie: admin.cookie, body: { companyId: companyA.id } })).status, 200);
    const employee = await account("dual-employee"); const employeeInvite = await invite(admin.cookie, employee.email, "VIEWER_AUDITOR");
    assert.equal(employeeInvite.status, 201); assert.equal((await request("/companies/invitations/accept", { cookie: employee.cookie, body: { token: employeeInvite.body.data.developmentInvitationToken } })).status, 201);
    const recordInA = await membership(companyA.id, employee.id); assert.ok(recordInA);
    assert.equal((await request("/companies/switch", { cookie: admin.cookie, body: { companyId: companyB.id } })).status, 200);
    const current = await request<{ data: { company: { id: string } } }>("/companies/current?companyId=" + companyA.id, { cookie: admin.cookie });
    assert.equal(current.status, 200); assert.equal(current.body.data.company.id, companyB.id);
    const crossRecord = await request(`/companies/members/${recordInA.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "SUSPENDED" } });
    assert.equal(crossRecord.status, 404); assert.equal((await membership(companyA.id, employee.id))?.status, "ACTIVE");
  });

  it("immediately clears suspended membership context", async () => {
    const owner = await account("suspension-owner"); const company = await createCompany(owner.cookie, "Suspension Company");
    const employee = await account("suspended-member"); const role = await prisma.companyRole.findUniqueOrThrow({ where: { companyId_code: { companyId: company.id, code: "VIEWER_AUDITOR" } } });
    const member = await prisma.companyMembership.create({ data: { userId: employee.id, companyId: company.id, roleId: role.id } });
    assert.equal((await request("/companies/switch", { cookie: employee.cookie, body: { companyId: company.id } })).status, 200);
    const deactivated = await request("/companies/current/status", { method: "PATCH", cookie: owner.cookie, body: { active: false } }); assert.equal(deactivated.status, 200);
    const afterDeactivation = await request<{ data: { activeCompanyId: string | null } }>("/auth/me", { cookie: employee.cookie }); assert.equal(afterDeactivation.body.data.activeCompanyId, null);
    assert.equal((await request("/companies/switch", { cookie: employee.cookie, body: { companyId: company.id } })).status, 403);
    assert.equal((await request(`/companies/${company.id}/status`, { method: "PATCH", cookie: owner.cookie, body: { active: true } })).status, 200);
    assert.equal((await request("/companies/switch", { cookie: employee.cookie, body: { companyId: company.id } })).status, 200);
    await prisma.companyMembership.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });
    const me = await request<{ data: { activeCompanyId: string | null } }>("/auth/me", { cookie: employee.cookie });
    assert.equal(me.status, 200); assert.equal(me.body.data.activeCompanyId, null);
    assert.equal((await request("/companies/switch", { cookie: employee.cookie, body: { companyId: company.id } })).status, 403);
  });

  it("expires a session server-side and revokes the expired database session", async () => {
    const user = await account("session-expiry");
    const session = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: tokenDigest(decodeURIComponent(user.cookie.split("=")[1])) } });
    await prisma.authSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const response = await request("/auth/me", { cookie: user.cookie }); assert.equal(response.status, 401);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
  });

  it("keeps reset responses generic without explicit development exposure and enforces expiry, reuse and session revocation", async () => {
    const target = await account("reset-target");
    const originalFlag = process.env.AUTH_DEV_EXPOSE_TOKENS;
    process.env.AUTH_DEV_EXPOSE_TOKENS = "false";
    const known = await request<{ data: { message: string; developmentResetToken?: string } }>("/auth/forgot-password", { body: { email: target.email } });
    const unknown = await request<{ data: { message: string; developmentResetToken?: string } }>("/auth/forgot-password", { body: { email: `unknown-${randomUUID()}@example.test` } });
    assert.equal(known.status, 202); assert.equal(unknown.status, 202); assert.equal(known.body.data.message, unknown.body.data.message);
    assert.equal(known.body.data.developmentResetToken, undefined); assert.equal(await prisma.passwordResetToken.count({ where: { userId: target.id } }), 0);
    process.env.AUTH_DEV_EXPOSE_TOKENS = "true";
    const issued = await request<{ data: { developmentResetToken?: string } }>("/auth/forgot-password", { body: { email: target.email } });
    assert.equal(issued.status, 202); const token = issued.body.data.developmentResetToken!; assert.ok(token);
    const stored = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: tokenDigest(token) } }); assert.notEqual(stored.tokenHash, token);
    const secondValidToken = newOpaqueToken();
    const secondTokenRow = await prisma.passwordResetToken.create({ data: { tokenHash: tokenDigest(secondValidToken), userId: target.id, expiresAt: new Date(Date.now() + 60_000) } });
    const expiredToken = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { tokenHash: tokenDigest(expiredToken), userId: target.id, expiresAt: new Date(Date.now() - 1_000) } });
    assert.equal((await request("/auth/reset-password", { body: { token: expiredToken, password: "Expired-Reset-Password-98!" } })).status, 400);
    const reset = await request("/auth/reset-password", { body: { token, password: "New-Correct-Password-73!" } }); assert.equal(reset.status, 200);
    assert.ok((await prisma.authSession.findMany({ where: { userId: target.id } })).every(session => session.revokedAt !== null));
    assert.ok((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: secondTokenRow.id } })).usedAt);
    assert.equal((await request("/auth/me", { cookie: target.cookie })).status, 401);
    assert.equal((await request("/auth/reset-password", { body: { token, password: "Another-Correct-Password-73!" } })).status, 400);
    process.env.AUTH_DEV_EXPOSE_TOKENS = originalFlag;
  });

  it("applies authentication rate limits", async () => {
    const email = `phase1-rate-${randomUUID()}@example.test`;
    const responses: number[] = [];
    for (let index = 0; index < 13; index += 1) responses.push((await request("/auth/forgot-password", { body: { email } })).status);
    assert.equal(responses.filter(status => status === 202).length, 12);
    assert.equal(responses[12], 429);
  });
});
