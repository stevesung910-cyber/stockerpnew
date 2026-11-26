import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../../services/api";

export type SessionData = { user: { id: string; email: string; displayName: string; emailVerifiedAt: string | null; ownerApprovedAt: string | null; eligibility: "OWNER_APPROVED" | "LEGACY_VERIFIED" }; canManageGmail: boolean; activeCompanyId: string | null; companies: Array<{ id: string; name: string; role: string; roleCode: string; permissions: string[]; active: boolean }> };
export function useSession() { return useQuery({ queryKey: ["session"], queryFn: () => api<SessionData>("/auth/me"), retry: false, staleTime: 20_000 }); }
export function AuthGuard() {
  const session = useSession(); const location = useLocation();
  if (session.isPending) return <div className="full-screen-state">Checking your session…</div>;
  if (session.isError) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <Outlet />;
}
export function CompanyGuard() {
  const session = useSession(); const location = useLocation();
  if (!session.data) return null;
  const openWithoutCompany = ["/companies/select", "/companies/new"].includes(location.pathname);
  if (!session.data.companies.length && location.pathname !== "/companies/new") return <Navigate to="/companies/new" replace />;
  if (!session.data.activeCompanyId && !openWithoutCompany) return <Navigate to="/companies/select" replace />;
  return <Outlet />;
}
