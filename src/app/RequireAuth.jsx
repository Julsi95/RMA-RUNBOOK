import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/app/auth-provider";
import { Button } from "@/components/ui/Button";
import { RUNBOOK_TERMS_VERSION, TermsDialog } from "@/components/TermsDialog";
import { supabase } from "@/lib/supabase";

const verifiedTermsUsers = new Set();
const termsPendingUsers = new Set();
const termsVerificationErrors = new Map();
const termsVerificationRequests = new Map();

function termsCacheKey(userId) {
  return userId ? `runbook-terms:${userId}` : "";
}

function hasVerifiedTerms(userId) {
  const key = termsCacheKey(userId);
  if (!key) return false;
  if (verifiedTermsUsers.has(key)) return true;
  try {
    if (localStorage.getItem(key) === RUNBOOK_TERMS_VERSION) {
      verifiedTermsUsers.add(key);
      return true;
    }
  } catch {
    // The in-memory cache still prevents repeat checks during this app session.
  }
  return false;
}

function rememberVerifiedTerms(userId) {
  const key = termsCacheKey(userId);
  if (!key) return;
  verifiedTermsUsers.add(key);
  termsPendingUsers.delete(key);
  termsVerificationErrors.delete(key);
  try { localStorage.setItem(key, RUNBOOK_TERMS_VERSION); } catch {
    // Keep the successful result in memory if persistent browser storage is unavailable.
  }
}

function TermsAcceptanceGate({ children }) {
  const { user } = useAuth();
  const [accepted, setAccepted] = useState(() => hasVerifiedTerms(user?.id) ? true : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => termsVerificationErrors.get(termsCacheKey(user?.id)) || "");

  async function load(userId = user?.id, force = false, isActive = () => true) {
    const key = termsCacheKey(userId);
    if (hasVerifiedTerms(userId)) { if (isActive()) setAccepted(true); return; }
    if (termsPendingUsers.has(key)) { if (isActive()) setAccepted(false); return; }
    if (!force && termsVerificationErrors.has(key)) {
      if (isActive()) { setAccepted(null); setError(termsVerificationErrors.get(key)); }
      return;
    }
    setError("");
    setAccepted(null);
    let request = termsVerificationRequests.get(key);
    let result;
    try {
      if (!request) {
        request = supabase.rpc("runbook_terms_accepted", { p_version: RUNBOOK_TERMS_VERSION });
        termsVerificationRequests.set(key, request);
      }
      result = await request;
    } catch (cause) {
      const message = `Terms acceptance could not be verified (${cause.message || "database request failed"}). Check the Supabase connection and session, then retry.`;
      termsVerificationErrors.set(key, message);
      if (isActive()) setError(message);
      return;
    } finally {
      if (termsVerificationRequests.get(key) === request) termsVerificationRequests.delete(key);
    }
    const { data, error: queryError } = result;
    if (queryError) {
      const missingFunction = queryError.code === "PGRST202" || queryError.code === "42883" || /runbook_terms_accepted/i.test(queryError.message || "");
      const message = missingFunction
        ? `The terms database migration is missing from the Supabase project this app is using. Apply supabase/migrations/202611010003_terms_and_wfh_request_limits.sql, then retry. No terms acceptance was saved.`
        : `Terms acceptance could not be verified (${queryError.message || queryError.code || "database request failed"}). Check the Supabase connection and session, then retry.`;
      termsVerificationErrors.set(key, message);
      if (isActive()) setError(message);
      return;
    }
    termsVerificationErrors.delete(key);
    if (data) rememberVerifiedTerms(userId);
    else termsPendingUsers.add(key);
    if (isActive()) setAccepted(Boolean(data));
  }
  useEffect(() => {
    let active = true;
    if (hasVerifiedTerms(user?.id)) { setAccepted(true); setError(""); }
    else if (termsPendingUsers.has(termsCacheKey(user?.id))) { setAccepted(false); setError(""); }
    else if (termsVerificationErrors.has(termsCacheKey(user?.id))) {
      setAccepted(null);
      setError(termsVerificationErrors.get(termsCacheKey(user?.id)));
    } else {
      setAccepted(null);
      void load(user?.id, false, () => active);
    }
    return () => { active = false; };
  }, [user?.id]);
  async function accept() {
    setBusy(true); setError("");
    try {
      const { error: saveError } = await supabase.rpc("accept_runbook_terms", { p_version: RUNBOOK_TERMS_VERSION });
      if (saveError) setError(saveError.message || "Could not save your acceptance.");
      else { rememberVerifiedTerms(user?.id); setAccepted(true); }
    } catch (cause) { setError(cause.message || "Could not save your acceptance."); }
    setBusy(false);
  }
  if (accepted === null) return <main className="session-loading-screen"><section className="session-loading-card terms-check-card"><p className="eyebrow">ACCOUNT TERMS</p><h1>{error ? "Terms check needs attention" : "Verifying account terms…"}</h1>{error ? <><p className="terms-check-error" role="alert">{error}</p><Button onClick={() => void load(user?.id, true)}>Retry verification</Button></> : <><p className="page-description">Checking whether you have accepted the current RUNBOOK terms.</p><div className="session-loading-track" aria-hidden="true"><i /></div></>}</section></main>;
  return <>{children}{!accepted && <TermsDialog required onAccept={() => void accept()} busy={busy} error={error} />}</>;
}

export default function RequireAuth({ children }) {
  const { configured, loading, user, sessionStatus, sessionCheckError, refreshSessionStatus } = useAuth();
  const location = useLocation();

  if (!configured) return <Navigate to="/login" replace state={{ configurationRequired: true }} />;
  if (loading) return <main className="session-loading-screen" role="status" aria-live="polite" aria-label="Checking your session">
    <section className="session-loading-card">
      <div className="session-loading-art"><img src="/toothless-dance.gif" alt="" /></div>
      <p className="session-loading-brand">RMA RUNBOOK</p>
      <h1>Getting your workspace ready</h1>
      <p className="session-loading-copy"><LoaderCircle size={14} /> Checking your session…</p>
      <div className="session-loading-track" aria-hidden="true"><i /></div>
    </section>
  </main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (sessionCheckError && !sessionStatus?.active) return <main className="session-loading-screen"><section className="session-loading-card"><p className="eyebrow">SESSION CHECK</p><h1>Reconnect to your workspace</h1><p className="page-description">We couldn’t verify this session. Your session has not been signed out.</p><Button onClick={() => void refreshSessionStatus()}>Retry session check</Button></section></main>;
  if (!sessionStatus?.active) return <main className="session-loading-screen" role="status" aria-live="polite"><section className="session-loading-card"><p className="eyebrow">SESSION CHECK</p><h1>Verifying your session</h1><p className="page-description">Please wait while RUNBOOK checks this device.</p><div className="session-loading-track" aria-hidden="true"><i /></div></section></main>;
  return <TermsAcceptanceGate>{children}</TermsAcceptanceGate>;
}
