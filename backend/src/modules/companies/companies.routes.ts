import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../database/prisma";
import { accountEligibility } from "../auth/account-eligibility";
import { requireAuth, requireCompany, requirePermission, requireVerifiedEmail } from "../auth/auth.middleware";
import { seedCompanyRoles } from "./role-seed";
import { assertActiveCompanyPermission, assertRoleAssignable, assertRoleEditAuthority, assertRolePermissionsWithinActor, roleIsAssignable } from "./role-authorization";
import { companyCreationRateLimit } from "../auth/rate-limit";
import { newOpaqueToken, tokenDigest } from "../auth/password";
import { deliverEmail, hasConfiguredEmailProvider } from "../auth/email-delivery";
import { mayExposeDevelopmentTokens } from "../../config/env";
import { AUDIT_ACTIONS } from "../audit/audit.constants";
import { auditContext, writeAuditEvent } from "../audit/audit.service";

export const companiesRouter = Router();
const phone = z.string().regex(/^\d{10}$/).optional().or(z.literal(""));
const companyFields = {
  name: z.string().trim().min(2).max(160), legalName: z.string().trim().max(200).optional().nullable(), gstin: z.string().trim().max(15).optional().nullable(), pan: z.string().trim().max(10).optional().nullable(), cin: z.string().trim().max(21).optional().nullable(),
  businessType: z.string().trim().max(80).optional().nullable(), logoUrl: z.string().url().max(1000).optional().nullable().or(z.literal("")), addressLine1: z.string().trim().max(200).optional().nullable(), addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(), state: z.string().trim().max(100).optional().nullable(), pinCode: z.string().trim().max(10).optional().nullable(), phone, email: z.string().email().max(254).optional().nullable().or(z.literal("")), website: z.string().url().max(255).optional().nullable().or(z.literal("")),
  gstRegistrationType: z.string().trim().max(50).optional().nullable(), financialYearStartMonth: z.number().int().min(1).max(12).optional(), timezone: z.string().trim().min(3).max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }).optional(), currency: z.string().trim().length(3).default("INR"), bankName: z.string().trim().max(100).optional().nullable(), bankAccountName: z.string().trim().max(150).optional().nullable(), bankAccountNumber: z.string().trim().max(50).optional().nullable(), bankIfsc: z.string().trim().max(20).optional().nullable(), authorizedSignatory: z.string().trim().max(150).optional().nullable(), qrCodeUrl: z.string().url().max(1000).optional().nullable().or(z.literal("")),
};
const createCompanySchema = z.object(companyFields);
const updateCompanySchema = z.object(companyFields).partial();
const companySelect = { id: true, name: true, legalName: true, gstin: true, pan: true, cin: true, businessType: true, logoUrl: true, addressLine1: true, addressLine2: true, city: true, state: true, pinCode: true, phone: true, email: true, website: true, gstRegistrationType: true, financialYearStartMonth: true, timezone: true, currency: true, bankName: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true, authorizedSignatory: true, qrCodeUrl: true, active: true, archivedAt: true, createdAt: true, updatedAt: true } as const;
const companyListSelect = { id: true, name: true, legalName: true, gstin: true, active: true, archivedAt: true } as const;

async function assertEligibleAccount(tx: Pick<typeof prisma, "user">, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || !accountEligibility(user)) {
    throw Object.assign(new Error("Sign in to continue."), { status: 401, code: "UNAUTHENTICATED" });
  }
  return user;
}

companiesRouter.use(requireAuth);

companiesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.companyMembership.findMany({ where: { userId: req.auth!.userId, status: "ACTIVE" }, include: { company: { select: companyListSelect }, role: { select: { id: true, name: true, code: true } } }, orderBy: { company: { name: "asc" } } });
    res.json({ data: { activeCompanyId: req.auth!.companyId ?? null, companies: rows.map(row => ({ ...row.company, role: row.role })) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/", companyCreationRateLimit, async (req, res, next) => {
  try {
    const input = createCompanySchema.parse(req.body);
    const company = await prisma.$transaction(async tx => {
      await assertEligibleAccount(tx, req.auth!.userId);
      const memberships = await tx.companyMembership.findMany({
        where: { userId: req.auth!.userId },
        include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
      });
      if (memberships.length > 0 && !memberships.some(membership => membership.status === "ACTIVE"
        && membership.role.code === "COMPANY_ADMIN"
        && membership.role.permissions.some(link => link.permission.key === "company.create"))) {
        throw Object.assign(new Error("Creating another company requires an active Company Admin role with company creation permission."), { status: 403, code: "COMPANY_CREATION_FORBIDDEN" });
      }
      const created = await tx.company.create({ data: input });
      const { companyAdminRoleId } = await seedCompanyRoles(tx, created.id);
      await tx.companyMembership.create({ data: { userId: req.auth!.userId, companyId: created.id, roleId: companyAdminRoleId } });
      const changed = await tx.authSession.updateMany({ where: { id: req.auth!.sessionId, userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { activeCompanyId: created.id } });
      if (changed.count !== 1) throw Object.assign(new Error("Your session expired. Sign in again."), { status: 401, code: "SESSION_EXPIRED" });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: req.auth!.userId, companyId: created.id, action: AUDIT_ACTIONS.COMPANY_CREATED, targetType: "Company", targetId: created.id, outcome: "SUCCESS", metadata: { companyName: created.name } });
      return created;
    }, { maxWait: 10_000, timeout: 30_000, isolationLevel: "Serializable" });
    res.status(201).json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/switch", async (req, res, next) => {
  try {
    const { companyId } = z.object({ companyId: z.string().min(1).max(100) }).parse(req.body);
    const company = await prisma.$transaction(async tx => {
      await assertEligibleAccount(tx, req.auth!.userId);
      const session = await tx.authSession.findFirst({ where: { id: req.auth!.sessionId, userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!session) throw Object.assign(new Error("Your session has expired. Sign in again."), { status: 401, code: "SESSION_EXPIRED" });
      const membership = await tx.companyMembership.findFirst({ where: { userId: session.userId, companyId, status: "ACTIVE", company: { active: true, archivedAt: null } }, include: { company: { select: companySelect } } });
      if (!membership) throw Object.assign(new Error("You do not have active access to that company."), { status: 403, code: "COMPANY_ACCESS_DENIED" });
      await tx.authSession.update({ where: { id: session.id }, data: { activeCompanyId: companyId } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: req.auth!.userId, companyId, action: AUDIT_ACTIONS.COMPANY_CONTEXT_SWITCHED, targetType: "Company", targetId: companyId, outcome: "SUCCESS", metadata: { previousCompanyId: session.activeCompanyId } });
      return membership.company;
    });
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.get("/current", requireCompany, requirePermission("company.view"), async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: req.auth!.companyId }, select: companySelect });
    if (!company) { res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found." }, meta: { requestId: req.requestId } }); return; }
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.patch("/current", requireCompany, requirePermission("company.edit"), async (req, res, next) => {
  try {
    const input = updateCompanySchema.parse(req.body);
    const company = await prisma.$transaction(async tx => {
      await assertActiveCompanyPermission(tx, req.auth!.userId, req.auth!.companyId!, "company.edit");
      const updated = await tx.company.update({ where: { id: req.auth!.companyId }, data: input, select: companySelect });
      await writeAuditEvent(tx, { ...auditContext(req), action: AUDIT_ACTIONS.COMPANY_UPDATED, targetType: "Company", targetId: updated.id, outcome: "SUCCESS", metadata: { changedFields: Object.keys(input) } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.patch("/current/status", requireCompany, requirePermission("company.edit"), async (req, res, next) => {
  try {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const company = await prisma.$transaction(async tx => {
      await assertActiveCompanyPermission(tx, req.auth!.userId, req.auth!.companyId!, "company.edit");
      const updated = await tx.company.update({ where: { id: req.auth!.companyId }, data: { active }, select: companySelect });
      if (!active) {
        await tx.authSession.updateMany({ where: { activeCompanyId: updated.id, revokedAt: null }, data: { activeCompanyId: null } });
        await tx.companyInvitation.updateMany({ where: { companyId: updated.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await writeAuditEvent(tx, { ...auditContext(req), action: AUDIT_ACTIONS.COMPANY_STATUS_CHANGED, targetType: "Company", targetId: updated.id, outcome: "SUCCESS", metadata: { active } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.patch("/:companyId/status", async (req, res, next) => {
  try {
    const { active } = z.object({ active: z.boolean() }).parse(req.body); const companyId = String(req.params.companyId);
    const company = await prisma.$transaction(async tx => {
      await assertActiveCompanyPermission(tx, req.auth!.userId, companyId, "company.edit", true);
      const updated = await tx.company.update({ where: { id: companyId }, data: { active, ...(active ? { archivedAt: null } : {}) }, select: companySelect });
      if (!active) {
        await tx.authSession.updateMany({ where: { activeCompanyId: updated.id, revokedAt: null }, data: { activeCompanyId: null } });
        await tx.companyInvitation.updateMany({ where: { companyId: updated.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: req.auth!.userId, companyId: updated.id, action: AUDIT_ACTIONS.COMPANY_STATUS_CHANGED, targetType: "Company", targetId: updated.id, outcome: "SUCCESS", metadata: { active } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/:companyId/archive", async (req, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const company = await prisma.$transaction(async tx => {
      await assertActiveCompanyPermission(tx, req.auth!.userId, companyId, "company.edit");
      const updated = await tx.company.update({ where: { id: companyId }, data: { active: false, archivedAt: new Date() }, select: companySelect });
      await tx.authSession.updateMany({ where: { activeCompanyId: updated.id, revokedAt: null }, data: { activeCompanyId: null } });
      await tx.companyInvitation.updateMany({ where: { companyId: updated.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: req.auth!.userId, companyId: updated.id, action: AUDIT_ACTIONS.COMPANY_ARCHIVED, targetType: "Company", targetId: updated.id, outcome: "SUCCESS" });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { company }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.get("/members", requireCompany, requirePermission("users.view"), async (req, res, next) => {
  try {
    const members = await prisma.companyMembership.findMany({ where: { companyId: req.auth!.companyId }, include: { user: { select: { id: true, email: true, displayName: true, active: true } }, role: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "asc" } });
    res.json({ data: { members: members.map(member => ({ id: member.id, status: member.status, createdAt: member.createdAt, user: member.user, role: member.role })) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.get("/assignable-roles", requireCompany, requirePermission("users.create"), async (req, res, next) => {
  try {
    const [actor, roles] = await Promise.all([
      prisma.companyMembership.findFirst({ where: { userId: req.auth!.userId, companyId: req.auth!.companyId!, status: "ACTIVE" }, include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } }),
      prisma.companyRole.findMany({ where: { companyId: req.auth!.companyId! }, include: { permissions: { include: { permission: { select: { key: true } } } } }, orderBy: { name: "asc" } }),
    ]);
    if (!actor) { res.status(403).json({ error: { code: "COMPANY_ACCESS_DENIED", message: "Active company membership is required." }, meta: { requestId: req.requestId } }); return; }
    const actorKeys = actor.role.permissions.map(link => link.permission.key);
    const assignable = roles.filter(role => roleIsAssignable(actor.role.code, actorKeys, role.code, role.permissions.map(link => link.permission.key)));
    res.json({ data: { roles: assignable.map(role => ({ id: role.id, code: role.code, name: role.name })) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/invitations", requireCompany, requirePermission("users.create"), async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), roleCode: z.string().min(2).max(50) }).parse(req.body);
    if (input.email === req.auth!.email) { res.status(403).json({ error: { code: "SELF_INVITATION_FORBIDDEN", message: "You cannot invite your own account to change its company role." }, meta: { requestId: req.requestId } }); return; }
    const exposeToken = mayExposeDevelopmentTokens();
    if (!exposeToken && !hasConfiguredEmailProvider()) {
      res.status(503).json({ error: { code: "EMAIL_DELIVERY_UNAVAILABLE", message: "Configure secure email delivery or enable the explicit local development token workflow." }, meta: { requestId: req.requestId } }); return;
    }
    const token = newOpaqueToken(); const tokenHash = tokenDigest(token);
    const invitation = await prisma.$transaction(async tx => {
      const role = await tx.companyRole.findUnique({ where: { companyId_code: { companyId: req.auth!.companyId!, code: input.roleCode } }, select: { id: true } });
      if (!role) throw Object.assign(new Error("Role not found in this company."), { status: 404, code: "ROLE_NOT_FOUND" });
      await assertRoleAssignable(tx, req.auth!.userId, req.auth!.companyId!, role.id, "create");
      const created = await tx.companyInvitation.create({ data: { tokenHash, email: input.email, companyId: req.auth!.companyId!, roleId: role.id, invitedByUserId: req.auth!.userId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
      await writeAuditEvent(tx, { ...auditContext(req), action: AUDIT_ACTIONS.INVITATION_CREATED, targetType: "CompanyInvitation", targetId: created.id, outcome: "SUCCESS", metadata: { invitedEmail: input.email, roleId: role.id } });
      return created;
    }, { isolationLevel: "Serializable" });
    if (!exposeToken) {
      try {
        const origin = process.env.FRONTEND_ORIGIN;
        if (!origin || !await deliverEmail({ to: input.email, subject: "StockERP company invitation", text: `Accept your invitation using this link: ${origin}/accept-invitation?token=${encodeURIComponent(token)}. This invitation expires in 7 days.` })) throw new Error("Invitation delivery unavailable.");
      } catch {
        await prisma.$transaction(async tx => {
          const revokedAt = new Date();
          const revoked = await tx.companyInvitation.updateMany({
            where: { id: invitation.id, acceptedAt: null, revokedAt: null },
            data: { revokedAt },
          });
          if (revoked.count === 1) {
            await writeAuditEvent(tx, {
              ...auditContext(req),
              actorUserId: req.auth!.userId,
              companyId: req.auth!.companyId!,
              action: AUDIT_ACTIONS.INVITATION_DELIVERY_FAILED,
              targetType: "CompanyInvitation",
              targetId: invitation.id,
              outcome: "FAILURE",
              metadata: { reason: "EMAIL_DELIVERY_FAILED" },
            });
          }
        }, { isolationLevel: "Serializable" });
        res.status(503).json({ error: { code: "EMAIL_DELIVERY_FAILED", message: "The invitation could not be delivered. No membership was created." }, meta: { requestId: req.requestId } }); return;
      }
    }
    res.status(201).json({ data: { invitation: { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt }, ...(exposeToken ? { developmentInvitationToken: token } : {}) }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/invitations/:invitationId/revoke", requireCompany, requirePermission("users.edit"), async (req, res, next) => {
  try {
    const invitationId = String(req.params.invitationId);
    const revoked = await prisma.$transaction(async tx => {
      const result = await tx.companyInvitation.updateMany({
        where: { id: invitationId, companyId: req.auth!.companyId!, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) throw Object.assign(new Error("Pending invitation not found."), { status: 404, code: "INVITATION_NOT_FOUND" });
      await writeAuditEvent(tx, { ...auditContext(req), action: "INVITATION_REVOKED", targetType: "CompanyInvitation", targetId: invitationId, outcome: "SUCCESS" });
      return true;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { revoked }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.post("/invitations/accept", requireVerifiedEmail, async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body); const now = new Date();
    const membership = await prisma.$transaction(async tx => {
      const invitation = await tx.companyInvitation.findUnique({ where: { tokenHash: tokenDigest(token) }, include: { company: true } });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now || !invitation.company.active || invitation.company.archivedAt) throw Object.assign(new Error("This invitation is invalid or expired."), { status: 400, code: "INVITATION_INVALID" });
      const user = await assertEligibleAccount(tx, req.auth!.userId);
      if (!user.emailVerifiedAt || user.email.toLowerCase() !== invitation.email.toLowerCase()) throw Object.assign(new Error("The signed-in, verified account must match the invited email address."), { status: 403, code: "INVITATION_EMAIL_MISMATCH" });
      const existing = await tx.companyMembership.findUnique({ where: { userId_companyId: { userId: req.auth!.userId, companyId: invitation.companyId } } });
      if (existing) throw Object.assign(new Error("This account already has a membership in the company."), { status: 409, code: "MEMBERSHIP_ALREADY_EXISTS" });
      await assertRoleAssignable(tx, invitation.invitedByUserId, invitation.companyId, invitation.roleId, "create");
      const claimed = await tx.companyInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
      if (claimed.count !== 1) throw Object.assign(new Error("This invitation is invalid or expired."), { status: 400, code: "INVITATION_INVALID" });
      const created = await tx.companyMembership.create({ data: { userId: req.auth!.userId, companyId: invitation.companyId, roleId: invitation.roleId }, include: { company: { select: { id: true, name: true } }, role: { select: { code: true, name: true } } } });
      await writeAuditEvent(tx, { ...auditContext(req), actorUserId: req.auth!.userId, companyId: invitation.companyId, action: AUDIT_ACTIONS.INVITATION_ACCEPTED, targetType: "CompanyInvitation", targetId: invitation.id, outcome: "SUCCESS", metadata: { membershipId: created.id } });
      return created;
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ data: { membership: { id: membership.id, company: membership.company, role: membership.role } }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.patch("/members/:membershipId", requireCompany, requirePermission("users.edit"), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]).optional(), roleCode: z.string().min(2).max(50).optional() }).refine(value => Object.keys(value).length > 0).parse(req.body);
    const membership = await prisma.$transaction(async tx => {
      const current = await tx.companyMembership.findFirst({ where: { id: String(req.params.membershipId), companyId: req.auth!.companyId }, include: { role: true } });
      if (!current) throw Object.assign(new Error("Company membership not found."), { status: 404, code: "MEMBERSHIP_NOT_FOUND" });
      if (current.userId === req.auth!.userId && (input.status === "SUSPENDED" || input.roleCode !== undefined)) throw Object.assign(new Error("You cannot suspend or change your own company role."), { status: 409, code: "SELF_LOCKOUT_BLOCKED" });
      let roleId: string | undefined;
      if (input.roleCode) {
        const role = await tx.companyRole.findUnique({ where: { companyId_code: { companyId: req.auth!.companyId!, code: input.roleCode } }, select: { id: true } });
        if (!role) throw Object.assign(new Error("Role not found in this company."), { status: 404, code: "ROLE_NOT_FOUND" });
        await assertRoleAssignable(tx, req.auth!.userId, req.auth!.companyId!, role.id, "edit");
        roleId = role.id;
      } else {
        await tx.companyMembership.findFirstOrThrow({ where: { userId: req.auth!.userId, companyId: req.auth!.companyId!, status: "ACTIVE", role: { permissions: { some: { permission: { key: "users.edit" } } } } } });
      }
      const updated = await tx.companyMembership.update({ where: { id: current.id }, data: { ...(input.status ? { status: input.status } : {}), ...(roleId ? { roleId } : {}) }, include: { user: { select: { id: true, email: true, displayName: true, active: true } }, role: { select: { id: true, code: true, name: true } } } });
      await writeAuditEvent(tx, { ...auditContext(req), action: AUDIT_ACTIONS.MEMBERSHIP_UPDATED, targetType: "CompanyMembership", targetId: updated.id, outcome: "SUCCESS", metadata: { targetUserId: updated.user.id, status: updated.status, roleCode: updated.role.code } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { member: { id: membership.id, status: membership.status, user: membership.user, role: membership.role } }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.get("/roles", requireCompany, requirePermission("roles.view"), async (req, res, next) => {
  try {
    const roles = await prisma.companyRole.findMany({ where: { companyId: req.auth!.companyId }, include: { permissions: { include: { permission: { select: { key: true, module: true, action: true } } } } }, orderBy: { name: "asc" } });
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }], select: { key: true, module: true, action: true } });
    res.json({ data: { roles: roles.map(role => ({ id: role.id, code: role.code, name: role.name, description: role.description, isSystem: role.isSystem, permissions: role.permissions.map(link => link.permission.key) })), permissions }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});

companiesRouter.patch("/roles/:roleId", requireCompany, requirePermission("roles.edit"), async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(250).nullable().optional(), permissions: z.array(z.string().min(1).max(100)).max(500).optional() }).refine(value => Object.keys(value).length > 0).parse(req.body);
    const updated = await prisma.$transaction(async tx => {
      const role = await assertRoleEditAuthority(tx, req.auth!.userId, req.auth!.companyId!, String(req.params.roleId));
      if (role.code === "SUPER_ADMIN") throw Object.assign(new Error("The reserved Super Admin role cannot be edited through company role management."), { status: 403, code: "ROLE_EDIT_FORBIDDEN" });
      const uniquePermissions = input.permissions ? [...new Set(input.permissions)] : undefined;
      if (uniquePermissions) {
        const known = await tx.permission.findMany({ where: { key: { in: uniquePermissions } }, select: { id: true, key: true } });
        if (known.length !== uniquePermissions.length) throw Object.assign(new Error("One or more permission keys are invalid."), { status: 400, code: "UNKNOWN_PERMISSION" });
        if (role.code === "COMPANY_ADMIN" && !["company.edit", "users.edit", "roles.edit"].every(key => uniquePermissions.includes(key))) throw Object.assign(new Error("The company administrator role must retain company and access management permissions."), { status: 409, code: "ADMIN_LOCKOUT_BLOCKED" });
        await assertRolePermissionsWithinActor(tx, req.auth!.userId, req.auth!.companyId!, role.id, uniquePermissions);
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (known.length) await tx.rolePermission.createMany({ data: known.map(permission => ({ roleId: role.id, permissionId: permission.id })) });
      }
      if (input.name || input.description !== undefined) await tx.companyRole.update({ where: { id: role.id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
      const result = await tx.companyRole.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
      await writeAuditEvent(tx, { ...auditContext(req), action: AUDIT_ACTIONS.ROLE_UPDATED, targetType: "CompanyRole", targetId: result.id, outcome: "SUCCESS", metadata: { roleCode: result.code, changedFields: Object.keys(input), permissions: result.permissions.map(link => link.permission.key) } });
      return result;
    }, { isolationLevel: "Serializable" });
    res.json({ data: { role: { id: updated.id, code: updated.code, name: updated.name, description: updated.description, permissions: updated.permissions.map(link => link.permission.key) } }, meta: { requestId: req.requestId } });
  } catch (error) { next(error); }
});
