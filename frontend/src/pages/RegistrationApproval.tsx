import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { send } from "../services/api";

export function RegistrationApproval({ email, continuation, onApproved }: {
  email: string;
  continuation: string;
  onApproved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(() => Date.now() + 60_000);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (remaining === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [now, remaining]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const otp = String(new FormData(form).get("otp") ?? "");
    form.reset();
    setBusy(true);
    setError("");
    try {
      await send("/auth/register/confirm", { continuation, otp });
      onApproved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Approval could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send("/auth/register/resend", { continuation });
      const timestamp = Date.now();
      setNow(timestamp);
      setResendAt(timestamp + 60_000);
      setNotice("If the request is eligible, a replacement code will be sent to the software owner.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "A new code could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <form className="auth-form" onSubmit={confirm}>
      <label>Approval code
        <div className="input-wrap">
          <input name="otp" type="password" required inputMode="numeric" autoComplete="off"
            pattern="[0-9]{8}" maxLength={8} aria-describedby="approval-email" />
        </div>
      </label>
      <p id="approval-email">Registration email <strong>{email}</strong></p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <p role="status">{notice}</p>}
      <button className="primary-button auth-submit" disabled={busy}>Confirm approval</button>
      <button className="secondary-button" type="button" onClick={resend} disabled={busy || remaining > 0}>
        {remaining ? `Resend in ${remaining}s` : "Request another code"}
      </button>
    </form>
    <div className="auth-foot"><Link to="/login">Return to sign in</Link></div>
  </>;
}

export function RegistrationApproved() {
  return <div className="auth-success" role="status">
    <CheckCircle2 size={20}/>
    <span>Your account has been approved.</span>
    <Link to="/login">Sign in to continue</Link>
  </div>;
}
