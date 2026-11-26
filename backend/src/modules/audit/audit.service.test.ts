import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeAuditMetadata } from "./audit.service";

describe("audit metadata sanitization", () => {
  it("removes credential and session-like keys recursively", () => {
    const clean = sanitizeAuditMetadata({
      actor: "user-1",
      password: "must-not-appear",
      nested: { accessToken: "must-not-appear", department: "Finance", cookie: "secret", otp: "secret", code: "secret", challengeVersion: "secret", hmacSecret: "secret", continuationCredential: "secret", continuationHash: "secret", codeValue: "secret", roleCode: "COMPANY_ADMIN" },
    });
    assert.deepEqual(clean, { actor: "user-1", nested: { department: "Finance", roleCode: "COMPANY_ADMIN" } });
  });

  it("bounds strings and arrays", () => {
    const clean = sanitizeAuditMetadata({ value: "x".repeat(900), list: Array.from({ length: 70 }, (_, index) => index) }) as Record<string, unknown>;
    assert.equal((clean.value as string).length, 500);
    assert.equal((clean.list as unknown[]).length, 50);
  });
});
