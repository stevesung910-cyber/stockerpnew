import { z } from "zod";
import { GMAIL_SCOPE, type GmailConfig } from "./gmail-config";
import { codeChallenge } from "./gmail-crypto";

const timeout = 8_000;
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
const identity = z.object({ email: z.string(), email_verified: z.boolean() });

export type GmailFailureCode = "CONSENT_DENIED" | "INVALID_CALLBACK" | "INVALID_STATE" | "CONNECTION_CHANGED"
  | "EXCHANGE_FAILED" | "IDENTITY_FAILED" | "SENDER_MISMATCH" | "MISSING_REFRESH_TOKEN" | "SEND_SCOPE_MISSING"
  | "DISCONNECT_IN_PROGRESS" | "TOKEN_REVOKED" | "REFRESH_FAILED" | "DECRYPT_FAILED" | "SEND_FAILED" | "REVOCATION_FAILED";

export class GmailFailure extends Error {
  constructor(readonly code: GmailFailureCode) { super(code); }
}

export function authorizationUrl(config: GmailConfig, state: string, verifier: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, scope: `openid email ${GMAIL_SCOPE}`,
    response_type: "code", access_type: "offline", prompt: "consent select_account", login_hint: config.senderEmail,
    state, code_challenge: codeChallenge(verifier), code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function googleFetch(url: string, options: RequestInit) {
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(timeout) });
}

export type GoogleGmailClient = {
  authorize(code: string, verifier: string, config: GmailConfig): Promise<string>;
  refresh(token: string, config: GmailConfig): Promise<{ accessToken: string; refreshToken?: string }>;
  send(accessToken: string, raw: string): Promise<void>;
  revoke(token: string): Promise<void>;
};

type GmailApi = {
  users: { messages: { send(
    input: { userId: string; requestBody: { raw: string } },
    options: { headers: Record<string, string>; retry: boolean; redirect: "error"; timeout: number; universeDomain: "googleapis.com" },
  ): Promise<{ status: number; data: { id?: string } }> } };
};

let api: GmailApi | undefined;
export function gmailApi(): GmailApi {
  if (!api) {
    try {
      const client = require("@googleapis/gmail") as { gmail(version: "v1"): GmailApi };
      api = client.gmail("v1");
    } catch {
      throw new Error("Gmail delivery requires the @googleapis/gmail package.");
    }
  }
  return api;
}

export function createGoogleGmailClient(getApi = gmailApi): GoogleGmailClient {
  return {
    async authorize(code, verifier, config) {
      let result: z.infer<typeof tokens>;
      try {
        const response = await googleFetch(tokenEndpoint, { method: "POST", body: new URLSearchParams({
          code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret,
          redirect_uri: config.redirectUri, grant_type: "authorization_code",
        }) });
        if (!response.ok) throw new Error();
        result = tokens.parse(await response.json());
      } catch {
        throw new GmailFailure("EXCHANGE_FAILED");
      }
      if (!result.refresh_token) throw new GmailFailure("MISSING_REFRESH_TOKEN");
      if (result.scope !== undefined && !result.scope.split(" ").includes(GMAIL_SCOPE)) throw new GmailFailure("SEND_SCOPE_MISSING");

      let sender: z.infer<typeof identity>;
      try {
        const response = await googleFetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { authorization: `Bearer ${result.access_token}` },
        });
        if (!response.ok) throw new Error();
        sender = identity.parse(await response.json());
      } catch {
        throw new GmailFailure("IDENTITY_FAILED");
      }
      if (!sender.email_verified || sender.email.toLowerCase() !== config.senderEmail) throw new GmailFailure("SENDER_MISMATCH");
      return result.refresh_token;
    },

    async refresh(token, config) {
      try {
        const response = await googleFetch(tokenEndpoint, { method: "POST", body: new URLSearchParams({
          refresh_token: token, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token",
        }) });
        if (!response.ok) {
          if (response.status === 400 && (await response.json() as { error?: unknown }).error === "invalid_grant") {
            throw new GmailFailure("TOKEN_REVOKED");
          }
          throw new Error();
        }
        const result = tokens.parse(await response.json());
        return { accessToken: result.access_token, refreshToken: result.refresh_token };
      } catch (error) {
        if (error instanceof GmailFailure) throw error;
        throw new GmailFailure("REFRESH_FAILED");
      }
    },

    async send(accessToken, raw) {
      try {
        // A bare bearer header avoids auth-client retry after an ambiguous send.
        const response = await getApi().users.messages.send({ userId: "me", requestBody: { raw } }, {
          headers: { authorization: `Bearer ${accessToken}` }, timeout, retry: false, redirect: "error", universeDomain: "googleapis.com",
        });
        if (response.status < 200 || response.status >= 300 || !response.data.id) throw new Error();
      } catch {
        throw new GmailFailure("SEND_FAILED");
      }
    },

    async revoke(token) {
      try {
        const response = await googleFetch("https://oauth2.googleapis.com/revoke", {
          method: "POST", body: new URLSearchParams({ token }),
        });
        if (response.ok) return;
        if (response.status === 400 && (await response.json() as { error?: unknown }).error === "invalid_token") return;
        throw new Error();
      } catch {
        throw new GmailFailure("REVOCATION_FAILED");
      }
    },
  };
}

export const googleGmailClient = createGoogleGmailClient();
