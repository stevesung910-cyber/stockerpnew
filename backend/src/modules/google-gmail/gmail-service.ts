import { randomUUID } from "node:crypto";
import { prisma } from "../../database/prisma";
import type { EmailDeliveryProvider, OutboundEmail } from "../auth/email-delivery";
import { GMAIL_INTEGRATION_ID as id, type GmailConfig } from "./gmail-config";
import { codeVerifier, decryptRefreshToken, encryptRefreshToken, KEY_VERSION, newState, stateDigest } from "./gmail-crypto";
import { authorizationUrl, GmailFailure, type GmailFailureCode, googleGmailClient, type GoogleGmailClient } from "./google-client";
import { gmailMime } from "./gmail-mime";

const stateLifetime = 10 * 60_000;
const statuses = new Set<GmailFailureCode>([
  "CONSENT_DENIED", "INVALID_CALLBACK", "INVALID_STATE", "CONNECTION_CHANGED", "EXCHANGE_FAILED", "IDENTITY_FAILED",
  "SENDER_MISMATCH", "MISSING_REFRESH_TOKEN", "SEND_SCOPE_MISSING", "TOKEN_REVOKED", "REFRESH_FAILED",
  "DECRYPT_FAILED", "SEND_FAILED", "REVOCATION_FAILED",
]);
const credentialWhere = { id, provider: id };
// Active revisions fence remote work across server instances. Plain UUIDs are idle revisions.
const connecting = "connecting:";
const revoking = "revoking:";

function disconnected(lastError: GmailFailureCode | null) {
  return {
    encryptedRefreshToken: null, encryptionKeyVersion: null, revision: randomUUID(),
    status: "DISCONNECTED" as const, connectedAt: null, lastTokenRefreshAt: null, lastError,
  };
}

export class GmailIntegration {
  constructor(private readonly config: GmailConfig, private readonly google: GoogleGmailClient = googleGmailClient) {}

  async status() {
    const row = await prisma.emailIntegrationCredential.findUnique({
      where: { ...credentialWhere, senderEmail: this.config.senderEmail },
      select: { status: true, lastSuccessfulSendAt: true, lastError: true },
    });
    return {
      enabled: true, senderEmail: this.config.senderEmail, status: row?.status ?? "DISCONNECTED",
      lastSuccessfulSendAt: row?.lastSuccessfulSendAt ?? null,
      lastError: statuses.has(row?.lastError as GmailFailureCode) ? row?.lastError : null,
    };
  }

  async connect(sessionId: string) {
    const row = await prisma.emailIntegrationCredential.upsert({
      where: { id }, create: { ...credentialWhere, senderEmail: this.config.senderEmail, revision: randomUUID() }, update: {},
    });
    if (row.status !== "DISCONNECTED" || row.provider !== id || row.revision.startsWith(connecting)
      || row.revision.startsWith(revoking) || row.encryptedRefreshToken) {
      throw new GmailFailure("CONNECTION_CHANGED");
    }
    let revision = row.revision;
    if (row.senderEmail !== this.config.senderEmail) {
      revision = randomUUID();
      const changed = await prisma.emailIntegrationCredential.updateMany({
        where: { ...credentialWhere, revision: row.revision, status: "DISCONNECTED", encryptedRefreshToken: null },
        data: { senderEmail: this.config.senderEmail, revision, lastError: null },
      });
      if (!changed.count) throw new GmailFailure("CONNECTION_CHANGED");
    }
    const state = newState();
    const now = new Date();
    const data = { digest: stateDigest(state), credentialRevision: revision, expiresAt: new Date(now.getTime() + stateLifetime) };
    await prisma.$transaction([
      prisma.gmailOAuthState.deleteMany({ where: { expiresAt: { lte: now } } }),
      prisma.gmailOAuthState.upsert({ where: { sessionId }, create: { sessionId, ...data }, update: data }),
    ]);
    return authorizationUrl(this.config, state, codeVerifier(state, this.config.encryptionKey));
  }

  async callback(sessionId: string, query: { state?: unknown; code?: unknown; error?: unknown }) {
    const { state, code, error } = query;
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new GmailFailure("INVALID_STATE");
    const [pending] = await prisma.$queryRaw<{ credentialRevision: string }[]>`
      DELETE FROM "GmailOAuthState"
      WHERE "sessionId" = ${sessionId} AND digest = ${stateDigest(state)}
        AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      RETURNING "credentialRevision"
    `;
    if (!pending) throw new GmailFailure("INVALID_STATE");

    const awaiting = { ...credentialWhere, senderEmail: this.config.senderEmail, revision: pending.credentialRevision, status: "DISCONNECTED" as const, encryptedRefreshToken: null };
    const operation = { ...awaiting, revision: connecting + randomUUID() };
    let claimed = false;
    let credential: { encryptedRefreshToken: string; encryptionKeyVersion: number };
    try {
      if (error === "access_denied" && code === undefined) throw new GmailFailure("CONSENT_DENIED");
      if (error !== undefined || typeof code !== "string" || !/^[!-~]{1,4096}$/.test(code)) {
        throw new GmailFailure("INVALID_CALLBACK");
      }
      const result = await prisma.emailIntegrationCredential.updateMany({
        where: awaiting, data: { revision: operation.revision, lastError: null },
      });
      if (!result.count) throw new GmailFailure("CONNECTION_CHANGED");
      claimed = true;

      const token = await this.google.authorize(code, codeVerifier(state, this.config.encryptionKey), this.config);
      credential = { encryptedRefreshToken: encryptRefreshToken(token, this.config), encryptionKeyVersion: KEY_VERSION };
    } catch (failure) {
      const safe = failure instanceof GmailFailure ? failure : new GmailFailure("EXCHANGE_FAILED");
      if (claimed) {
        await prisma.emailIntegrationCredential.updateMany({
          where: { ...operation, status: { in: ["DISCONNECTED", "DISCONNECTING"] } }, data: disconnected(safe.code),
        });
      } else {
        await prisma.emailIntegrationCredential.updateMany({ where: awaiting, data: { lastError: safe.code } });
      }
      throw safe;
    }

    const connected = await prisma.emailIntegrationCredential.updateMany({
      where: operation,
      data: { ...credential, revision: randomUUID(), status: "CONNECTED", connectedAt: new Date(), lastTokenRefreshAt: null, lastError: null },
    });
    if (connected.count) return;

    // If disconnect canceled this exchange, keep the credential blocked and revoke it.
    // Claim revocation in the same write that stores the ciphertext.
    const revocation = { ...credentialWhere, senderEmail: operation.senderEmail, status: "DISCONNECTING" as const, revision: revoking + randomUUID() };
    const canceled = await prisma.emailIntegrationCredential.updateMany({
      where: { ...operation, status: "DISCONNECTING" }, data: { ...credential, revision: revocation.revision },
    });
    if (canceled.count) await this.revokeClaim(revocation, credential);
    throw new GmailFailure("CONNECTION_CHANGED");
  }

  async disconnect() {
    const sender = { ...credentialWhere, senderEmail: this.config.senderEmail };
    const row = await prisma.emailIntegrationCredential.findUnique({ where: credentialWhere });
    if (!row) return;
    if (row.senderEmail !== sender.senderEmail) throw new GmailFailure("CONNECTION_CHANGED");
    const where = { ...sender, status: row.status, revision: row.revision };
    if (row.revision.startsWith(revoking)) throw new GmailFailure("DISCONNECT_IN_PROGRESS");

    if (row.revision.startsWith(connecting)) {
      if (row.status === "DISCONNECTED") {
        const canceled = await prisma.emailIntegrationCredential.updateMany({
          where, data: { status: "DISCONNECTING" },
        });
        if (!canceled.count) throw new GmailFailure("CONNECTION_CHANGED");
      }
      throw new GmailFailure("DISCONNECT_IN_PROGRESS");
    }

    if (!row.encryptedRefreshToken) {
      const cleared = await prisma.emailIntegrationCredential.updateMany({
        where: { ...where, encryptedRefreshToken: null }, data: disconnected(null),
      });
      if (!cleared.count) throw new GmailFailure("CONNECTION_CHANGED");
      return;
    }

    const operation = { ...sender, status: "DISCONNECTING" as const, revision: revoking + randomUUID() };
    const claimed = await prisma.emailIntegrationCredential.updateMany({
      where: { ...where, encryptedRefreshToken: row.encryptedRefreshToken },
      data: { status: operation.status, revision: operation.revision, lastError: null },
    });
    if (!claimed.count) throw new GmailFailure("CONNECTION_CHANGED");
    await this.revokeClaim(operation, { encryptedRefreshToken: row.encryptedRefreshToken, encryptionKeyVersion: row.encryptionKeyVersion });
  }

  private async revokeClaim(
    operation: { id: string; provider: string; senderEmail: string; status: "DISCONNECTING"; revision: string },
    credential: { encryptedRefreshToken: string; encryptionKeyVersion: number | null },
  ) {
    try {
      const token = decryptRefreshToken(credential.encryptedRefreshToken, credential.encryptionKeyVersion, this.config);
      await this.google.revoke(token);
    } catch {
      await prisma.emailIntegrationCredential.updateMany({
        where: operation, data: { revision: randomUUID(), lastError: "REVOCATION_FAILED" },
      });
      throw new GmailFailure("REVOCATION_FAILED");
    }
    const cleared = await prisma.emailIntegrationCredential.updateMany({ where: operation, data: disconnected(null) });
    if (!cleared.count) throw new GmailFailure("CONNECTION_CHANGED");
  }
}

export class GoogleGmailEmailDeliveryProvider implements EmailDeliveryProvider {
  constructor(private readonly config: GmailConfig, private readonly google: GoogleGmailClient = googleGmailClient) {}

  async send(message: OutboundEmail) {
    const raw = gmailMime(this.config.senderEmail, message);
    const row = await prisma.emailIntegrationCredential.findUnique({
      where: { ...credentialWhere, senderEmail: this.config.senderEmail, status: "CONNECTED" },
    });
    if (!row?.encryptedRefreshToken) throw new Error("Gmail delivery requires a connected sender.");

    const where = { ...credentialWhere, revision: row.revision, status: "CONNECTED" as const };
    const currentToken = { ...where, encryptedRefreshToken: row.encryptedRefreshToken };
    let refreshed: Awaited<ReturnType<GoogleGmailClient["refresh"]>>;
    try {
      let token: string;
      try {
        token = decryptRefreshToken(row.encryptedRefreshToken, row.encryptionKeyVersion, this.config);
      } catch {
        throw new GmailFailure("DECRYPT_FAILED");
      }
      refreshed = await this.google.refresh(token, this.config);
      const refreshedToken = refreshed.refreshToken && refreshed.refreshToken !== token
        ? { encryptedRefreshToken: encryptRefreshToken(refreshed.refreshToken, this.config), encryptionKeyVersion: KEY_VERSION }
        : {};
      const updated = await prisma.emailIntegrationCredential.updateMany({
        where: currentToken, data: { lastTokenRefreshAt: new Date(), ...refreshedToken },
      });
      if (!updated.count) throw new GmailFailure("CONNECTION_CHANGED");
    } catch (failure) {
      const code = failure instanceof GmailFailure ? failure.code : "REFRESH_FAILED";
      await prisma.emailIntegrationCredential.updateMany({
        where: currentToken,
        data: { lastError: code, ...(code === "TOKEN_REVOKED" ? { status: "REAUTHORIZATION_REQUIRED" as const } : {}) },
      });
      throw new GmailFailure(code);
    }

    try {
      await this.google.send(refreshed.accessToken, raw);
    } catch {
      await prisma.emailIntegrationCredential.updateMany({ where, data: { lastError: "SEND_FAILED" } });
      throw new GmailFailure("SEND_FAILED");
    }
    // A status-write failure must not turn an accepted send into a retriable failure.
    await prisma.emailIntegrationCredential.updateMany({
      where, data: { lastSuccessfulSendAt: new Date(), lastError: null },
    }).catch(() => process.stderr.write("Gmail acceptance status could not be recorded.\n"));
  }
}
