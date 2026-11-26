-- Append-only audit storage. Actor/company IDs intentionally have no FKs.
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "companyId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "outcome" "AuditOutcome" NOT NULL,
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");
