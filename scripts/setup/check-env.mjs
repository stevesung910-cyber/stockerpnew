import { existsSync, copyFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const env = new URL(".env", root);
if (!existsSync(env)) {
  copyFileSync(new URL(".env.example", root), env);
  console.log("Created .env from .env.example. Review credentials before connecting PostgreSQL.");
} else console.log(".env already exists.");
console.log("Next: npm install, then npm run db:generate and npm run dev.");
