import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/app/auth-provider";

export default function RequireAuth({ children }) {
  const { configured, loading, user } = useAuth();
  const location = useLocation();

  if (!configured) return <Navigate to="/login" replace state={{ configurationRequired: true }} />;
  if (loading) return <div className="page-content"><p role="status">Checking your session…</p></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
