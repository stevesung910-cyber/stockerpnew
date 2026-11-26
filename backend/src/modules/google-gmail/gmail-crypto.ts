import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { GMAIL_INTEGRATION_ID, type GmailConfig } from "./gmail-config";

export const KEY_VERSION = 1;
export const newState = () => randomBytes(32).toString("base64url");
export const stateDigest = (state: string) => createHash("sha256").update(state).digest("hex");
export function codeVerifier(state: string, key: Buffer) {
  const pkceKey = Buffer.from(hkdfSync("sha256", key, "", "stockerp:gmail:pkce:v1", 32));
  return createHmac("sha256", pkceKey).update(state).digest("base64url");
}
export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function associatedData(config: GmailConfig) {
  return Buffer.from(JSON.stringify([GMAIL_INTEGRATION_ID, KEY_VERSION, config.senderEmail, config.clientId]));
}

export function encryptRefreshToken(token: string, config: GmailConfig) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  cipher.setAAD(associatedData(config));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptRefreshToken(envelope: string, version: number | null, config: GmailConfig) {
  try {
    const payload = Buffer.from(envelope, "base64url");
    if (version !== KEY_VERSION || payload.length <= 28) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    decipher.setAAD(associatedData(config));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Gmail credential could not be decrypted.");
  }
}
