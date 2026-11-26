import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../layouts/AppShell";
import { Dashboard } from "../pages/Dashboard";
import { ModulePage } from "../pages/ModulePage";
import { AuthPage } from "../pages/AuthPage";
import { CompanyFormPage, CompanySelectPage, InvitationAcceptPage, RoleManagementPage, UserManagementPage } from "../pages/CompanyPages";
import { GmailSettings } from "../pages/GmailSettings";
import { InventoryPages } from "../pages/InventoryPages";
import { AuthGuard, CompanyGuard } from "../features/auth/AuthGuard";

export default function App() {
  const queryClient = useQueryClient(); const navigate = useNavigate(); const location = useLocation();
  useEffect(() => {
    const expire = () => { const from = `${location.pathname}${location.search}`; queryClient.clear(); navigate("/login", { replace: true, state: { from } }); };
    const receive = (type: string) => {
      queryClient.clear();
      if (type === "logout") navigate("/login", { replace: true });
      else navigate("/companies/select", { replace: true });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "stockerp-auth-signal" || !event.newValue) return;
      try { receive((JSON.parse(event.newValue) as { type: string }).type); } catch { /* Ignore malformed cross-tab state. */ }
    };
    window.addEventListener("stockerp:session-expired", expire);
    window.addEventListener("storage", onStorage);
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("stockerp-auth") : undefined;
    if (channel) channel.onmessage = event => receive(String(event.data?.type ?? ""));
    return () => { window.removeEventListener("stockerp:session-expired", expire); window.removeEventListener("storage", onStorage); channel?.close(); };
  }, [location.pathname, location.search, navigate, queryClient]);
  return <Routes>
    <Route path="/login" element={<AuthPage mode="login"/>}/><Route path="/register" element={<AuthPage mode="register"/>}/><Route path="/forgot-password" element={<AuthPage mode="forgot"/>}/><Route path="/reset-password" element={<AuthPage mode="reset"/>}/><Route path="/verify-email" element={<AuthPage mode="verify"/>}/>
    <Route element={<AuthGuard/>}>
      <Route path="accept-invitation" element={<InvitationAcceptPage/>}/>
      <Route element={<AppShell/>}>
        <Route path="settings/integrations/google-gmail" element={<GmailSettings/>}/>
        <Route element={<CompanyGuard/>}>
        <Route path="companies/select" element={<CompanySelectPage/>}/><Route path="companies/new" element={<CompanyFormPage/>}/>
        <Route element={<CompanyGuard/>}>
          <Route index element={<Dashboard/>}/><Route path="settings/company" element={<CompanyFormPage edit/>}/><Route path="settings/users" element={<UserManagementPage/>}/><Route path="settings/roles" element={<RoleManagementPage/>}/>
          <Route path="master-data/:page" element={<InventoryPages/>}/><Route path="inventory/:page" element={<InventoryPages/>}/><Route path="financial-years" element={<InventoryPages/>}/><Route path="reports" element={<InventoryPages/>}/>
          <Route path=":section/:page" element={<ModulePage/>}/>
        </Route>
      </Route></Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>;
}
