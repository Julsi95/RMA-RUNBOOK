import { Navigate } from "react-router";
import { useAuth } from "@/app/auth-provider";

export default function RequireEditor({ children }) {
  const { configured, loading, user, isAdmin } = useAuth();
  if (!configured) return children;
  if (loading) return <div className="page-content"><p>Checking editor access…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}
