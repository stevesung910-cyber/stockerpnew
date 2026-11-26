import type { Request } from "express";
import type { AuditOutcome } from "../../database/generated";

export type AuditEventInput = {
  actorUserId?: string | null;
  companyId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: AuditOutcome;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuditRequestContext = Pick<Request, "requestId" | "headers" | "socket"> & {
  auth?: { userId: string; companyId?: string; sessionId: string };
};
