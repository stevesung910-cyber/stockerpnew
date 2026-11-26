# Owner-controlled registration approval

Registration collects the client's name, email, and password. StockERP reserves the normalized email on a pending request for up to 24 hours. The software owner receives an eight-digit approval code and a request reference. The owner identifies the requester through a trusted channel before sharing the code. The client enters the code in the open registration screen. After approval, the client signs in and creates or selects a company.

An approved registration does not prove mailbox ownership or grant membership in any existing company. Invitation acceptance still requires a verified matching email. Email-based password recovery requires a verified mailbox both when the link is requested and when it is redeemed. A signed-in user can verify their email from the workspace profile. Verification links require the current password at redemption.

## Configuration and delivery

- Set `REGISTRATION_OWNER_EMAIL` to the deployment's software owner, for example `stephensunrise@gmail.com`. Enable MFA for that mailbox.
- For Gmail SMTP, use the backend SMTP settings in `.env.example`. Keep `SMTP_PASS` in your private backend environment and use a Google App Password. Run `npm run check:smtp` from the repository root to check STARTTLS and authentication without sending a message. Run `npm run test:smtp` to exercise registration OTP delivery with a mocked SMTP transport. [Google App Passwords](https://support.google.com/accounts/answer/185833).
- For the HTTP provider, set `EMAIL_DELIVERY_PROVIDER=http`, `EMAIL_PROVIDER_URL` and `EMAIL_PROVIDER_API_KEY` for the existing JSON email adapter. The endpoint receives a bearer-authenticated POST with `to`, `subject`, and `text`. Production requires HTTPS. Redirects are rejected and a dispatch has a ten-second timeout. Configure the provider to redact message bodies and credentials from logs.
- Provision `OWNER_REGISTRATION_OTP_HMAC_SECRET` from the deployment secret manager. Generate 32 random bytes encoded as 64 hex characters, for example with `openssl rand -hex 32`. Use the same dedicated key on all backend instances. Coordinate key rotation across instances. Rotation invalidates outstanding codes, and the original registration screen can request a fresh code after the cooldown.
- Set `TRUSTED_PROXY_NETWORKS` only when behind reverse proxies. List the exact trusted proxy IPs or CIDRs and restrict direct access to the backend. Leave it unset for direct connections.
- The registration code is never returned through the API, including local development. Use a controlled test mail adapter, and keep request bodies, response bodies, and mail payloads out of telemetry and access logs. The registration approval screen keeps its continuation credential in memory. A reload or closed tab loses that credential. The owner can advise the requester to wait for the existing reservation to expire before starting over.

A provider success audit records acceptance by the configured provider. A failure or process interruption leaves the challenge unusable until a resend succeeds. Dispatch runs after the response and keeps the code only in memory before handing it to the provider. There is no durable message queue containing codes and no automatic retry. A prolonged provider outage, owner mailbox issue, or exhausted request needs owner support. An exhausted request can be started again after its reservation expires.

## Policies and storage

Codes expire five minutes after issuance. Five failed attempts exhaust the request. A replacement requires a 60-second cooldown, invalidates the previous challenge, and preserves the failed-attempt budget. Confirmation and resend serialize on the request row. Successful confirmation atomically consumes the challenge, creates the user, and audits approval. The request stores password, continuation, and code digests only. Approval clears those values and releases the email reservation.

Registration and resend each permit ten requests per IP per 15 minutes, and confirmation permits thirty. The pending-email reservation prevents repeated sends for duplicate submissions. Dispatch also shares a limit of 120 owner notifications per hour. All backend instances use the same PostgreSQL rate-limit table. Provision the application database role with the read and write privileges needed for both new tables. Registration also deletes its own just-inserted reservation if a concurrent approval won the email race, so grant DELETE on the registration table. Use a scheduled maintenance role with DELETE privileges for cleanup.

Run bounded cleanup batches from a scheduled maintenance job. Retain closed request records for the approved operational retention period. The examples use seven days for consumed requests and reclaim expired pending requests promptly. Keep audit records under the existing audit retention policy. Review the affected rows and run this only in the intended environment.

```sql
DELETE FROM "RegistrationRequest" WHERE "id" IN (
  SELECT "id" FROM "RegistrationRequest"
  WHERE ("consumedAt" IS NULL AND "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
     OR "consumedAt" < (clock_timestamp() AT TIME ZONE 'UTC') - interval '7 days'
  ORDER BY "expiresAt" LIMIT 500 FOR UPDATE SKIP LOCKED
);
DELETE FROM "AuthRateLimitBucket" WHERE "key" IN (
  SELECT "key" FROM "AuthRateLimitBucket"
  WHERE "expiresAt" < (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 hour'
  ORDER BY "expiresAt" LIMIT 500 FOR UPDATE SKIP LOCKED
);
```

## Legacy accounts and session impact

The additive migration classifies users based on existing database facts. Each pre-migration user is tagged as legacy, with `ownerApprovedAt` left null. An active legacy user with an existing `emailVerifiedAt` is eligible as `LEGACY_VERIFIED`. An active user with `ownerApprovedAt` is eligible as `OWNER_APPROVED`. Inactive users remain ineligible.

**Session impact at rollout:** sessions for active, verified legacy users are preserved subject to normal expiry, revocation, and membership checks. Existing sessions for unverified legacy users are rejected and revoked when presented, because those sessions were issued before the eligibility requirement. First-time legacy verification also revokes any remaining sessions for that previously unverified user, so a pre-verification cookie cannot become valid after verification. The migration does not bulk-revoke sessions.

An unverified legacy user can select **Verify an existing account** from sign-in, submit their existing credentials, and redeem the 24-hour link with their current password. They then sign in with the same account and retain their existing memberships. If they cannot supply the password or access the mailbox, an authorized operator must use the organization's identity recovery process. Existing memberships or approval must never be transferred solely on the strength of an unverified email.

Before rollout, verify the actual status of `stephen@gmail.com` under a read-only database transaction. Its eligibility follows this same policy. The address is distinct from the notification mailbox.

```sql
BEGIN READ ONLY;
SELECT u.email, u.active, u."emailVerifiedAt" IS NOT NULL AS email_verified,
       (SELECT count(*) FROM "CompanyMembership" m WHERE m."userId" = u.id) AS memberships,
       (SELECT count(*) FROM "AuthSession" s WHERE s."userId" = u.id
        AND s."revokedAt" IS NULL AND s."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')) AS live_sessions
FROM "User" u
WHERE lower(btrim(u.email)) = 'stephen@gmail.com';
ROLLBACK;
```

## Migration and rollback runbook

1. Confirm the target database and inspect account counts grouped by active and verification status, live sessions, and normalized email duplicates. Check the configured mail provider with a controlled inbox. Schedule the migration for a maintenance window because creating the normalized email index takes a table lock.
2. Take an encrypted PostgreSQL backup using the deployment backup process. Check its archive and restore it to an isolated rehearsal database. Record the backup and restore points. Run Phase 1 and Phase 2 against the configured isolated `_test` database before promotion.
3. Drain old API instances. Apply the additive migration through the authorized migration role during deployment and regenerate the Prisma client for the release. Roll out the backend and frontend together. Do not allow old registration binaries to run against the migrated schema.
4. Smoke-test legacy login and sessions, owner-only notification, approval, login, company creation, and an invitation requiring verified email. Monitor provider API acceptance and failures, rate-limit responses, and approval outcomes.
5. If rollback is needed, pause registration and deploy a schema-compatible build that retains the eligibility checks and can read both user cohorts. If no such build is available, keep affected endpoints offline until a compatible build is ready. Retain additive tables and fields during application rollback. A database restore is a separately approved disaster-recovery action because it can discard data written after the backup.

Implementation verification uses `npm run test:phase1` and `npm run test:phase2`. The test runner checks the `_test` suffix before applying migrations. Never use schema reset or a development or production target to run integration tests.
