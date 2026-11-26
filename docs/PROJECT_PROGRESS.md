# StockERP Project Progress

## Current status

**Phase 2 is partially implemented and not verified against PostgreSQL. Phase 1 deployment closure remains unverified.** No development or production migration was applied during this work.

## Phase 2 changes in this workspace

- Added Prisma models and an additive migration for financial years, item/category/unit/conversion, HSN/GST, suppliers/customers, warehouse locations, opening batches, stock documents/lines, immutable ledger, balances and idempotency.
- Added financial-year, master-data, location, stock posting/reversal, balance/ledger, low-stock, reporting and reconciliation APIs under `/api/v1`.
- Added company/item moving weighted-average calculations using Prisma Decimal; quantity, cost and currency scales and half-up rounding are documented and unit-tested.
- Added advisory locking, bounded serialization retries, idempotency records, period-close locking, opening-batch completion, reversal dependency checks and transactional audit writes for stock documents.
- Added server-side company scoping, composite tenant foreign keys, custom database guards, a conservative permission catalogue/grant update, and company timezone settings.
- Added functional frontend workspaces for items, categories, units, HSN/GST, parties, warehouse hierarchy, financial years, opening/receipt/issue/transfer/adjustment, stock documents, ledger/balances, reports, alerts and reconciliation. The dashboard now uses live inventory APIs.
- Added unit and PostgreSQL integration tests plus Phase 2 documentation.
- Separated the Phase 1 and Phase 2 PostgreSQL test runners. Phase 1 retains auth integration, auth-security unit, and audit unit tests; Phase 2 runs inventory database-integrity tests independently. Added separate Phase 1 and Phase 2 unit commands.
- Scoped category patch lookups to the active company inside the update transaction.

## Verification evidence

- `npm run db:generate` — passed.
- `npx prisma validate --schema database/prisma/schema.prisma` — passed.
- `npm run typecheck` — passed.
- `npm run test:phase2:unit` — 10 passed, 0 failed.
- `npm run test:phase1:unit` — 7 passed, 0 failed; `npm run test:phase2:unit` — 3 passed, 0 failed.
- `npm run build` — passed after the latest backend and frontend changes; Vite production bundle completed.
- `npm run test:phase1` and `npm run test:phase2` — both blocked before tests by PostgreSQL `P1001` at `localhost:5432`, targeting `stockerp_test`.
- Backend startup with `npm run dev:api` was blocked by sandbox `EPERM` creating the `tsx watch` IPC socket; compiled server startup was also blocked by `EPERM` binding port 4000. Health response is therefore unverified.
- Development `prisma migrate status` — blocked by the same unavailable PostgreSQL server; current applied/pending migration state is unknown.

## Restricted or incomplete

- Negative-stock override is seeded but never authorizes a negative posting; the feature is safely blocked until the negative valuation/recovery algorithm is designed and tested.
- GST master data is present. Jurisdiction resolution, tax quotation and commercial-document tax snapshots are not implemented pending business rules.
- Controlled projection rebuild, export, complete draft-edit workflow, and complete master update/deactivation coverage remain incomplete. Location deactivation has a guarded endpoint; historical location relocation is not implemented.
- Reporting and UI cover operational summaries and core report groupings, but not every requested report/export workflow.
- Runtime/migration database role separation has not been configured or validated.
- Integration/concurrency/migration SQL tests have not run. Do not treat Phase 2 as complete or production-ready.

## Phase 1 status

Earlier progress records Phase 1 migrations and test evidence, but the current PostgreSQL service was unavailable, so this work did not refresh Phase 1 migration status or apply the pending audit migration. Existing historical backup claims are not a fresh backup check.

## Next required actions

1. Start/restore PostgreSQL through the approved environment and verify the isolated `stockerp_test` target.
2. Run the guarded Phase 2 migration/integration test suite and fix any failures.
3. Review the Phase 2 migration SQL and run a fresh read-only development migration status check.
4. Create and verify a fresh development backup.
5. Obtain separate approval before running `npm run db:migrate:deploy` against `stockerp`.
6. Complete the deferred safety-critical features and production readiness checks.
