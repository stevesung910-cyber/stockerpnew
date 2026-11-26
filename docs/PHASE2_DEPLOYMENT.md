# Phase 2 Deployment Preparation

**No migration has been applied to development or production.**

## Migration created

`database/prisma/migrations/20261125130000_phase2_inventory/migration.sql` adds the Phase 2 schema, company timezone, tenant-safe FKs/indexes, permission catalogue rows, financial/conversion/tax overlap guards, location hierarchy validation, document lifecycle guards, and append-only ledger protection.

## Current status

- `DATABASE_URL_TEST` is configured for a separate `stockerp_test` database, but the local PostgreSQL cluster is stopped and cannot be started from this sandbox.
- `npm run test:phase2` failed before applying migrations with Prisma `P1001`; no database migration was applied.
- Read-only `npx prisma migrate status --schema database/prisma/schema.prisma` against `stockerp` also failed with `P1001`. Current development migration status is unknown. Historical Phase 1 progress notes are not fresh status evidence.
- A fresh backup, restore check, isolated migration verification and production readiness review remain required.

## Review commands

After PostgreSQL is available, first inspect status and verify the isolated test target:

```bash
npx prisma migrate status --schema database/prisma/schema.prisma
npm run test:phase2
```

Review SQL and check for destructive statements:

```bash
sed -n '1,760p' database/prisma/migrations/20261125130000_phase2_inventory/migration.sql
rg -n '\b(DROP|TRUNCATE)\b' database/prisma/migrations/20261125130000_phase2_inventory/migration.sql
```

## Development deployment command for separate approval

Only after a fresh backup, successful `_test` migration/integration run, current development migration status review, and your explicit approval, run:

```bash
npm run db:migrate:deploy
```

The wrapper uses `DATABASE_URL_MIGRATION` from `.env`, verifies the target database is exactly `stockerp`, and runs `prisma migrate deploy`. It applies every migration still pending on that database, including any pending Phase 1 migrations as well as the new Phase 2 migration. Review that pending set before execution. Do not use `migrate dev`, `db push`, reset or truncate against development/production.
