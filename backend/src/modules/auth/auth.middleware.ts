import type { RequestHandler } from "express";
import { prisma } from "../../database/prisma";
import { accountEligibility } from "./account-eligibility";
import { tokenDigest } from "./password";
import { readCookie, SESSION_COOKIE } from "./session";
import { AUDIT_ACTIONS } from "../audit/audit.constants";
import { writeAuditEvent } from "../audit/audit.service";

declare global {
  namespace Express {
    interface Request { auth?: { userId: string; sessionId: string; email: string; displayName: string; emailVerified: boolean; eligibility: "OWNER_APPROVED" | "LEGACY_VERIFIED"; companyId?: string; companyName?: string; roleCode?: string; permissions: string[] } }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) { res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." }, meta: { requestId: req.requestId } }); return; }
    const session = await prisma.authSession.findUnique({ where: { tokenHash: tokenDigest(token) }, include: { user: true, activeCompany: { include: { memberships: { where: { status: "ACTIVE" }, include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } });
    const eligibility = session && accountEligibility(session.user);
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !eligibility) {
      if (session && !session.revokedAt) {
        const now = new Date();
        await prisma.$transaction(async tx => {
          await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now, activeCompanyId: null } });
          await writeAuditEvent(tx, { actorUserId: session.userId, companyId: session.activeCompanyId, action: AUDIT_ACTIONS.AUTH_SESSION_INVALIDATED, targetType: "AuthSession", targetId: session.id, outcome: "SUCCESS", requestId: req.requestId, ipAddress: req.socket.remoteAddress ?? null, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null, metadata: { reason: session.expiresAt <= now ? "EXPIRED" : !session.user.active ? "USER_INACTIVE" : "ACCOUNT_INELIGIBLE" } });
        });
      }
      res.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Your session has expired. Sign in again." }, meta: { requestId: req.requestId } }); return;
    }
    let membership = session.activeCompany?.memberships.find(item => item.userId === session.userId && item.companyId === session.activeCompanyId);
    let activeCompanyId = session.activeCompanyId;
    if (session.activeCompanyId && (!session.activeCompany?.active || session.activeCompany.archivedAt || !membership)) {
      await prisma.authSession.update({ where: { id: session.id }, data: { activeCompanyId: null } });
      activeCompanyId = null;
      membership = undefined;
    }
    req.auth = { userId: session.userId, sessionId: session.id, email: session.user.email, displayName: session.user.displayName, emailVerified: Boolean(session.user.emailVerifiedAt), eligibility, ...(activeCompanyId && session.activeCompany ? { companyId: activeCompanyId, companyName: session.activeCompany.name } : {}), ...(membership ? { roleCode: membership.role.code } : {}), permissions: membership?.role.permissions.map(link => link.permission.key) ?? [] };
    next();
  } catch (error) { next(error); }
};

export const requireCompany: RequestHandler = (req, res, next) => {
  if (!req.auth?.companyId) { res.status(409).json({ error: { code: "COMPANY_CONTEXT_REQUIRED", message: "Select an authorized company first." }, meta: { requestId: req.requestId } }); return; }
  next();
};
export const requireVerifiedEmail: RequestHandler = (req, res, next) => {
  if (!req.auth?.emailVerified) { res.status(403).json({ error: { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your account email before accepting a company invitation." }, meta: { requestId: req.requestId } }); return; }
  next();
};
export const requirePermission = (permission: string): RequestHandler => async (req, res, next) => {
  if (!req.auth?.permissions.includes(permission)) {
    try {
      await writeAuditEvent(prisma, {
        actorUserId: req.auth?.userId ?? null,
        companyId: req.auth?.companyId ?? null,
        action: AUDIT_ACTIONS.AUTHORIZATION_DENIED,
        targetType: "Permission",
        targetId: permission,
        outcome: "FAILURE",
        requestId: req.requestId,
        ipAddress: req.socket.remoteAddress ?? null,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null,
        metadata: { requiredPermission: permission, method: req.method, path: req.path },
      });
    } catch (error) { next(error); return; }
    res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." }, meta: { requestId: req.requestId } });
    return;
  }
  next();
};
