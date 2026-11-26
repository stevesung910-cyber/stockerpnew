import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import dotenv from "dotenv";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: resolve(projectRoot, ".env") });

function databaseIdentity(value, label) {
  if (!value) throw new Error(`${label} is required. Tests will not use DATABASE_URL as a fallback.`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a valid PostgreSQL URL.`); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  if (!database) throw new Error(`${label} must include a database name.`);
  return { database, hostname: parsed.hostname.toLowerCase(), port: parsed.port || "5432" };
}

export function runPostgresTests(testFiles, { databaseName, deployMigrations = true } = {}) {
  const testUrl = process.env.DATABASE_URL_TEST;
  const target = databaseIdentity(testUrl, "DATABASE_URL_TEST");
  if (!target.database.endsWith("_test")) throw new Error("Refusing integration tests: the database name must end in _test.");
  if (databaseName && target.database !== databaseName) throw new Error(`Tests require the ${databaseName} database.`);
  if (process.env.DATABASE_URL) {
    const development = databaseIdentity(process.env.DATABASE_URL, "DATABASE_URL");
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    const sameHost = target.hostname === development.hostname || (localHosts.has(target.hostname) && localHosts.has(development.hostname));
    if (target.database === development.database || (sameHost && target.port === development.port && target.database === development.database)) {
      throw new Error("Refusing integration tests: DATABASE_URL_TEST points to the development database.");
    }
  }

  const env = { ...process.env, DATABASE_URL: testUrl, APP_ENV: "development", NODE_ENV: "development", AUTH_DEV_EXPOSE_TOKENS: "true", EMAIL_DELIVERY_PROVIDER: "http" };
  if (deployMigrations) {
    const prismaCli = resolve(projectRoot, "node_modules/prisma/build/index.js");
    const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", "database/prisma/schema.prisma"], { cwd: projectRoot, env, stdio: "inherit" });
    if (migration.error) throw migration.error;
    if (migration.status !== 0) return migration.status ?? 1;
  }

  const args = deployMigrations
    ? [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "--test", ...testFiles]
    : ["--import", "tsx", ...testFiles];
  const tests = spawnSync(process.execPath, args, { cwd: projectRoot, env, stdio: "inherit" });
  if (tests.error) throw tests.error;
  return tests.status ?? 1;
}
