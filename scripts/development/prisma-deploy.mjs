import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import dotenv from "dotenv";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: resolve(projectRoot, ".env") });
if (!process.env.DATABASE_URL_MIGRATION) {
  throw new Error("DATABASE_URL_MIGRATION is required for production migration deployment.");
}

const migrationUrl = new URL(process.env.DATABASE_URL_MIGRATION);
const targetDatabase = decodeURIComponent(
  migrationUrl.pathname.replace(/^\//, "")
);

if (!["postgres:", "postgresql:"].includes(migrationUrl.protocol)) {
  throw new Error("Unsupported migration database protocol.");
}

if (targetDatabase !== "stockerp") {
  throw new Error(
    `Migration blocked: expected stockerp, received ${targetDatabase}.`
  );
}

const cli = resolve(projectRoot, "node_modules/prisma/build/index.js");
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL_MIGRATION };
const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", "database/prisma/schema.prisma"], { cwd: projectRoot, env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
