import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ArrowLeft, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useAuth } from "@/app/auth-provider";
import { supabase } from "@/lib/supabase";

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
      <label>Password<span className="auth-input"><LockKeyhole size={16} /><PasswordInput autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>
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
    {!configured ? <p className="auth-notice">Password recovery becomes available after Supabase is configured.</p> : <form className="auth-form" onSubmit={submit}><label>New password<span className="auth-input"><KeyRound size={16} /><PasswordInput autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label><label>Confirm password<span className="auth-input"><KeyRound size={16} /><PasswordInput autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></span></label>{error && <p className="auth-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</Button></form>}
    <Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
  </AuthFrame>;
}

export function InvitationPasswordSetupPage() {
  const { configured, loading, user, sessionStatus, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [invitationToken] = useState(() => new URLSearchParams(window.location.search).get("token_hash") || "");
  const [invitationType] = useState(() => new URLSearchParams(window.location.search).get("type") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [invitationVerified, setInvitationVerified] = useState(false);

  async function verifyInvitation() {
    if (!configured || !supabase || invitationType !== "invite" || !invitationToken) return;
    setBusy(true); setError("");
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: invitationToken, type: "invite" });
      if (verifyError) throw verifyError;
      setInvitationVerified(true);
      window.history.replaceState({}, "", window.location.pathname);
    } catch (cause) {
      setError(cause.message || "This invitation link is invalid or expired. Ask an administrator to send a new invitation.");
    } finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword(""); setConfirm(""); setComplete(true);
    } catch (cause) { setError(cause.message || "The invitation link may have expired. Ask an administrator to send a new invitation."); }
    finally { setBusy(false); }
  }

  const verifiedInvitationSession = Boolean(user && sessionStatus?.active && (!invitationToken || invitationVerified));
  return <AuthFrame eyebrow="COMPLETE YOUR INVITATION" title="Set your password" description="Choose a password for your RUNBOOK account.">
    {!configured ? <p className="auth-notice">Password setup is unavailable until Supabase is configured.</p>
      : loading || (user && !sessionStatus) ? <p className="auth-notice" role="status">Verifying your invitation…</p>
      : complete ? <><p className="auth-success" role="status">Your password is set. You can now use your RUNBOOK account.</p><Button type="button" onClick={() => navigate("/", { replace: true })}>Continue to RUNBOOK</Button></>
      : invitationToken && invitationType === "invite" && !invitationVerified ? <><p className="auth-notice">Confirm this invitation to open the password setup form. The link is only used after you press the button.</p>{error && <p className="auth-error" role="alert">{error}</p>}<Button type="button" disabled={busy} onClick={() => void verifyInvitation()}>{busy ? "Verifying invitation…" : "Continue to password setup"}</Button></>
      : invitationVerified && (!user || !sessionStatus?.active) ? <p className="auth-notice" role="status">Invitation confirmed. Preparing your password form…</p>
      : !verifiedInvitationSession ? <><p className="auth-error" role="alert">This invitation link is invalid, expired, or already used. Ask an administrator to send a new invitation.</p><Link className="auth-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link></>
      : <form className="auth-form" onSubmit={submit}>
        <p className="auth-notice">Setting a password for <strong>{user.email}</strong></p>
        <label>New password<span className="auth-input"><KeyRound size={16} /><PasswordInput autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>
        <label>Confirm password<span className="auth-input"><KeyRound size={16} /><PasswordInput autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></span></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Set password"}</Button>
      </form>}
  </AuthFrame>;
}
