import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpEmailDeliveryProvider } from "./email-delivery";
import { accountEligibility } from "./account-eligibility";
import { registrationConfiguration, mayExposeDevelopmentTokens, validateRuntimeEnvironment } from "../../config/env";
import { sessionCookieOptionsFor } from "./cookie-config";
import { roleIsAssignable } from "../companies/role-authorization";
import { InMemoryRateLimitStore } from "./rate-limit";

describe("security configuration and role policy", () => {
  it("fails closed for missing or non-development reset-token environment settings", () => {
    assert.equal(mayExposeDevelopmentTokens({ APP_ENV: "development", NODE_ENV: "development", AUTH_DEV_EXPOSE_TOKENS: "true" }), true);
    assert.equal(mayExposeDevelopmentTokens({ APP_ENV: "development", AUTH_DEV_EXPOSE_TOKENS: "true" }), false);
    assert.equal(mayExposeDevelopmentTokens({ APP_ENV: "production", NODE_ENV: "production", AUTH_DEV_EXPOSE_TOKENS: "true" }), false);
    assert.equal(mayExposeDevelopmentTokens({ NODE_ENV: "production", AUTH_DEV_EXPOSE_TOKENS: "true" }), false);
    assert.equal(mayExposeDevelopmentTokens({ APP_ENV: "development", NODE_ENV: "test", AUTH_DEV_EXPOSE_TOKENS: "true" }), false);
    assert.equal(mayExposeDevelopmentTokens({}), false);
  });

  it("requires explicit secure production startup configuration", () => {
    assert.throws(() => validateRuntimeEnvironment({ NODE_ENV: "production", FRONTEND_ORIGIN: "https://erp.example", DATABASE_URL: "postgresql://db" }), /APP_ENV=production and NODE_ENV=production/);
    assert.throws(() => validateRuntimeEnvironment({ APP_ENV: "production", FRONTEND_ORIGIN: "https://erp.example", DATABASE_URL: "postgresql://db" }), /APP_ENV=production and NODE_ENV=production/);
    assert.throws(() => validateRuntimeEnvironment({ APP_ENV: "production", NODE_ENV: "production", FRONTEND_ORIGIN: "http://erp.example", DATABASE_URL: "postgresql://db" }), /HTTPS/);
    assert.throws(() => validateRuntimeEnvironment({ APP_ENV: "production", NODE_ENV: "production", FRONTEND_ORIGIN: "https://erp.example", DATABASE_URL: "postgresql://db", AUTH_DEV_EXPOSE_TOKENS: "true" }), /cannot be enabled/);
    assert.throws(() => validateRuntimeEnvironment({ APP_ENV: "production", NODE_ENV: "production", FRONTEND_ORIGIN: "https://erp.example", DATABASE_URL: "postgresql://db", AUTH_DEV_EXPOSE_TOKENS: "false" }), /EMAIL_PROVIDER_URL and EMAIL_PROVIDER_API_KEY are required/);
    assert.doesNotThrow(() => validateRuntimeEnvironment({ APP_ENV: "production", NODE_ENV: "production", FRONTEND_ORIGIN: "https://erp.example", DATABASE_URL: "postgresql://db", EMAIL_PROVIDER_URL: "https://mail.example/api", EMAIL_PROVIDER_API_KEY: "test-only", REGISTRATION_OWNER_EMAIL: "owner@example.test", OWNER_REGISTRATION_OTP_HMAC_SECRET: "ab".repeat(32), AUTH_DEV_EXPOSE_TOKENS: "false" }));
  });

  it("requires an explicit owner address and a dedicated hex key", () => {
    assert.throws(() => registrationConfiguration({}), /REGISTRATION_OWNER_EMAIL/);
    assert.throws(() => registrationConfiguration({ REGISTRATION_OWNER_EMAIL: "owner@example.test", OWNER_REGISTRATION_OTP_HMAC_SECRET: "short" }), /HMAC_SECRET/);
    assert.equal(registrationConfiguration({ REGISTRATION_OWNER_EMAIL: "owner@example.test", OWNER_REGISTRATION_OTP_HMAC_SECRET: "ab".repeat(32) }).hmacKey.length, 32);
  });

  it("distinguishes owner approval from verified legacy access", () => {
    const pending = { active: true, legacyRegistration: false, ownerApprovedAt: null, emailVerifiedAt: null };
    const date = new Date();
    assert.equal(accountEligibility(pending), null);
    assert.equal(accountEligibility({ ...pending, ownerApprovedAt: date }), "OWNER_APPROVED");
    assert.equal(accountEligibility({ ...pending, emailVerifiedAt: date }), null);
    assert.equal(accountEligibility({ ...pending, legacyRegistration: true, emailVerifiedAt: date }), "LEGACY_VERIFIED");
    assert.equal(accountEligibility({ ...pending, active: false, ownerApprovedAt: date }), null);
  });

  it("uses the configured email endpoint with redirects disabled and a bounded request", async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 202 }));
    const provider = new HttpEmailDeliveryProvider("https://provider.example/send", "test-only-key");
    const message = { to: "owner@example.test", subject: "Approval", text: "Message body" };
    await provider.send(message);
    const [endpoint, options] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
    assert.equal(endpoint, "https://provider.example/send");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(options.body)), message);
    fetchMock.mock.mockImplementation(async () => new Response("provider data", { status: 503 }));
    await assert.rejects(() => provider.send(message), /^Error: Email provider returned HTTP 503\.$/);
  });

  it("keeps production and unspecified cookies Secure, HttpOnly and SameSite=Lax", () => {
    const development = sessionCookieOptionsFor("development", "development");
    const production = sessionCookieOptionsFor("production", "production");
    const originalAppEnv = process.env.APP_ENV; const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.APP_ENV; delete process.env.NODE_ENV;
    const missing = sessionCookieOptionsFor();
    process.env.APP_ENV = "development"; delete process.env.NODE_ENV;
    const missingNodeEnvironment = sessionCookieOptionsFor();
    if (originalAppEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = originalAppEnv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    assert.equal(development.secure, false);
    for (const cookie of [production, missing, missingNodeEnvironment]) {
      assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "lax");
    }
  });

  it("restricts role assignment to the caller's authority and reserves Super Admin", () => {
    const hrPermissions = ["dashboard.view", "users.view", "users.create", "users.edit"];
    assert.equal(roleIsAssignable("HR_MANAGER", hrPermissions, "COMPANY_ADMIN", hrPermissions), false);
    assert.equal(roleIsAssignable("HR_MANAGER", hrPermissions, "SUPER_ADMIN", hrPermissions), false);
    assert.equal(roleIsAssignable("SALES_EXECUTIVE", ["sales.view"], "COMPANY_ADMIN", ["sales.view"]), false);
    assert.equal(roleIsAssignable("COMPANY_ADMIN", ["users.create", "users.edit", "company.view"], "STORE_KEEPER", ["users.create"]), true);
    assert.equal(roleIsAssignable("COMPANY_ADMIN", ["users.create"], "ACCOUNTANT", ["accounting.view"]), false);
    assert.equal(roleIsAssignable("COMPANY_ADMIN", ["users.create", "users.edit"], "SUPER_ADMIN", ["users.create"]), false);
  });

  it("enforces atomic process-local rate windows and reports retry time", async () => {
    const store = new InMemoryRateLimitStore();
    assert.deepEqual(await store.consume("login", 2, 1_000, 10_000), { allowed: true, retryAfterSeconds: 0 });
    assert.equal((await store.consume("login", 2, 1_000, 10_001)).allowed, true);
    assert.deepEqual(await store.consume("login", 2, 1_000, 10_100), { allowed: false, retryAfterSeconds: 1 });
    assert.equal((await store.consume("login", 2, 1_000, 11_001)).allowed, true);
  });
});
