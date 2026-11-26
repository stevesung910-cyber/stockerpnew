# Phase 2 Testing

## Executed

- `npm run test:phase1:unit` — Phase 1 auth-security and audit unit tests; run separately from PostgreSQL integration tests.
- `npm run typecheck` — passed for shared, backend and frontend after the current changes.
- `npm run build` — passed for shared, backend and frontend; Vite production bundle completed.
- `npm run test:phase2:unit` — passed 3 moving-average/decimal valuation unit tests.
- Combined unit-run count: 10 (7 Phase 1 auth-security/audit tests and 3 Phase 2 valuation tests).
- Phase 1 auth integration source was compared with the saved pre-delivery copy: all 10 earlier test cases remain, with one additional email-delivery-failure regression test. No Phase 1 test was removed from the current source or its runner.
- `npm run db:generate` — passed with Prisma 6.19.3.
- `npx prisma validate --schema database/prisma/schema.prisma` — passed.
- Migration SQL static review — additive `CREATE`/`ALTER ADD` statements, company-scoped indexes/FKs, overlap/hierarchy/lifecycle/append-only triggers; no `DROP` or `TRUNCATE` found.

## Blocked

- `npm run test:phase1` — blocked before tests because Prisma could not connect to `localhost:5432` (`P1001`). Its guard selected `stockerp_test`; it runs the Phase 1 auth integration suite only after migrations deploy to that test database.
- `npm run test:phase2` — blocked before tests for the same `P1001`. It runs Phase 2 database integrity tests separately; no fallback to development occurs.
- Phase 2 PostgreSQL tests cover cross-company composite relationship rejection and database-enforced ledger immutability, but have not run.
- Concurrent posting, atomic rollback, route-level tenant isolation, reversal dependencies, opening completion, migration deploy, trigger behavior and projection reconciliation are not verified against PostgreSQL.
- `npm run dev:api` — blocked before the API entrypoint starts because `tsx watch` cannot create its IPC socket in this environment (`EPERM` at `/tmp/tsx-0/*.pipe`). Running the compiled backend also failed to bind `0.0.0.0:4000` (`EPERM`), so the health endpoint could not be queried here. This is an environment socket restriction; it does not establish whether the endpoint responds in a normal development environment.

## Required verification when PostgreSQL is available

Run `npm run test:phase1` and `npm run test:phase2` only after confirming `DATABASE_URL_TEST` points to the isolated `_test` database. Each guarded runner deploys tracked migrations to that database, then runs only its named suite. Never point either runner at `stockerp`.
