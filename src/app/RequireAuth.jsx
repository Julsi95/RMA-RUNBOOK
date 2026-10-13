import { Navigate, useLocation } from "react-router";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/app/auth-provider";

export default function RequireAuth({ children }) {
  const { configured, loading, user } = useAuth();
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
  return children;
}
