import { LoaderCircle, LogIn, LogOut, Menu, Moon, Sun, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "@/app/theme-provider";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { subscribeToSyncState } from "@/lib/backend/shared";

export default function Navbar({ onMenuClick }) {
  const { configured, user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const [syncState, setSyncState] = useState(() => ({ online: navigator.onLine, refreshing: false, channelCount: 0, connectedChannels: 0, reconnecting: false }));
  const pageLabels = {
    "/": "Dashboard",
    "/history": "History",
    "/admin/dashboard": "Dashboard settings",
    "/organizational": "Organizational",
    "/seat-plan": "Seat plan",
    "/projects": "Project coverage",
    "/inbound-call-time": "Inbound call time",
    "/work-schedule": "Work schedule",
    "/vl-credits": "VL credits",
    "/app-links": "App / Links",
    "/agent-profiles": "Agent profiles",
    "/kpi-qa": "Monthly KPI / QA",
    "/admin/kpi-scoring": "KPI scoring settings",
    "/admin/qa-parameters": "QA parameters",
    "/settings": "Settings",
  };
  const currentPage = pageLabels[pathname] ?? "Dashboard";
  const isDark = theme === "dark" || (theme === "system" && document.documentElement.dataset.theme === "dark");

  useEffect(() => {
    const unsubscribe = subscribeToSyncState(setSyncState);
    const onConnectionChange = () => setSyncState((current) => ({ ...current, online: navigator.onLine }));
    window.addEventListener("online", onConnectionChange);
    window.addEventListener("offline", onConnectionChange);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onConnectionChange);
      window.removeEventListener("offline", onConnectionChange);
    };
  }, []);

  const connectionLabel = !syncState.online
    ? "Offline · waiting to reconnect"
    : syncState.reconnecting || (syncState.channelCount > 0 && syncState.connectedChannels < syncState.channelCount)
      ? "Reconnecting to live data…"
      : syncState.refreshing ? "Updating shared data…" : "";

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <header className="topbar">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="menu-button" aria-label="Open navigation" onClick={onMenuClick}>
          <Menu size={19} />
        </Button>
        <span className="breadcrumb">Workspace <span className="breadcrumb-separator">/</span> {currentPage}</span>
      </div>
      <div className="flex items-center gap-2">
        {connectionLabel && <span className={`topbar-sync-state${!syncState.online ? " is-offline" : ""}`} role="status" aria-live="polite">{!syncState.online ? <WifiOff size={14} /> : <LoaderCircle className="topbar-sync-spinner" size={14} />}<span>{connectionLabel}</span></span>}
        <Button variant="ghost" size="icon" aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} onClick={toggleTheme}>
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
        {configured && (user
          ? <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={17} /></Button>
          : <Link className="topbar-login" to="/login"><LogIn size={15} /> Sign in</Link>)}
        <div className="avatar" aria-label={user?.email || "Public visitor"}>{user?.email?.[0]?.toUpperCase() || "U"}</div>
      </div>
    </header>
  );
}
