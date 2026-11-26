import { isGmailMailbox } from "./gmail-mime";

export const GMAIL_CALLBACK_PATH = "/api/v1/integrations/google-gmail/callback";
export const GMAIL_SETTINGS_PATH = "/settings/integrations/google-gmail";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_INTEGRATION_ID = "google-gmail";

export function gmailConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (!env.EMAIL_DELIVERY_PROVIDER || env.EMAIL_DELIVERY_PROVIDER === "http" || env.EMAIL_DELIVERY_PROVIDER === "smtp") return undefined;
  if (env.EMAIL_DELIVERY_PROVIDER !== GMAIL_INTEGRATION_ID) {
    throw new Error("EMAIL_DELIVERY_PROVIDER must be http, smtp or google-gmail.");
  }
  function required(name: string) {
    const value = env[name];
    if (!value || value !== value.trim()) throw new Error(`${name} is required for Gmail delivery.`);
    return value;
  }
  const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = required("GOOGLE_OAUTH_REDIRECT_URI");
  function email(name: string) {
    const value = required(name);
    if (!isGmailMailbox(value)) throw new Error(`${name} must be a valid email address.`);
    return value.toLowerCase();
  }
  const senderEmail = email("GOOGLE_GMAIL_SENDER_EMAIL");
  const key = required("GOOGLE_OAUTH_ENCRYPTION_KEY");
  required("SOFTWARE_OWNER_USER_ID");
  const frontendOrigin = required("FRONTEND_ORIGIN");
  const ownerEmail = email("REGISTRATION_OWNER_EMAIL");
  if (ownerEmail !== senderEmail) {
    throw new Error("GOOGLE_GMAIL_SENDER_EMAIL and REGISTRATION_OWNER_EMAIL must match after normalization.");
  }
  const database = env.DATABASE_URL && URL.canParse(env.DATABASE_URL) ? new URL(env.DATABASE_URL) : undefined;
  const keyReused = key.toLowerCase() === env.OWNER_REGISTRATION_OTP_HMAC_SECRET?.toLowerCase()
    || key === clientSecret || key === database?.password;
  if (!/^[a-f0-9]{64}$/i.test(key) || keyReused) {
    throw new Error("GOOGLE_OAUTH_ENCRYPTION_KEY must be an independent random 32-byte hex key.");
  }
  if (!URL.canParse(redirectUri) || !URL.canParse(frontendOrigin)) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI and FRONTEND_ORIGIN must be valid URLs.");
  }
  const production = env.NODE_ENV === "production" || env.APP_ENV === "production";
  for (const url of [new URL(redirectUri), new URL(frontendOrigin)]) {
    const localHttp = !production && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("Google Gmail URLs require HTTPS outside local development.");
    }
  }
  const redirect = new URL(redirectUri);
  if (redirectUri !== `${redirect.origin}${GMAIL_CALLBACK_PATH}` || frontendOrigin !== new URL(frontendOrigin).origin) {
    throw new Error("Use the exact backend Gmail callback URL and a bare FRONTEND_ORIGIN.");
  }
  return { clientId, clientSecret, redirectUri, senderEmail, frontendOrigin, encryptionKey: Buffer.from(key, "hex") };
}

export type GmailConfig = NonNullable<ReturnType<typeof gmailConfiguration>>;

export function isGmailOwner(auth: { userId: string; emailVerified: boolean } | undefined, env = process.env) {
  return Boolean(auth?.emailVerified && env.SOFTWARE_OWNER_USER_ID && auth.userId === env.SOFTWARE_OWNER_USER_ID);
}
