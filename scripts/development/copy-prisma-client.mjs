import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = resolve(projectRoot, "backend/src/database/generated");
const destination = resolve(projectRoot, "backend/dist/database/generated");
if (!existsSync(source)) throw new Error("Generated Prisma Client is missing. Run npm run db:generate before building the backend.");
mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
process.stdout.write("Generated Prisma Client copied to backend/dist for production runtime.\n");
