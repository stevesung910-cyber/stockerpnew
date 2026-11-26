import { isGmailOwner } from "../google-gmail/gmail-config";
import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../database/prisma";
import { requireAuth } from "./auth.middleware";
import { hashPassword, newOpaqueToken, tokenDigest, verifyPassword } from "./password";
import { accountEligibility } from "./account-eligibility";
import { confirmRegistration, dispatchRegistrationNotification, registrationAuditContext, resendRegistration, startRegistration } from "./registration.service";
import { authRateLimit, registrationRateLimit } from "./rate-limit";
import { clearSessionCookie, readCookie, SESSION_COOKIE, SESSION_TTL_MS, setSessionCookie } from "./session";
import { mayExposeDevelopmentTokens } from "../../config/env";
import { deliverEmail, hasConfiguredEmailProvider } from "./email-delivery";
import { AUDIT_ACTIONS } from "../audit/audit.constants";
import { auditContext, writeAuditEvent } from "../audit/audit.service";

export const authRouter = Router();
const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const registerSchema = z.object({ email: emailSchema, displayName: z.string().trim().min(2).max(100), password: z.string().min(12).max(128) });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const dummyHash = hashPassword("StockERP-invalid-login-check-password");

async function createVerificationToken(userId: string, email: string, allowDevelopmentExposure = true) {
  const exposeToken = allowDevelopmentExposure && mayExposeDevelopmentTokens();
  const hasProvider = hasConfiguredEmailProvider();
  if (!exposeToken && !hasProvider) return undefined;
  const token = newOpaqueToken();
  const row = await prisma.emailVerificationToken.create({ data: { tokenHash: tokenDigest(token), userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  if (exposeToken) return token;
  try {
    const origin = process.env.FRONTEND_ORIGIN;
    if (!origin) throw new Error("FRONTEND_ORIGIN is required to create a verification link.");
    const delivered = await deliverEmail({ to: email, subject: "Verify your StockERP email", text: `Verify your email using this link: ${origin}/verify-email?token=${encodeURIComponent(token)}. This link expires in 24 hours and can be used once.` });
    if (!delivered) throw new Error("No email provider is configured.");
    return undefined;
  } catch {
    await prisma.emailVerificationToken.delete({ where: { id: row.id } });
    return undefined;
  }
}

const genericVerificationMessage = "If verification is available for this account, instructions will be sent to its email address.";

const continuationSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pendingMessage = "If registration can proceed, the software owner will receive an approval request.";

authRouter.post("/register", registrationRateLimit("register"), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const input = registerSchema.parse(req.body);
    const context = registrationAuditContext(req);
    const { continuation, dispatch } = await startRegistration(input, context);
    res.status(202).json({ data: { message: pendingMessage, continuation }, meta: { requestId: req.requestId } });
    dispatchRegistrationNotification(dispatch, context);
  } catch (error) { next(error); }
});

authRouter.post("/register/resend", registrationRateLimit("resend"), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const { continuation } = z.object({ continuation: continuationSchema }).parse(req.body);
    const context = registrationAuditContext(req);
    const dispatch = await resendRegistration(continuation, context);
    res.status(202).json({ data: { message: pendingMessage }, meta: { requestId: req.requestId } });
    dispatchRegistrationNotification(dispatch, context);
  } catch (error) { next(error); }
});

function invalidApproval(res: Response, requestId: string) {
  res.status(400).json({ error: { code: "REGISTRATION_CODE_INVALID", message: "The approval code is invalid or unavailable. Check the code or request a new one when available." }, meta: { requestId } });
}

authRouter.post("/register/confirm", registrationRateLimit("confirm"), async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const input = z.object({ continuation: continuationSchema, otp: z.string().regex(/^\d{8}$/) }).safeParse(req.body);
    const context = registrationAuditContext(req);
    if (!input.success) {
      await writeAuditEvent(prisma, { ...context, targetType: "RegistrationRequest", action: AUDIT_ACTIONS.REGISTRATION_OTP_FAILED, outcome: "FAILURE" });
      invalidApproval(res, req.requestId);
      return;
    }
    if (!await confirmRegistration(input.data.continuation, input.data.otp, context)) {
      invalidApproval(res, req.requestId);
      return;
    }
    res.json({ data: { message: "Your account has been approved. Sign in to continue." }, meta: { requestId: req.requestId } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      invalidApproval(res, req.requestId);
      return;
    }
    next(error);
  }
});

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = await verifyPassword(input.password, user?.passwordHash ?? await dummyHash);
    if (!user || !accountEligibility(user) || !valid) {
      await writeAuditEvent(prisma, { ...auditContext(req), actorUserId: user?.id ?? null, action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED, targetType: "Authentication", outcome: "FAILURE", metadata: { attemptedEmail: input.email, reason: !user ? "UNKNOWN_ACCOUNT" : !accountEligibility(user) ? "ACCOUNT_INELIGIBLE" : "INVALID_PASSWORD" } });
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }, meta: { requestId: req.requestId } }); return; }
    const token = newOpaqueToken();
    const sessionCreated = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || !accountEligibility(current) || current.passwordHash !== user.passwordHash) return false;
      const created = await tx.authSession.create({ data: { tokenHash: tokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: user.id, action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCEEDED, targetType: "AuthSession", targetId: created.id, outcome: "SUCCESS" });
      return true;
    });
    if (!sessionCreated) {
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }, meta: { requestId: req.requestId } });
      return;
    }
    setSessionCookie(res, token);
    const companies = await prisma.companyMembership.findMany({ where: { userId: user.id, status: "ACTIVE", company: { active: true } }, include: { company: { select: { id: true, name: true, legalName: true, gstin: true, active: true } }, role: { select: { code: true, name: true } } } });
    res.json({ data: { user: { id: user.id, email: user.email, displayName: user.displayName }, companies: companies.map(item => ({ ...item.company, role: item.role })) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const session = await prisma.authSession.findUnique({ where: { tokenHash: tokenDigest(token) }, select: { id: true, userId: true, activeCompanyId: true } });
      await prisma.$transaction(async tx => {
        await tx.authSession.updateMany({ where: { tokenHash: tokenDigest(token), revokedAt: null }, data: { revokedAt: new Date(), activeCompanyId: null } });
        if (session) await writeAuditEvent(tx, { ...auditContext(req), actorUserId: session.userId, companyId: session.activeCompanyId, action: AUDIT_ACTIONS.AUTH_LOGOUT, targetType: "AuthSession", targetId: session.id, outcome: "SUCCESS" });
      });
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) { next(error); }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { id: true, email: true, displayName: true, emailVerifiedAt: true, ownerApprovedAt: true } });
    const memberships = await prisma.companyMembership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { company: { select: { id: true, name: true, legalName: true, gstin: true, active: true, archivedAt: true } }, role: { select: { code: true, name: true, permissions: { include: { permission: { select: { key: true } } } } } } } });
    res.json({ data: { user: { ...user, eligibility: req.auth!.eligibility }, canManageGmail: isGmailOwner(req.auth), activeCompanyId: req.auth!.companyId ?? null, companies: memberships.map(item => ({ ...item.company, role: item.role.name, roleCode: item.role.code, permissions: item.role.permissions.map(link => link.permission.key) })) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

authRouter.post("/verify-email/request", requireAuth, authRateLimit, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { email: true, emailVerifiedAt: true } });
    let developmentVerificationToken: string | undefined;
    if (user && !user.emailVerifiedAt) developmentVerificationToken = await createVerificationToken(req.auth!.userId, user.email);
    res.status(202).json({ data: { message: genericVerificationMessage, ...(developmentVerificationToken ? { developmentVerificationToken } : {}) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

// Legacy users cannot sign in before mailbox verification. Require their existing password
// before issuing a replacement link and again when consuming it.
authRouter.post("/verify-email/legacy-request", authRateLimit, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
    if (valid && user?.active && user.legacyRegistration && !user.emailVerifiedAt) {
      await createVerificationToken(user.id, user.email, false);
    }
    res.status(202).json({ data: { message: genericVerificationMessage }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

authRouter.post("/verify-email/confirm", authRateLimit, async (req, res, next) => {
  try {
    const { token, password } = z.object({ token: z.string().min(20).max(200), password: loginSchema.shape.password }).parse(req.body);
    const digest = tokenDigest(token);
    const candidate = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: digest }, include: { user: true } });
    const valid = await verifyPassword(password, candidate?.user.passwordHash ?? await dummyHash);
    const now = new Date();
    if (!candidate || !valid) throw Object.assign(new Error("The verification link or password is invalid."), { status: 400, code: "VERIFICATION_TOKEN_INVALID" });
    await prisma.$transaction(async tx => {
      const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: digest } });
      if (!row || row.usedAt || row.expiresAt <= now) throw Object.assign(new Error("This verification link is invalid or expired."), { status: 400, code: "VERIFICATION_TOKEN_INVALID" });
      const used = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (used.count !== 1) throw Object.assign(new Error("This verification link is invalid or expired."), { status: 400, code: "VERIFICATION_TOKEN_INVALID" });
      await tx.user.update({ where: { id: row.userId, active: true, passwordHash: candidate.user.passwordHash }, data: { emailVerifiedAt: now } });
      if (candidate.user.legacyRegistration && !candidate.user.emailVerifiedAt) {
        await tx.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now, activeCompanyId: null } });
      }
      await tx.emailVerificationToken.updateMany({ where: { userId: row.userId, id: { not: row.id }, usedAt: null }, data: { usedAt: now } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: row.userId, action: AUDIT_ACTIONS.EMAIL_VERIFIED, targetType: "User", targetId: row.userId, outcome: "SUCCESS" });
    });
    res.json({ data: { message: "Email verified. You can now sign in or accept a company invitation." }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

authRouter.post("/forgot-password", authRateLimit, async (req, res, next) => {
  try {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, active: true, emailVerifiedAt: true, legacyRegistration: true, ownerApprovedAt: true } });
    let developmentResetToken: string | undefined;
    const exposeToken = mayExposeDevelopmentTokens();
    if (user?.emailVerifiedAt && accountEligibility(user) && (exposeToken || hasConfiguredEmailProvider())) {
      const token = newOpaqueToken();
      const reset = await prisma.passwordResetToken.create({ data: { tokenHash: tokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      try {
        if (exposeToken) developmentResetToken = token;
        else {
          const origin = process.env.FRONTEND_ORIGIN;
          if (!origin) throw new Error("FRONTEND_ORIGIN is required to create a reset link.");
          const delivered = await deliverEmail({ to: email, subject: "StockERP password reset", text: `Reset your StockERP password using this link: ${origin}/reset-password?token=${encodeURIComponent(token)}. This link expires in 30 minutes and can be used once.` });
          if (!delivered) throw new Error("No email provider is configured.");
        }
      } catch (error) {
        await prisma.passwordResetToken.delete({ where: { id: reset.id } });
        if (process.env.NODE_ENV !== "production") process.stderr.write(`Password reset delivery unavailable: ${error instanceof Error ? error.message : "provider error"}\n`);
      }
    }
    res.status(202).json({ data: { message: "If an account exists and secure email delivery is available, password reset instructions will be delivered.", ...(developmentResetToken ? { developmentResetToken } : {}) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

authRouter.post("/reset-password", authRateLimit, async (req, res, next) => {
  try {
    const input = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(128) }).parse(req.body);
    const digest = tokenDigest(input.token); const now = new Date(); const passwordHash = await hashPassword(input.password);
    await prisma.$transaction(async tx => {
      const token = await tx.passwordResetToken.findUnique({ where: { tokenHash: digest } });
      const account = token && await tx.user.findUnique({ where: { id: token.userId } });
      if (!token || token.usedAt || token.expiresAt <= now || !account?.active || !account.emailVerifiedAt || !accountEligibility(account)) throw Object.assign(new Error("This reset link is invalid or expired."), { status: 400, code: "RESET_TOKEN_INVALID" });
      const used = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (used.count !== 1) throw Object.assign(new Error("This reset link is invalid or expired."), { status: 400, code: "RESET_TOKEN_INVALID" });
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.authSession.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now, activeCompanyId: null } });
      await tx.passwordResetToken.updateMany({ where: { userId: token.userId, id: { not: token.id }, usedAt: null }, data: { usedAt: now } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: token.userId, action: AUDIT_ACTIONS.PASSWORD_RESET, targetType: "User", targetId: token.userId, outcome: "SUCCESS" });
    });
    clearSessionCookie(res);
    res.json({ data: { message: "Password updated. Sign in with your new password." }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});
