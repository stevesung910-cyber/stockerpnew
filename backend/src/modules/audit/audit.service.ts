import type { Prisma } from "../../database/generated";
import type { AuditEventInput, AuditRequestContext } from "./audit.types";

type AuditDb = Pick<Prisma.TransactionClient, "auditEvent">;
// Role identifiers are authorization metadata. Activation codes and similar secrets are redacted.
const SAFE_CODE_KEYS = new Set(["roleCode", "oldRoleCode", "newRoleCode"]);
const SECRET_KEY = /(password|passwd|secret|token|cookie|authorization|api.?key|credential|session|otp|code|challenge|hmac|continuation)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;

function sanitizeValue(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null) return undefined;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1) ?? null);
  if (typeof value === "object") {
    const clean: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      if (!SAFE_CODE_KEYS.has(key) && SECRET_KEY.test(key)) continue;
      const safe = sanitizeValue(item, depth + 1);
      if (safe !== undefined) clean[key.slice(0, 80)] = safe;
    }
    return clean;
  }
  return undefined;
}

export function sanitizeAuditMetadata(metadata?: Record<string, unknown> | null): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  return sanitizeValue(metadata) ?? undefined;
}

export async function writeAuditEvent(db: AuditDb, input: AuditEventInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      companyId: input.companyId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      metadata: sanitizeAuditMetadata(input.metadata),
    },
  });
}

export function auditContext(req: AuditRequestContext) {
  return {
    requestId: req.requestId,
    ipAddress: req.socket.remoteAddress ?? null,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null,
    actorUserId: req.auth?.userId ?? null,
    companyId: req.auth?.companyId ?? null,
  };
}
