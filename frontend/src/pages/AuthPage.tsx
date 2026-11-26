import { FormEvent, useState } from "react";
import { Boxes, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RegistrationApproval, RegistrationApproved } from "./RegistrationApproval";
import { send } from "../services/api";

type Mode = "login" | "register" | "forgot" | "reset" | "verify";
export function AuthPage({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState(""); const [displayName, setDisplayName] = useState(""); const [password, setPassword] = useState(""); const [token, setToken] = useState(""); const [visible, setVisible] = useState(false); const [resetMessage, setResetMessage] = useState("");
  const [approval, setApproval] = useState<{ email: string; continuation: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [params] = useSearchParams(); const navigate = useNavigate(); const location = useLocation(); const queryClient = useQueryClient();
  const isReset = mode === "reset"; const isVerify = mode === "verify"; const legacyVerify = isVerify && params.get("legacy") === "1" && !params.get("token"); const hasPassword = mode === "login" || mode === "register" || isReset || legacyVerify || (isVerify && !!params.get("token"));
  const mutation = useMutation({ mutationFn: async () => {
    if (mode === "login") return send("/auth/login", { email, password });
    if (mode === "register") {
      const { continuation } = await send<{ continuation: string }>("/auth/register", { email, displayName, password });
      setPassword("");
      setApproval({ email: email.trim().toLowerCase(), continuation });
      return;
    }
    if (mode === "forgot") return send<{ message: string; developmentResetToken?: string }>("/auth/forgot-password", { email });
    if (legacyVerify) return send<{ message: string }>("/auth/verify-email/legacy-request", { email, password });
    if (isVerify) return params.get("token") ? send<{ message: string }>("/auth/verify-email/confirm", { token: token || params.get("token"), password }) : send<{ message: string; developmentVerificationToken?: string }>("/auth/verify-email/request", {});
    return send<{ message: string }>("/auth/reset-password", { token: token || params.get("token"), password });
  }, onSuccess: async result => {
    if (mode === "login") { queryClient.clear(); const from = (location.state as { from?: unknown } | null)?.from; const destination = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/companies/select"; navigate(destination, { replace: true }); }
    else if (mode === "register") return;
    else if (mode === "forgot") { const data = result as { message: string; developmentResetToken?: string }; setResetMessage(data.developmentResetToken ? `Development reset token: ${data.developmentResetToken}` : data.message); }
    else if (isVerify) { setPassword(""); const data = result as { message: string; developmentVerificationToken?: string }; setResetMessage(data.developmentVerificationToken ? `Development verification token: ${data.developmentVerificationToken}` : data.message); if (data.developmentVerificationToken) setToken(data.developmentVerificationToken); if (params.get("token")) { await queryClient.invalidateQueries({ queryKey: ["session"] }); const returnTo = params.get("returnTo"); navigate(returnTo?.startsWith("/")&&!returnTo.startsWith("//") ? returnTo : "/companies/select", { replace: true }); } }
    else setResetMessage((result as { message: string }).message);
  } });
  const developmentResetToken = (mutation.data as { developmentResetToken?: string } | undefined)?.developmentResetToken;
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  const title = mode === "login" ? "Welcome back" : mode === "register" ? approved ? "Account approved" : approval ? "Registration approval" : "Create your account" : mode === "forgot" ? "Reset your password" : isVerify ? "Verify your email" : "Choose a new password";
  return <main className="auth-page"><section className="auth-card"><Link to="/login" className="auth-brand"><span className="brand-mark"><Boxes size={20}/></span><b>Stock<span>ERP</span></b></Link><div className="auth-intro"><div className="auth-eyebrow">SECURE BUSINESS WORKSPACE</div><h1>{title}</h1><p>{mode === "login" ? "Sign in to manage your business." : mode === "register" ? approved ? "Sign in to create or select a company." : approval ? "Your request is awaiting approval. Enter the eight-digit code the software owner provides. Keep this page open while you wait." : "StockERP sends an approval code to the software owner, who will share it with you after reviewing your request." : mode === "forgot" ? "Enter your account email. The response will not reveal whether an account exists." : isVerify ? legacyVerify ? "Use your existing email and password to request a fresh verification link." : "Verify your mailbox to accept email invitations or use password recovery." : "Reset links expire after 30 minutes and can only be used once."}</p></div>
    {mode === "register" && approved ? <RegistrationApproved/> : mode === "register" && approval
      ? <RegistrationApproval {...approval} onApproved={() => { setApproval(null); setApproved(true); }}/>
      : resetMessage ? <div className="auth-success"><CheckCircle2 size={20}/><span>{resetMessage}</span>{mode === "forgot" && developmentResetToken && <Link to={`/reset-password?token=${encodeURIComponent(developmentResetToken)}`}>Continue to reset password</Link>}{mode === "reset" && <Link to="/login">Return to sign in</Link>}{isVerify && token && <Link to={`/verify-email?token=${encodeURIComponent(token)}`}>Continue to verify email</Link>}{isVerify && <Link to="/login">Continue to sign in</Link>}</div> : <form className="auth-form" onSubmit={submit}>
      {mode === "register" && <label>Full name<div className="input-wrap"><UserRound size={17}/><input required minLength={2} maxLength={100} autoComplete="name" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name"/></div></label>}
      {mode !== "reset" && (mode !== "verify" || legacyVerify) && <label>Email address<div className="input-wrap"><Mail size={17}/><input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></div></label>}
      {isReset && <label>Reset token<div className="input-wrap"><KeyRound size={17}/><input required minLength={20} value={token || params.get("token") || ""} onChange={e=>setToken(e.target.value)} placeholder="Paste the reset token"/></div></label>}
      {isVerify && params.get("token") && <label>Verification token<div className="input-wrap"><KeyRound size={17}/><input required minLength={20} value={token || params.get("token") || ""} onChange={e=>setToken(e.target.value)} placeholder="Paste the verification token"/></div></label>}
      {hasPassword && <label>{isReset ? "New password" : "Password"}<div className="input-wrap"><LockKeyhole size={17}/><input required type={visible ? "text" : "password"} minLength={mode === "login" || isVerify ? 1 : 12} maxLength={128} autoComplete={mode === "login" || isVerify ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode === "login" || isVerify ? "Enter your password" : "At least 12 characters"}/><button type="button" className="reveal-button" aria-label={visible ? "Hide password" : "Show password"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>{mode !== "login" && !isVerify && <small>Use at least 12 characters.</small>}</label>}
      {mutation.isError && <div className="form-error" role="alert">{mutation.error.message}</div>}
      <button className="primary-button auth-submit" disabled={mutation.isPending}>{mutation.isPending ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset instructions" : isVerify ? (params.get("token") ? "Verify email" : "Request verification instructions") : "Update password"}</button>
    </form>}
    <div className="auth-foot">{mode === "login" && <><Link to="/forgot-password">Forgot password?</Link><Link to="/verify-email?legacy=1">Verify an existing account</Link><span>New to StockERP? <Link to="/register">Create an account</Link></span></>}{mode === "register" && <span>Already have an account? <Link to="/login">Sign in</Link></span>}{mode === "forgot" && <span>Remember your password? <Link to="/login">Sign in</Link></span>}{mode === "reset" && <span><Link to="/forgot-password">Request another reset token</Link></span>}{isVerify && <span><Link to="/login">Sign in</Link></span>}</div>
  </section><div className="auth-aside"><div className="auth-aside-inner"><div className="aside-art"><Boxes size={36}/></div><h2>One workspace for your business.</h2><p>Keep your company operations organized with clear access controls and a secure account.</p><div className="security-note"><LockKeyhole size={16}/><span>Your session is protected with an HTTP-only cookie.</span></div></div></div></main>;
}
