import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key as Buffer)));
}
export async function hashPassword(password: string) { const salt = randomBytes(16); const key = await scrypt(password, salt); return `scrypt$16384$${salt.toString("base64url")}$${key.toString("base64url")}`; }
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || cost !== "16384" || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url"); const actual = await scrypt(password, Buffer.from(saltText, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const newOpaqueToken = () => randomBytes(32).toString("base64url");
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
