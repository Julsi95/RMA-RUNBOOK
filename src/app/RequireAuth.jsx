import { Navigate, useLocation } from "react-router";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/app/auth-provider";
import { Button } from "@/components/ui/Button";

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
  return children;
}
