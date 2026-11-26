# StockERP

StockERP is a modular ERP foundation for Indian trading and manufacturing businesses. The application is being delivered in verified vertical slices; this Phase 0 foundation is not yet a production ERP and does not claim inventory or accounting features are implemented.

## Requirements

- Node.js 20 or newer and npm
- Local PostgreSQL 15 or newer
- No Docker required

## Install and run

```bash
cp .env.example .env
# Edit DATABASE_URL, DATABASE_URL_MIGRATION, SHADOW_DATABASE_URL, and DATABASE_URL_TEST for your local PostgreSQL account.
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Create `stockerp`, `stockerp_shadow`, and a separate `stockerp_test` database. Use separate runtime and migration roles in deployment; this project does not change existing PostgreSQL ownership or grants. Prisma Migrate uses the shadow database for development drift checks. The example values are placeholders, not working credentials. Migrations are tracked under `database/prisma/migrations/`.

For local HTTP development, set both `APP_ENV=development` and `NODE_ENV=development`. Development password-reset and email-verification token output remains disabled unless `AUTH_DEV_EXPOSE_TOKENS=true` is explicitly set. Do not enable that setting outside isolated local development.

Set `DATABASE_URL_TEST` to a dedicated database whose name ends in `_test` before running `npm run test:phase1`. The test command refuses the ordinary development database, deploys tracked migrations to the test database, and only removes records created by that test run. It never resets or truncates the database.

The React app is at `http://localhost:5173`; the API is at `http://localhost:4000/api/v1/health`. Set `FRONTEND_ORIGIN` to the exact frontend origin used by the browser. Production must use HTTPS so the session cookie is marked Secure.

Run frontend and backend separately with `npm run dev:web` and `npm run dev:api`. On Windows PowerShell use `scripts/development/start.ps1`; WSL and Linux can use `scripts/development/start.sh`.

## Phase status

Run `npm run test:phase1` for the isolated PostgreSQL authentication/company integration suite. Use `npm run db:migrate` for local development and `npm run db:migrate:deploy` for production deployments; the latter requires `DATABASE_URL_MIGRATION` and never runs a reset. See [docs/PROJECT_PROGRESS.md](docs/PROJECT_PROGRESS.md). No dashboard business figures are seeded or hardcoded.

[Owner-controlled registration approval](docs/OWNER_REGISTRATION_APPROVAL.md) covers environment configuration, PostgreSQL migration, backup, and rollback.
