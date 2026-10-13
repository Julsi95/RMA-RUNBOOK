import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ArrowLeft, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";

function AuthFrame({ eyebrow, title, description, children }) {
  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" to="/">VF <span>RUNBOOK</span></Link><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p>{children}</section></main>;
}

export function LoginPage() {
  const { configured, loading, user, signIn, sessionNotice } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const from = location.state?.from || "/";

  if (!configured) return <AuthFrame eyebrow="EDITOR SIGN IN" title="Connect your workspace" description="This project has not been connected to Supabase yet."><p className="auth-notice">Add the Supabase project URL and public key to your local environment, then restart the app.</p><Link className="auth-back-link" to="/"><ArrowLeft size={15} /> Back to dashboard</Link></AuthFrame>;
  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try { await signIn(email.trim(), password); navigate(from, { replace: true }); }
    catch (cause) { setError(cause.message || "Could not sign in."); }
    finally { setBusy(false); }
  }

  return <AuthFrame eyebrow="EDITOR SIGN IN" title="Welcome back" description="Sign in with your editor account to manage RUNBOOK.">
    <form className="auth-form" onSubmit={submit}>
      {sessionNotice && <p className="auth-notice" role="status">{sessionNotice}</p>}
      <label>Email address<span className="auth-input"><Mail size={16} /><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>
      <label>Password<span className="auth-input"><LockKeyhole size={16} /><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || loading}>{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
    <Link className="auth-secondary-link" to="/forgot-password">Forgot password?</Link>
    <Link className="auth-back-link" to="/"><ArrowLeft size={15} /> Back to public workspace</Link>
  </AuthFrame>;
}

export function ForgotPasswordPage() {
  const { configured, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try { await requestPasswordReset(email.trim()); setSent(true); }
    catch (cause) { setError(cause.message || "Could not request a reset link."); }
    finally { setBusy(false); }
  }
  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Reset your password" description="We’ll email a secure reset link if an account matches that address.">
    {!configured ? <p className="auth-notice">Password recovery becomes available after Supabase is configured.</p> : sent ? <p className="auth-success" role="status">If the address is registered, a password reset link is on its way.</p> : <form className="auth-form" onSubmit={submit}><label>Email address<span className="auth-input"><Mail size={16} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>{error && <p className="auth-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button></form>}
    <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
  </AuthFrame>;
}

export function ResetPasswordPage() {
  const { configured, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try { await updatePassword(password); navigate("/settings", { replace: true }); }
    catch (cause) { setError(cause.message || "The reset link may have expired. Request a new one."); }
    finally { setBusy(false); }
  }
  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Choose a new password" description="Set a new password for your editor account.">
    {!configured ? <p className="auth-notice">Password recovery becomes available after Supabase is configured.</p> : <form className="auth-form" onSubmit={submit}><label>New password<span className="auth-input"><KeyRound size={16} /><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label><label>Confirm password<span className="auth-input"><KeyRound size={16} /><input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></span></label>{error && <p className="auth-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</Button></form>}
    <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
  </AuthFrame>;
}
