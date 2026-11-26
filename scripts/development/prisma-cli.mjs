import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import dotenv from "dotenv";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: resolve(projectRoot, ".env") });
const cli = resolve(projectRoot, "node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
