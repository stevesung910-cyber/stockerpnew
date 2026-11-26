import { runPostgresTests } from "./run-postgres-tests.mjs";

process.exitCode = runPostgresTests([
  "backend/src/modules/auth/auth.integration.test.ts",
  "backend/src/modules/auth/auth.security.unit.test.ts",
  "backend/src/modules/audit/audit.service.test.ts",
]);
