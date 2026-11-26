# Phase 1 Remediation Report

**Historical Phase 1 remediation report.** Its recorded database observations below are not current live status. A fresh read-only migration status check on 2026-11-25 could not connect because the local PostgreSQL cluster was unavailable (`P1001`). The current Phase 2 implementation status is tracked in [Project Progress](PROJECT_PROGRESS.md); no Phase 2 migration was applied to development or production.

## Original findings and corrections

| Finding | Root cause | Correction made | Verification state |
|---|---|---|---|
| C1: Role escalation | Member creation accepted arbitrary role codes and upserted memberships; role changes trusted role codes without a caller-authority ceiling. | Added live role-authority service; invitations are permission-subset constrained; Company Admin grant requires Company Admin; `SUPER_ADMIN` is reserved and unassignable; self-promotion/self-invitation blocked; membership changes revalidate in serializable transactions; no upsert. | Unit tests authored; integration assertions authored; not yet run against PostgreSQL. |
| C2: Reset-token disclosure | Response used `NODE_ENV !== production`, which failed open when missing or mistyped. | Token display requires explicit `APP_ENV=development`, `NODE_ENV=development`, and `AUTH_DEV_EXPOSE_TOKENS=true`; production rejects exposure; reset returns generic responses without delivery; tokens remain hashed, expiring and one-use. | Unit tests authored for missing, production, test and explicit development settings; DB token tests authored; integration suite pending. |
| H1: Email ownership | Registration made unverified identities and email-based direct membership possible. | Registration creates an unverified account only; added verification-token table/flow; company membership now requires a company invitation accepted by the matching verified account; acceptance revalidates inviter authority and rejects existing memberships. | Schema validated; integration assertions authored; migration and DB tests pending. |
| H2: Company creation | Any authenticated account could create unlimited companies. | First company requires verified account with no membership; additional company creation requires active Company Admin plus `company.create`; five attempts/user/IP/hour limiter. | Integration assertions authored; pending isolated DB run. |
| H3: Email delivery | API implied delivery without a provider. | Added provider interface and HTTPS JSON adapter; delivery failure does not claim success and removes unused token/invitation; production requires provider config. | Configuration unit tests authored; delivery integration tests pending. |
| M1: Cookie security | Secure depended only on exact `NODE_ENV=production`. | Cookie is Secure unless both environment variables explicitly agree on local development or test mode; production startup validates configuration. | Unit assertions authored; final rerun pending. |
| M2: Rate limiting | In-memory limiter was hardcoded and process-local. | Added atomic `RateLimitStore` interface and in-memory implementation; documented shared adapter requirement. | Unit test authored; live endpoint rate test pending. |
| M3: Tenant isolation | No database RLS / transaction-local tenant context existed. | Documented server-derived company context, mandatory tenant predicates and future transaction-local RLS pattern. No speculative policy added. | Existing company session/filters preserved; multi-company integration test pending. |
| M4: Test DB safety | Integration runner loaded the ordinary `.env` `DATABASE_URL`. | Added required `DATABASE_URL_TEST`, `_test` suffix and distinct-database guards; migration deploy and cleanup are scoped to the test DB and created IDs. | Negative run safely refused due missing test URL; full test run pending. |
| M5: Database privileges | Runtime and migration roles were not separated. | Added `DATABASE_URL_MIGRATION` production deploy wrapper and documented least-privilege roles. No database ownership or privilege changed. | Wrapper not run; no grant/ownership changes made. |
| M6: Super Admin scope | Seeded company-scoped `SUPER_ADMIN` could be confused with platform authority. | Documented current company-scoped legacy seed as non-platform; company APIs cannot grant or edit it. No platform-wide role introduced. | Unit and integration assertions authored; pending DB test. |
| M7: Transaction safety | Sensitive role/member/company actions could race with authorization changes; role metadata-only updates relied on request-start permission state. | Role/member/company mutations revalidate live membership/permissions in serializable transactions; role metadata and permission changes now revalidate `roles.edit` inside the same serializable transaction. Invitation and creation are transactional. | Updated typecheck/build passed; database integration tests pending. |
| M8: Frontend session handling | 401s, company switches and navigation did not clear/synchronize permission state. | Central 401 event clears query cache and routes to login; logout/switch broadcast across tabs; switch refetches session; navigation filters by session permissions. | Frontend production build previously passed; rerun pending. |
| M9: Production migration | No explicit deploy-only migration command existed. | Added `db:migrate:deploy` wrapper requiring `DATABASE_URL_MIGRATION`; test runner uses `migrate deploy` only on guarded `_test` DB. | Migration status and test DB migration pending. |

## Files changed

Backend source: `backend/src/config/env.ts`, `backend/src/modules/auth/auth.routes.ts`, `auth.middleware.ts`, `session.ts`, new `cookie-config.ts`, `email-delivery.ts`, `rate-limit.ts`, `auth.integration.test.ts`, `auth.security.unit.test.ts`; `backend/src/modules/companies/companies.routes.ts`, new `role-authorization.ts`.

Database and scripts: `database/prisma/schema.prisma`, new `database/prisma/migrations/20261124195000_phase1_security/migration.sql`, new `scripts/development/test-phase1.mjs`, new `scripts/development/prisma-deploy.mjs`, `backend/package.json`, root `package.json`, `.env.example`.

Frontend: `frontend/src/services/api.ts`, `frontend/src/app/App.tsx`, `frontend/src/layouts/AppShell.tsx`, `frontend/src/features/auth/AuthGuard.tsx`, `frontend/src/pages/AuthPage.tsx`, `frontend/src/pages/CompanyPages.tsx`.

Documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_PROGRESS.md`, `docs/API_CONTRACTS.md`, `docs/BUSINESS_RULES.md`, new `docs/SECURITY_CHECKLIST.md`, and this report.

Prisma Client was regenerated under the ignored `backend/src/database/generated/` directory. Build output under ignored `dist/` directories was regenerated. The project directory is not a Git repository, so a repository diff could not be inspected.

## Database and migration safety

- A custom-format backup was created at `/tmp/stockerp-pre-phase1-remediation-20261124.dump` (25,400 bytes). `pg_restore --list` confirmed it is readable and identifies database `stockerp`.
- Before remediation, read-only checks reported zero users, companies and memberships; migration `20261124181305_phase1_auth_company` was applied. A final read-only `migrate status` confirms the additive migration remains pending.
- New migration changes are limited to one nullable column, two new tables, indexes and foreign keys. It contains no `DROP`, `TRUNCATE`, table rewrite, or existing-row deletion. The SQL is present and reviewed but is not applied.
- `stockerp` was not reset, truncated, dropped, recreated, or migrated in this incomplete run. No database ownership or privileges were changed.
- `stockerp_test` does not exist and `DATABASE_URL_TEST` is not configured. A new DB necessarily needs an owner; approval was requested due to the explicit ownership restriction. No reply has been received.

## Tests and actual results

- `npm run db:generate` — passed.
- Prisma schema validation — passed.
- `npm run typecheck` — passed on 2026-11-24 after the final role authorization transaction change.
- `npm run build` — passed on 2026-11-24 after the final role authorization transaction change; Vite production bundle completed.
- Compiled security unit suite — 5 passed, 0 failed on 2026-11-24.
- `npm run test:phase1` — exited before database access with `DATABASE_URL_TEST is required`; integration assertions have not run.
- A direct TSX test invocation was blocked by sandbox IPC (`listen EPERM /tmp/tsx-0/2.pipe`). The guarded test runner must be run with appropriate execution access once the test DB is approved and created.
- Read-only migration status confirms `20261124195000_phase1_security` is pending. The local cluster had to be started with escalation for this check; no migration was run.
- The backup remains readable (`pg_restore --list` succeeds).
- `docs/PROJECT_PROGRESS.md` was absent in the workspace during the final inspection and has now been created with verified status and next steps.

## Remaining limitations and risks

- Phase 1 cannot be accepted until the dedicated test database is authorized/created, the additive migration is verified there, integration/security tests pass, the migration is applied to `stockerp`, and migration status and API/auth smoke checks pass.
- Email delivery adapter uses an operator-configured HTTPS JSON endpoint. No provider is bundled. Production startup intentionally fails without one.
- Rate limiting is process-local until a shared `RateLimitStore` adapter is supplied.
- PostgreSQL RLS and tenant context are documented for future tenant-owned business tables but are not enabled in Phase 1.
- Existing users added by a future migration will have `emailVerifiedAt=NULL` and must verify before company API access.
- No runtime database role/grant changes have been made; production deployment must establish least privilege separately with approval.
