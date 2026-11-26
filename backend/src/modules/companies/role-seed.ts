import type { Prisma } from "../../database/generated";

export const ROLE_DEFINITIONS = [
  ["SUPER_ADMIN", "Super Admin"], ["COMPANY_ADMIN", "Company Admin"], ["ACCOUNTS_MANAGER", "Accounts Manager"], ["ACCOUNTANT", "Accountant"],
  ["SALES_MANAGER", "Sales Manager"], ["SALES_EXECUTIVE", "Sales Executive"], ["PURCHASE_MANAGER", "Purchase Manager"], ["PURCHASE_EXECUTIVE", "Purchase Executive"],
  ["STORE_MANAGER", "Store Manager"], ["STORE_KEEPER", "Store Keeper"], ["PRODUCTION_MANAGER", "Production Manager"], ["ENGINEER", "Engineer"], ["HR_MANAGER", "HR Manager"], ["VIEWER_AUDITOR", "Viewer / Auditor"],
] as const;

const actions = ["view", "create", "edit", "delete", "approve", "cancel", "export", "print"] as const;
const modules = ["dashboard", "company", "users", "roles", "products", "categories", "units", "warehouses", "customers", "suppliers", "sales", "purchase", "inventory", "manufacturing", "delivery", "accounting", "finance", "reports", "settings"] as const;
const specialPermissions = [
  { key: "financial_years.view", module: "financial_years", action: "view" },
  { key: "financial_years.manage", module: "financial_years", action: "manage" },
  { key: "finance.period_reopen", module: "finance", action: "period_reopen" },
  { key: "items.view", module: "items", action: "view" }, { key: "items.manage", module: "items", action: "manage" },
  { key: "taxes.view", module: "taxes", action: "view" }, { key: "taxes.manage", module: "taxes", action: "manage" },
  { key: "inventory.opening.manage", module: "inventory", action: "opening_manage" },
  { key: "inventory.receive", module: "inventory", action: "receive" }, { key: "inventory.issue", module: "inventory", action: "issue" },
  { key: "inventory.transfer", module: "inventory", action: "transfer" }, { key: "inventory.adjust", module: "inventory", action: "adjust" },
  { key: "inventory.negative_stock_override", module: "inventory", action: "negative_stock_override" },
  { key: "inventory.reconcile", module: "inventory", action: "reconcile" }, { key: "inventory.reports.view", module: "inventory", action: "reports_view" },
];

function permittedModules(code: string) {
  if (code === "SUPER_ADMIN" || code === "COMPANY_ADMIN") return modules;
  if (code.startsWith("ACCOUNT") || code === "ACCOUNTANT") return ["dashboard", "accounting", "finance", "reports", "customers", "suppliers"] as const;
  if (code.startsWith("SALES")) return ["dashboard", "sales", "customers", "products", "delivery", "reports"] as const;
  if (code.startsWith("PURCHASE")) return ["dashboard", "purchase", "suppliers", "products", "warehouses", "reports"] as const;
  if (code.startsWith("STORE")) return ["dashboard", "inventory", "products", "warehouses", "delivery", "reports"] as const;
  if (code === "PRODUCTION_MANAGER" || code === "ENGINEER") return ["dashboard", "manufacturing", "inventory", "products", "reports"] as const;
  if (code === "HR_MANAGER") return ["dashboard", "users", "settings"] as const;
  return ["dashboard", "reports"] as const;
}

function permittedActions(code: string, module: string): readonly string[] {
  if (code === "SUPER_ADMIN" || code === "COMPANY_ADMIN") return actions;
  if (module === "dashboard" || module === "reports") return ["view", "export", "print"];
  if (code.endsWith("MANAGER")) return ["view", "create", "edit", "approve", "cancel", "export", "print"];
  if (code === "ACCOUNTANT" && ["accounting", "finance"].includes(module)) return ["view", "create", "edit", "export", "print"];
  if (code === "SALES_EXECUTIVE" && ["sales", "delivery"].includes(module)) return ["view", "create", "edit", "export", "print"];
  if (code === "PURCHASE_EXECUTIVE" && module === "purchase") return ["view", "create", "edit", "export", "print"];
  if (code === "STORE_KEEPER" && module === "inventory") return ["view", "create", "edit", "export", "print"];
  if (code === "ENGINEER" && module === "manufacturing") return ["view", "create", "edit", "export", "print"];
  return ["view", "export", "print"];
}

export async function seedCompanyRoles(tx: Prisma.TransactionClient, companyId: string) {
  const permissions = modules.flatMap(module => actions.map(action => ({ key: `${module}.${action}`, module, action })));
  const special = specialPermissions;
  await tx.permission.createMany({ data: [...permissions, ...special], skipDuplicates: true });
  const permissionRows = await tx.permission.findMany({ where: { key: { in: [...permissions, ...special].map(item => item.key) } }, select: { id: true, key: true } });
  const permissionIdByKey = new Map(permissionRows.map(item => [item.key, item.id]));
  const roles: Array<{ id: string; code: string }> = [];
  for (const [code, name] of ROLE_DEFINITIONS) {
    const role = await tx.companyRole.create({ data: { companyId, code, name, isSystem: true }, select: { id: true, code: true } });
    roles.push(role);
    const allowed = new Set<string>(permittedModules(code));
    const grants: Array<{ key: string; module: string; action: string }> = permissions.filter(item => allowed.has(item.module) && permittedActions(code, item.module).includes(item.action));
    if (code === "COMPANY_ADMIN") grants.push(...special.filter(item => !["finance.period_reopen", "inventory.negative_stock_override", "inventory.reconcile"].includes(item.key)));
    if (code === "STORE_MANAGER") grants.push(...special.filter(item => ["items.view", "financial_years.view", "inventory.receive", "inventory.issue", "inventory.transfer", "inventory.adjust", "inventory.reports.view"].includes(item.key)));
    if (code === "STORE_KEEPER") grants.push(...special.filter(item => ["items.view", "financial_years.view", "inventory.receive", "inventory.issue", "inventory.transfer", "inventory.reports.view"].includes(item.key)));
    if (grants.length) await tx.rolePermission.createMany({ data: grants.map(item => ({ roleId: role.id, permissionId: permissionIdByKey.get(item.key)! })) });
  }
  return { roles, companyAdminRoleId: roles.find(role => role.code === "COMPANY_ADMIN")!.id };
}
