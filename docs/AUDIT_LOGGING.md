# Audit Logging

## Data model

`AuditEvent` stores append-only event records. `actorUserId` and `companyId` are nullable scalar snapshots without foreign keys so historical identifiers remain available after related records are removed.

## Write rules

- Successful sensitive company mutations write their audit event through the same Prisma transaction client as the business mutation. An audit insert failure therefore rolls back that mutation.
- Failed login and authorization-denial events use a separate durable write because the rejected operation has no successful business transaction.
- Metadata is recursively filtered for keys that resemble passwords, secrets, tokens, cookies, authorization data, API keys, credentials, sessions, OTPs, codes, challenges, continuation credentials, or HMAC keys. Enumerated role codes remain available as authorization metadata. Values and collection sizes are bounded.
- Existing audit event paths use the direct socket peer. Registration events use Express’s resolved client IP and trust forwarded entries only from the configured proxy networks.
- Application code exposes an insert-only audit service. Database-level insert-only privileges remain a production-hardening task and must be applied using a separately reviewed database-role migration.

## Current event coverage

Registration request creation and duplicate rejection, owner notification acceptance/failure, resend, failed confirmation, OTP expiry/exhaustion, approval, login success/failure, logout, email verification, password reset, company creation/update/status/archive, invitation creation/acceptance/revocation/delivery failure, membership updates, role updates, and permission denials.

## Limitations

Invitation delivery failures retain the invitation row with `revokedAt` set and write an `INVITATION_DELIVERY_FAILED` event with outcome `FAILURE` in the same transaction. Session expiry/revocation outside explicit logout, invitation cleanup scheduling, and database-enforced append-only permissions require further hardening. Audit records do not yet have a user-facing search/export API.
