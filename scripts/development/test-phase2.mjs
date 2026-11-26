import { runPostgresTests } from "./run-postgres-tests.mjs";

process.exitCode = runPostgresTests(["backend/src/modules/inventory/inventory.integration.test.ts"]);
