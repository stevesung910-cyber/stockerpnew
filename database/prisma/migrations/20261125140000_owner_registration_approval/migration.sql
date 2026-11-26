BEGIN;

-- Preserve the legacy cohort explicitly. Future User inserts must opt in to legacy classification.
ALTER TABLE "User"
  ADD COLUMN "ownerApprovedAt" TIMESTAMP(3),
  ADD COLUMN "legacyRegistration" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "legacyRegistration" SET DEFAULT false;
CREATE INDEX "User_normalized_email_idx" ON "User" (lower(btrim("email")));

CREATE TABLE "RegistrationRequest" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "pendingEmail" TEXT UNIQUE,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "continuationHash" TEXT UNIQUE,
  "otpDigest" TEXT,
  "challengeVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("challengeVersion" > 0),
  "otpExpiresAt" TIMESTAMP(3) NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("failedAttempts" BETWEEN 0 AND 5),
  "lastIssuedAt" TIMESTAMP(3) NOT NULL,
  "providerAccepted" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "resultingUserId" TEXT UNIQUE REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK ("pendingEmail" IS NULL OR "pendingEmail" = "email"),
  CHECK ("consumedAt" IS NULL OR (
    "pendingEmail" IS NULL AND "passwordHash" IS NULL AND "continuationHash" IS NULL AND "otpDigest" IS NULL
  ))
);
CREATE INDEX "RegistrationRequest_expiresAt_idx" ON "RegistrationRequest" ("expiresAt");

CREATE TABLE "AuthRateLimitBucket" (
  "key" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthRateLimitBucket_expiresAt_idx" ON "AuthRateLimitBucket" ("expiresAt");

COMMIT;
