import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { smtpConfiguration } from "../modules/auth/smtp-email-delivery";
import { gmailConfiguration } from "../modules/google-gmail/gmail-config";

const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env"), resolve(__dirname, "../../../.env")];
const envFile = candidates.find(candidate => existsSync(candidate));
if (envFile) dotenv.config({ path: envFile });

export type AppEnvironment = "development" | "test" | "production";

export function appEnvironment(): AppEnvironment | undefined {
  const value = process.env.APP_ENV;
  return value === "development" || value === "test" || value === "production" ? value : undefined;
}

/** Secrets are exposed only when both environment labels explicitly identify local development. */
export function mayExposeDevelopmentTokens(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.APP_ENV === "development"
    && environment.NODE_ENV === "development"
    && environment.AUTH_DEV_EXPOSE_TOKENS === "true";
}

export function registrationConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const owner = z.string().trim().email().max(254).safeParse(environment.REGISTRATION_OWNER_EMAIL);
  const secret = environment.OWNER_REGISTRATION_OTP_HMAC_SECRET;
  if (!owner.success) throw new Error("REGISTRATION_OWNER_EMAIL must be a valid email address.");
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("OWNER_REGISTRATION_OTP_HMAC_SECRET must be a random 32-byte hex secret.");
  }
  return { ownerEmail: owner.data, hmacKey: Buffer.from(secret, "hex") };
}

export function validateRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  const appEnv = environment.APP_ENV;
  if (appEnv && !["development", "test", "production"].includes(appEnv)) {
    throw new Error("APP_ENV must be development, test, or production.");
  }
  const productionMode = environment.NODE_ENV === "production" || appEnv === "production";
  const gmail = gmailConfiguration(environment);
  const smtp = smtpConfiguration(environment);
  if (gmail || smtp) registrationConfiguration(environment);
  if (productionMode) {
    if (appEnv !== "production" || environment.NODE_ENV !== "production") throw new Error("APP_ENV=production and NODE_ENV=production are both required for production startup.");
    if (environment.AUTH_DEV_EXPOSE_TOKENS === "true") throw new Error("AUTH_DEV_EXPOSE_TOKENS cannot be enabled in production.");
    const frontendOrigin = environment.FRONTEND_ORIGIN;
    if (!frontendOrigin || new URL(frontendOrigin).protocol !== "https:") {
      throw new Error("Production FRONTEND_ORIGIN must be an HTTPS origin.");
    }
    if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required in production.");
    if (!gmail && !smtp) {
      if (Boolean(environment.EMAIL_PROVIDER_URL) !== Boolean(environment.EMAIL_PROVIDER_API_KEY)) throw new Error("EMAIL_PROVIDER_URL and EMAIL_PROVIDER_API_KEY must both be configured or both be omitted.");
      if (!environment.EMAIL_PROVIDER_URL || !environment.EMAIL_PROVIDER_API_KEY) throw new Error("EMAIL_PROVIDER_URL and EMAIL_PROVIDER_API_KEY are required for production account verification and password recovery.");
      if (!URL.canParse(environment.EMAIL_PROVIDER_URL)) throw new Error("EMAIL_PROVIDER_URL must be a valid HTTPS URL.");
      const provider = new URL(environment.EMAIL_PROVIDER_URL);
      if (provider.protocol !== "https:" || provider.username || provider.password) {
        throw new Error("EMAIL_PROVIDER_URL must use HTTPS without embedded credentials in production.");
      }
    }
    registrationConfiguration(environment);
  }
}

validateRuntimeEnvironment();
