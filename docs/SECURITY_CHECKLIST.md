# Phase 1 Security Checklist

Status recorded during remediation; items marked pending require the isolated PostgreSQL test database and final migration run.

## Authentication and account ownership

- [x] Password reset token disclosure requires explicit development labels and opt-in.
- [x] Production rejects development token exposure and validates HTTPS origins, database URL, and email provider configuration.
- [x] Sessions remain HttpOnly, SameSite=Lax, eight-hour, digest-backed; Secure is default unless both environment labels agree on local mode.
- [x] Registration creates a pending request. Approval creates the user without granting a session or membership.
- [x] Email verification and reset tokens are random, hashed at rest, expiring and single-use.
- [x] Reset revokes all sessions and other live reset tokens.
- [x] Email delivery has a provider-independent HTTPS JSON boundary; delivery failure is not reported as success.
- [ ] Integration verification of token expiry, reuse, and session revocation.

## Company authorization and role assignment

- [x] Invitations defer membership creation until acceptance by the verified matching email.
- [x] Invitation creator authority, target role permissions, company status, expiry, token use and email ownership are checked on acceptance.
- [x] Self-role changes and self-invitations are blocked.
- [x] Company Admin role assignment requires current Company Admin authority and permission ceiling.
- [x] The reserved seeded `SUPER_ADMIN` role cannot be granted or edited by company membership APIs.
- [x] Membership IDs and role IDs are scoped by active company and company-owned role relationship constraints.
- [x] Company switching revalidates active membership and company status in the session update transaction.
- [ ] Integration verification of escalation denials, no-mutation behavior, multi-company context and revocation.

## Database and tenant boundaries

- [x] `stockerp` pre-change backup created and archive listing verified.
- [x] Test runner requires `DATABASE_URL_TEST`, `_test` database suffix, and a database distinct from `DATABASE_URL`.
- [x] Test runner deploys tracked migrations only to the checked test DB and cleanup uses explicit created IDs.
- [x] No table reset, truncate, global permission cleanup, or database ownership/grant change is used.
- [x] Runtime/migration connection separation is prepared through `DATABASE_URL` and a `DATABASE_URL_MIGRATION` deploy wrapper.
- [x] RLS and transaction-local tenant context strategy documented; no speculative policy is applied to nonexistent business tables.
- [ ] A `stockerp_test` URL is configured, but its live database identity and migration state could not be checked because PostgreSQL was unavailable.
- [ ] Additive migration deployment and test database verification.
- [ ] Runtime PostgreSQL privilege separation remains unapplied and requires separate approval.

## Browser and operations

- [x] Central API handling clears browser query cache and routes 401 responses to login.
- [x] Logout and company switching signal other tabs; company permissions are refreshed after switching.
- [x] Navigation is filtered by current server-provided permissions; backend checks remain authoritative.
- [x] CSRF origin guard remains active for cookie-authenticated writes.
- [x] In-memory rate limiting is abstracted behind an atomic `RateLimitStore` contract; multi-instance shared implementation is not included.
- [ ] Final production build and frontend session-flow verification.
# Phase 2 inventory controls (implementation present; PostgreSQL verification pending)

- [x] Server derives active company from authenticated membership; inventory API queries are company-scoped.
- [x] Tenant relations use composite company keys where modeled; database migration adds hierarchy and lifecycle triggers.
- [x] Routes check server-side permissions. `inventory.negative_stock_override`, `finance.period_reopen` and `inventory.reconcile` are not automatically granted.
- [x] Stock postings and reversals use idempotency keys and transactional audit writes.
- [x] Negative stock is rejected even for a caller who has the override key until valuation behavior is implemented.
- [x] Ledger UPDATE/DELETE protection is included in the migration SQL.
- [ ] Run tenant, permission, trigger, migration and concurrency tests on isolated `_test` PostgreSQL.
- [ ] Configure and verify separate runtime and migration DB roles; the current environment has not been changed.
- [ ] Review migration status and a fresh backup before separately approving development deployment.
- [ ] Confirm GST jurisdiction/rate precedence and complete the safe tax-resolution boundary.
- [ ] Define and test an authorized projection rebuild procedure before exposing it.

See [Owner-controlled registration approval](OWNER_REGISTRATION_APPROVAL.md) for the registration and legacy-session rollout checks.
