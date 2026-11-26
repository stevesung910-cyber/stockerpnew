# Business Rules Register

## Authentication and account ownership

- Registration creates an unverified account only and does not create a login session or company membership. Duplicate and new registrations return a generic response; email ownership is established only by consuming an emailed verification token.
- Verification and reset tokens contain 256 bits of cryptographic randomness. The database stores SHA-256 token digests, expiry timestamps and one-time-use timestamps. Successful password reset revokes all active sessions and invalidates other outstanding reset tokens.
- Passwords are 12–128 characters and stored as Node.js scrypt hashes with random salts. Login failures do not distinguish unknown accounts from incorrect passwords.
- Reset responses do not disclose account existence. If a provider is absent or delivery fails, no email is claimed as sent and unusable tokens are not retained. Local token output is permitted only when `APP_ENV=development`, `NODE_ENV=development`, and `AUTH_DEV_EXPOSE_TOKENS=true`; production rejects token exposure.
- Production requires explicit production environment settings, HTTPS frontend origin, runtime database URL, and an HTTPS email delivery endpoint plus API key. This is necessary for ownership verification and password recovery.
- The session cookie is marked Secure unless `APP_ENV` and `NODE_ENV` both explicitly agree on `development` or both agree on `test`; a missing `NODE_ENV` cannot downgrade cookie security.

## Phase 2 inventory rules

- Moving weighted average is company-wide per item. Transfer carrying value remains unchanged. Quantities, costs and values use PostgreSQL Decimal/NUMERIC scales and documented half-up rounding.
- The ledger is append-only. Balance projections update atomically with posted movements and reconcile without silent repair.
- One initial company opening batch is allowed, finalized by posting one multi-line opening document. Normal stock posting is blocked before finalization.
- Negative stock is denied. `inventory.negative_stock_override` does not enable posting until its valuation and later-receipt adjustment algorithm is implemented.
- Stock locations follow Warehouse → Rack → Shelf → Bin. Warehouse and Bin can hold stock, but direct warehouse stock cannot coexist with bin stock in the same warehouse.
- Effective dates use company business dates and the configured company IANA timezone; financial years are explicit, non-overlapping DATE ranges.
- GST/HNS masters are company-scoped; tax rates are not yet resolved on stock/commercial documents pending confirmed jurisdiction and precedence rules.

See [Stock Valuation](STOCK_VALUATION.md), [Stock Posting Rules](STOCK_POSTING_RULES.md), [Warehouse Model](WAREHOUSE_LOCATION_MODEL.md) and [Financial Year Rules](FINANCIAL_YEAR_RULES.md) for implementation status and limitations.

## Invitations and memberships

- Company membership is not created when an administrator enters an email. The server stores a company-bound, role-bound invitation with only a token hash and seven-day expiry, then sends it through configured email delivery or the explicit local development workflow.
- Only an authenticated account with a verified email matching the invitation may accept. Acceptance revalidates expiry, one-time state, active company, inviter's current active membership and current authority to assign the role. It creates membership in the same transaction that consumes the invitation.
- Existing memberships are never silently upserted or reactivated by invitation. Acceptance returns a conflict and preserves the existing role/status.
- `SUPER_ADMIN` is a legacy company-scoped seeded role, not a platform identity. No company-membership API may assign or edit it. A platform-level administrator model is not implemented. Company Admin is the highest role that can be delegated through invitations, and only a current Company Admin can grant it.
- Role assignment is bounded by the caller's live permission set. Role permission editing cannot add permissions the caller lacks. Self-invitation and self-role promotion are rejected.

## Company creation and context

- An eligible user with no membership may create their initial company. Creating additional companies requires an active Company Admin membership with `company.create` in a company. A shared PostgreSQL limit permits at most five attempts per user/IP per hour as abuse protection, not a business quota.
- Company creation, role seeding, owner membership and session context update happen in one serializable transaction.
- User identity and company authorization are separate. A membership has one company-scoped role and role-permission links.
- Every protected company request reloads the user, session and membership; authorization is not based on frontend state. The active company comes from the server-side session. Switching rechecks active membership and company state in the transaction that updates the session.
- Every tenant-owned query must include the server-derived `companyId`. IDs from the request are scoped to that company unless an endpoint explicitly validates target-company membership, such as company reactivation. No PostgreSQL RLS policy is present yet.
- Future tenant-owned business queries will execute within a database transaction, set `SET LOCAL app.company_id` from authenticated server context, apply forced RLS `USING` and `WITH CHECK` policies, and also include Prisma tenant predicates. Transaction-local context must never survive connection-pool return.

## Rate limiting and database operations

- Auth and company-creation limits use the atomic `RateLimitStore` contract with a PostgreSQL store shared by backend instances.
- Integration tests require a dedicated database whose name ends in `_test`. The test runner never falls back to the development database, deploys tracked migrations only to the checked test database, and cleans only records created by the test run. Global permission catalogue data is intentionally preserved.
- Production runtime and migration identities are separate connection settings. Runtime should receive only required DML and sequence privileges; the migration identity requires DDL privileges. A deploy wrapper consumes `DATABASE_URL_MIGRATION`; no local database role ownership or privileges were changed.

## Phase 0 rules retained

- Inventory is ledger-derived; no direct stock balance edits.
- A posted stock or accounting transaction is immutable and corrected by reversal/replacement.
- Every accounting voucher must balance debits and credits.
- Draft documents do not affect stock or ledgers.
- Display document numbers are company/type scoped and separate from database IDs.
- Financial posting treatment for each transaction type must be documented before its posting service is implemented.
- Valuation and period-close policies must be configured before inventory and accounting posting are enabled.
