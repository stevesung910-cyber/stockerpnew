import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { gmailConfiguration, GMAIL_CALLBACK_PATH, GMAIL_SCOPE, isGmailOwner } from "./gmail-config";
import { codeChallenge, codeVerifier, decryptRefreshToken, encryptRefreshToken, KEY_VERSION, newState, stateDigest } from "./gmail-crypto";
import { gmailMime } from "./gmail-mime";
import { authorizationUrl, createGoogleGmailClient } from "./google-client";

const testSender = "stock-approval@example.test";

function settings() {
  return {
    EMAIL_DELIVERY_PROVIDER: "google-gmail", GOOGLE_OAUTH_CLIENT_ID: "test-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "mock-client-secret", GOOGLE_GMAIL_SENDER_EMAIL: testSender,
    GOOGLE_OAUTH_REDIRECT_URI: `http://localhost:4000${GMAIL_CALLBACK_PATH}`,
    FRONTEND_ORIGIN: "http://localhost:5173", SOFTWARE_OWNER_USER_ID: "existing-owner",
    GOOGLE_OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"), REGISTRATION_OWNER_EMAIL: testSender,
  };
}

test("Gmail startup configuration and owner identity fail closed", () => {
  const env = settings();
  for (const key of Object.keys(env)) {
    const missing = { ...env };
    delete missing[key as keyof typeof missing];
    if (key !== "EMAIL_DELIVERY_PROVIDER") assert.throws(() => gmailConfiguration(missing), new RegExp(key));
  }
  assert.throws(() => gmailConfiguration({ ...env, NODE_ENV: "production" }), /HTTPS/);
  assert.throws(() => gmailConfiguration({ ...env, GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI + "?x=1" }), /exact/);
  assert.throws(() => gmailConfiguration({ ...env, OWNER_REGISTRATION_OTP_HMAC_SECRET: env.GOOGLE_OAUTH_ENCRYPTION_KEY }), /independent/);
  assert.throws(() => gmailConfiguration({ ...env, DATABASE_URL: `postgresql://app:${env.GOOGLE_OAUTH_ENCRYPTION_KEY}@localhost/stockerp` }), /independent/);
  assert.throws(() => gmailConfiguration({ ...env, GOOGLE_GMAIL_SENDER_EMAIL: "other@gmail.com" }), /match after normalization/);
  assert.equal(isGmailOwner({ userId: "existing-owner", emailVerified: true }, env), true);
  assert.equal(isGmailOwner({ userId: "existing-owner", emailVerified: false }, env), false);
  assert.equal(isGmailOwner({ userId: "tenant-owner", emailVerified: true }, env), false);
});

test("sender and owner configuration use strict mailbox validation and normalize case", () => {
  const env = settings();
  const alternate = "another-sender@example.test";
  assert.equal(gmailConfiguration({ ...env, GOOGLE_GMAIL_SENDER_EMAIL: alternate.toUpperCase(),
    REGISTRATION_OWNER_EMAIL: alternate })?.senderEmail, alternate);
  for (const name of ["GOOGLE_GMAIL_SENDER_EMAIL", "REGISTRATION_OWNER_EMAIL"]) {
    for (const value of [" user@example.test", "user@example.test ", "user@exam ple.test", "user@example.test\n",
      "user@exa\u200bmple.test", "a..b@example.test", "name <user@example.test>", "user@-example.test"]) {
      assert.throws(() => gmailConfiguration({ ...env, [name]: value }), new RegExp(name));
    }
  }
});

test("OAuth uses random state, S256, exact redirect URI and only send and identity scopes", () => {
  const config = gmailConfiguration(settings())!;
  const state = newState();
  assert.match(state, /^[\w-]{43}$/);
  assert.notEqual(state, newState());
  assert.notEqual(state, stateDigest(state));
  const verifier = codeVerifier(state, config.encryptionKey);
  const url = new URL(authorizationUrl(config, state, verifier));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("code_challenge"), codeChallenge(verifier));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), `openid email ${GMAIL_SCOPE}`);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.ok(!url.toString().includes(config.clientSecret));
});

test("refresh tokens use randomized authenticated encryption bound to the OAuth client and sender", () => {
  const config = gmailConfiguration(settings())!;
  const token = "mock-plain-refresh-token";
  const envelope = encryptRefreshToken(token, config);
  assert.ok(!envelope.includes(token));
  assert.notEqual(encryptRefreshToken(token, config), envelope);
  assert.equal(decryptRefreshToken(envelope, KEY_VERSION, config), token);
  assert.throws(() => decryptRefreshToken(envelope, KEY_VERSION, gmailConfiguration(settings())!), /^Error: Gmail credential could not be decrypted\.$/);
  assert.throws(() => decryptRefreshToken(envelope, KEY_VERSION, { ...config, clientId: "other-client" }));
  assert.throws(() => decryptRefreshToken(envelope, 99, config));
  const modified = Buffer.from(envelope, "base64url");
  modified[16] ^= 1;
  assert.throws(() => decryptRefreshToken(modified.toString("base64url"), KEY_VERSION, config));
});

test("MIME safeguards addressing and encodes UTF-8 and CRLF", () => {
  const message = { to: "owner+test@example.com", subject: "Récépissé 📬", text: "Première ligne\nDeuxième ligne" };
  const raw = gmailMime(testSender, message);
  assert.match(raw, /^[\w-]+$/);
  const [headers, body] = Buffer.from(raw, "base64url").toString().split("\r\n\r\n");
  assert.match(headers, new RegExp(`From: ${testSender}`));
  assert.match(headers, /^To: owner\+test@example\.com$/m);
  const subject = headers.match(/Subject: =\?UTF-8\?B\?([\w+/=]+)\?=/)?.[1];
  assert.ok(subject);
  assert.equal(Buffer.from(subject, "base64").toString(), message.subject);
  assert.equal(Buffer.from(body, "base64").toString(), message.text.replace("\n", "\r\n"));
  for (const to of ["a..b@example.com", "x@example.com\r\nBcc: a@example.com", "a@-example.com", "a@example.com, b@example.com"]) {
    assert.throws(() => gmailMime(testSender, { ...message, to }), /Invalid Gmail recipient/);
  }
  assert.throws(() => gmailMime(testSender, { ...message, subject: "subject\r\nBcc: a@example.com" }), /Invalid Gmail message subject/);
});

test("Google token exchanges verify sender, reject missing grants, and redact remote errors", async t => {
  const config = gmailConfiguration(settings())!;
  const client = createGoogleGmailClient();
  const credentials = { access_token: "mock-access-secret", refresh_token: "mock-refresh-secret", scope: GMAIL_SCOPE };
  let tokenResponse: Record<string, unknown> = credentials;
  let tokenStatus = 200;
  let email = testSender;
  let verified = true;
  const fetch = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (url.endsWith("/token")) {
      const body = init.body as URLSearchParams;
      assert.equal(body.get("client_secret"), config.clientSecret);
      if (body.get("grant_type") === "authorization_code") {
        assert.equal(body.get("code_verifier"), "verifier");
        assert.equal(body.get("redirect_uri"), config.redirectUri);
      } else assert.equal(body.get("refresh_token"), credentials.refresh_token);
      return Response.json(tokenResponse, { status: tokenStatus });
    }
    if (url.endsWith("/revoke")) {
      assert.equal((init.body as URLSearchParams).get("token"), credentials.refresh_token);
      return Response.json(tokenResponse, { status: tokenStatus });
    }
    assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${credentials.access_token}`);
    return Response.json({ email, email_verified: verified });
  });

  assert.equal(await client.authorize("mock-code", "verifier", config), credentials.refresh_token);
  tokenResponse = { access_token: credentials.access_token, refresh_token: credentials.refresh_token };
  assert.equal(await client.authorize("mock-code", "verifier", config), credentials.refresh_token);
  email = "other@gmail.com";
  await assert.rejects(client.authorize("mock-code", "verifier", config), /^Error: SENDER_MISMATCH$/);
  email = testSender;
  verified = false;
  await assert.rejects(client.authorize("mock-code", "verifier", config), /^Error: SENDER_MISMATCH$/);
  tokenResponse = { ...credentials, refresh_token: undefined };
  await assert.rejects(client.authorize("mock-code", "verifier", config), /^Error: MISSING_REFRESH_TOKEN$/);
  tokenResponse = { ...credentials, scope: "openid email" };
  await assert.rejects(client.authorize("mock-code", "verifier", config), /^Error: SEND_SCOPE_MISSING$/);
  tokenResponse = credentials;
  assert.deepEqual(await client.refresh(credentials.refresh_token, config), { accessToken: credentials.access_token, refreshToken: credentials.refresh_token });
  tokenResponse = { error: "invalid_grant", error_description: credentials.refresh_token };
  tokenStatus = 400;
  await assert.rejects(client.authorize("mock-code", "verifier", config), /^Error: EXCHANGE_FAILED$/);
  await assert.rejects(client.refresh(credentials.refresh_token, config), /^Error: TOKEN_REVOKED$/);
  await assert.rejects(client.revoke(credentials.refresh_token), /^Error: REVOCATION_FAILED$/);
  tokenResponse = { error: "invalid_token" };
  await client.revoke(credentials.refresh_token);
  assert.equal(fetch.mock.callCount(), 15);
});

test("Gmail send requires acceptance and avoids duplicate retry and credential disclosure", async () => {
  let sends = 0;
  const client = createGoogleGmailClient(() => ({ users: { messages: {
    async send(params, options) {
      assert.deepEqual(params, { userId: "me", requestBody: { raw: "mock-MIME" } });
      assert.equal(options.headers.authorization, "Bearer private-access-token");
      assert.equal(options.retry, false);
      assert.equal(options.redirect, "error");
      assert.equal(options.universeDomain, "googleapis.com");
      assert.ok(options.timeout <= 10_000);
      sends++;
      if (sends === 1) return { status: 200, data: { id: "accepted" } };
      if (sends === 2) return { status: 200, data: {} };
      throw new Error("private-access-token embedded in remote error");
    },
  } } }));
  await client.send("private-access-token", "mock-MIME");
  await assert.rejects(client.send("private-access-token", "mock-MIME"), /^Error: SEND_FAILED$/);
  await assert.rejects(client.send("private-access-token", "mock-MIME"), /^Error: SEND_FAILED$/);
  assert.equal(sends, 3);
});
