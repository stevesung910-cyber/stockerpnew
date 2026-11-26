import { runPostgresTests } from "./run-postgres-tests.mjs";

process.exitCode = runPostgresTests(["backend/src/modules/google-gmail/gmail.integration.test.ts"], { databaseName: "stockerp_test", deployMigrations: false });
