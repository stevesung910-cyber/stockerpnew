import type { Prisma } from "../../database/generated";

type Tx = Prisma.TransactionClient;

function forbidden(message = "You are not authorized to assign this company role.") {
  return Object.assign(new Error(message), { status: 403, code: "ROLE_ASSIGNMENT_FORBIDDEN" });
}

export function roleIsAssignable(actorCode: string, actorPermissionKeys: string[], targetCode: string, targetPermissionKeys: string[]) {
  if (targetCode === "SUPER_ADMIN") return false;
  const actorIsCompanyAdmin = actorCode === "COMPANY_ADMIN" || actorCode === "SUPER_ADMIN";
  if (targetCode === "COMPANY_ADMIN" && !actorIsCompanyAdmin) return false;
  const actorKeys = new Set(actorPermissionKeys);
  return targetPermissionKeys.every(key => actorKeys.has(key));
}

export async function assertActiveCompanyPermission(tx: Tx, actorUserId: string, companyId: string, permissionKey: string, allowInactiveCompany = false) {
  const membership = await tx.companyMembership.findFirst({
    where: { userId: actorUserId, companyId, status: "ACTIVE", company: allowInactiveCompany ? {} : { active: true, archivedAt: null } },
    include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
  });
  if (!membership?.role.permissions.some(link => link.permission.key === permissionKey)) throw forbidden("Active company membership and permission are required.");
  return membership;
}

/**
 * The SUPER_ADMIN seed is a legacy company-scoped role, not a platform identity.
 * It is intentionally unassignable through membership APIs. Company Admins may
 * delegate only permissions they currently hold; all other roles are bounded by
 * the caller's permission set.
 */
export async function assertRoleAssignable(tx: Tx, actorUserId: string, companyId: string, targetRoleId: string, action: "create" | "edit") {
  const actor = await tx.companyMembership.findFirst({
    where: { userId: actorUserId, companyId, status: "ACTIVE", company: { active: true, archivedAt: null } },
    include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
  });
  const required = `users.${action}`;
  if (!actor || !actor.role.permissions.some(link => link.permission.key === required)) throw forbidden("Your active company role cannot manage users.");

  const target = await tx.companyRole.findFirst({
    where: { id: targetRoleId, companyId },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  if (!target) throw Object.assign(new Error("Role not found in this company."), { status: 404, code: "ROLE_NOT_FOUND" });
  const actorKeys = new Set(actor.role.permissions.map(link => link.permission.key));
  const targetKeys = target.permissions.map(link => link.permission.key);
  if (!roleIsAssignable(actor.role.code, [...actorKeys], target.code, targetKeys)) throw forbidden(target.code === "SUPER_ADMIN" ? "The reserved Super Admin role cannot be granted through company membership." : undefined);
  return { actor, target };
}

export async function assertRolePermissionsWithinActor(tx: Tx, actorUserId: string, companyId: string, roleId: string, permissionKeys: string[]) {
  const actor = await tx.companyMembership.findFirst({
    where: { userId: actorUserId, companyId, status: "ACTIVE", company: { active: true, archivedAt: null } },
    include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
  });
  const role = await tx.companyRole.findFirst({ where: { id: roleId, companyId } });
  if (!actor || !role) throw forbidden("The active company role or target role is no longer available.");
  if (!actor.role.permissions.some(link => link.permission.key === "roles.edit")) throw forbidden("Your active company role cannot edit roles.");
  if (role.code === "SUPER_ADMIN") throw forbidden("The reserved Super Admin role cannot be edited through company role management.");
  const actorKeys = new Set(actor.role.permissions.map(link => link.permission.key));
  if (permissionKeys.some(key => !actorKeys.has(key))) throw forbidden("A role cannot receive permissions the acting user does not hold.");
  if (role.code === "COMPANY_ADMIN" && actor.role.code !== "COMPANY_ADMIN" && actor.role.code !== "SUPER_ADMIN") {
    throw forbidden("Only a company administrator may edit the Company Admin role.");
  }
}

export async function assertRoleEditAuthority(tx: Tx, actorUserId: string, companyId: string, roleId: string) {
  const actor = await tx.companyMembership.findFirst({
    where: { userId: actorUserId, companyId, status: "ACTIVE", company: { active: true, archivedAt: null } },
    include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
  });
  const role = await tx.companyRole.findFirst({ where: { id: roleId, companyId } });
  if (!actor || !role || !actor.role.permissions.some(link => link.permission.key === "roles.edit")) throw forbidden("Active company membership and role-edit permission are required.");
  return role;
}

export function isKnownRoleCode(value: string) {
  return value.length > 1 && value.length <= 50 && /^[A-Z][A-Z0-9_]*$/.test(value);
}
