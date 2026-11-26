CREATE TYPE "GmailConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'DISCONNECTING', 'REAUTHORIZATION_REQUIRED');

CREATE TABLE "EmailIntegrationCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "senderEmail" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT,
  "encryptionKeyVersion" INTEGER,
  "revision" TEXT NOT NULL,
  "status" "GmailConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "connectedAt" TIMESTAMP(3),
  "lastTokenRefreshAt" TIMESTAMP(3),
  "lastSuccessfulSendAt" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "GmailOAuthState" (
  "sessionId" TEXT NOT NULL PRIMARY KEY,
  "digest" TEXT NOT NULL,
  "credentialRevision" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GmailOAuthState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GmailOAuthState_expiresAt_idx" ON "GmailOAuthState"("expiresAt");
