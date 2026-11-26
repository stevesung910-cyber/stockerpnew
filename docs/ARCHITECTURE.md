# StockERP Architecture

StockERP starts as a TypeScript modular monolith: React/Vite frontend, Express REST API, shared contracts, Prisma and PostgreSQL. The frontend and API run independently, with the root workspace offering a combined developer command.

## Boundaries

- `frontend`: routes, layouts, design system and API clients.
- `backend/src/modules`: feature-owned routes, services, validation and persistence.
- `shared`: transport contracts and shared types only.
- `database/prisma`: canonical schema and migrations.

## API conventions

REST paths are versioned under `/api/v1`. Success payloads use `{ data, meta? }`; errors use `{ error: { code, message, details? }, meta? }`. List endpoints will use server pagination (`page`, `pageSize`) and stable sorting. Sensitive company context will be resolved from authenticated membership on the server, never trusted from a request body alone.

## Data integrity direction

Company-owned models carry `companyId`; uniqueness is scoped by company. Stock posting uses an immutable ledger, transactional projection and linked reversals. PostgreSQL RLS remains deferred. Schema migrations must be additive or have an explicit data-preservation plan.

## Phase 1 identity and company boundary

- Passwords use Node.js `scrypt` (N=16384, r=8, p=1) with per-password random salts. Registration creates a pending request. Owner OTP approval atomically creates an eligible account without marking its email verified. Active verified legacy accounts retain eligibility.
- The browser receives only a random opaque 256-bit session token in an HttpOnly, SameSite=Lax cookie; PostgreSQL stores its SHA-256 digest and an eight-hour expiration. The cookie is insecure only when both environment labels explicitly agree on local development or test mode; otherwise Secure is forced. Production startup requires both production environment labels, HTTPS origins, database configuration, and an HTTPS email provider.
- Email verification, password reset and company invitations use cryptographically random tokens. Only token hashes are stored; tokens expire and are consumed once. Local token display requires `APP_ENV=development`, `NODE_ENV=development`, and `AUTH_DEV_EXPOSE_TOKENS=true` together. Production rejects token exposure.
- Company memberships are created only after the invited, verified email owner accepts the invitation. The inviter's active membership and permission authority are rechecked at acceptance.
- Every protected request reloads the user, session and active company membership/role permissions from PostgreSQL. Missing, suspended, inactive or archived company membership clears the session's active company context.
- Company routes use the authenticated server-derived company ID and include it in tenant-owned query filters. Switching and sensitive role/member/company modifications are revalidated inside database transactions. Member-role assignment is bounded by the caller's current permissions; the reserved seeded `SUPER_ADMIN` role cannot be granted through membership APIs.
- The first company is available to an eligible account with no memberships. Additional companies require active `COMPANY_ADMIN` membership with `company.create`. A five-per-hour per-user/IP limiter guards creation attempts.
- Exact-origin checks for state-changing cookie requests, credentialed CORS, Helmet and auth rate limits form the browser/API boundary. `RateLimitStore` has an atomic `consume` contract and a PostgreSQL implementation shared by the backend instances.
- PostgreSQL RLS remains deferred. Phase 2 relies on server-derived active company context, explicit company predicates, composite tenant foreign keys, company-scoped uniqueness, and server-side permissions. A future RLS stage must test transaction-local context, pooling, roles, forced policies and background jobs before enabling policies.

## Phase 2 inventory module

The inventory module uses a company/item moving weighted-average pool and a transactional `StockBalance` projection. `StockLedgerEntry` is the source of truth. Posting/reversal use serializable Prisma transactions, advisory lock keys and idempotency records. See [Inventory Architecture](INVENTORY_ARCHITECTURE.md), [Stock Valuation](STOCK_VALUATION.md) and [Stock Posting Rules](STOCK_POSTING_RULES.md). The implementation is present but database integration verification is pending.

## Database operations and migration safety

- `DATABASE_URL` is the runtime/application connection; production should use a dedicated least-privilege role limited to required DML and sequence operations. `DATABASE_URL_MIGRATION` is consumed only by the production migration wrapper, which refuses to run if it is absent. This separation is prepared in the command boundary but has not been applied to the local database roles.
- Local development uses `npm run db:migrate` (`prisma migrate dev`). Production uses `npm run db:migrate:deploy` (`prisma migrate deploy`) through `DATABASE_URL_MIGRATION` and must not use `migrate reset` or `db push --force-reset`.
- Integration tests require `DATABASE_URL_TEST` whose database name ends with `_test`; the runner refuses to fall back to `DATABASE_URL`, checks it is a distinct database, and deploys only tracked migrations to that database. Cleanup is scoped to IDs created in the test run.
- The current application role/database ownership is unchanged. No grant, ownership, reset, or truncate operation is part of this remediation.

## Runtime

The API listens on `API_PORT` (default 4000); Vite listens on 5173. PostgreSQL is local and configured through `DATABASE_URL`. No container runtime is required.

See [Owner-controlled registration approval](OWNER_REGISTRATION_APPROVAL.md) for shared rate limiting, legacy session handling, and the rollout runbook.
