import { Bell, ChevronDown, LogIn, LogOut, Menu, Moon, Sun, UserRoundPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "@/app/theme-provider";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { signedOwnProfilePhoto } from "@/lib/backend-repositories";
import { useNotifications } from "@/app/notification-provider";
import NotificationMenu from "@/features/notifications/NotificationMenu";

export default function Navbar({ onMenuClick }) {
  const { configured, user, account, accountProfile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { unreadCount } = useNotifications();
  const { pathname } = useLocation();
  const [photoUrl, setPhotoUrl] = useState("");
  const [openMenu, setOpenMenu] = useState("");
  const menuRef = useRef(null);
  const pageLabels = {
    "/": "Dashboard", "/history": "History", "/notifications": "Notifications", "/admin/dashboard": "Dashboard settings",
    "/organizational": "Organizational", "/seat-plan": "Seat plan", "/projects": "Project coverage",
    "/inbound-call-time": "Inbound call time", "/work-schedule": "Work schedule", "/vl-credits": "VL credits",
    "/app-links": "App / Links", "/agent-profiles": "Agent profiles", "/kpi-qa": "Monthly KPI / QA",
    "/admin/kpi-scoring": "KPI scoring settings", "/admin/qa-parameters": "QA parameters", "/settings": "Settings",
  };
  const currentPage = pageLabels[pathname] ?? "Dashboard";
  const isDark = theme === "dark" || (theme === "system" && document.documentElement.dataset.theme === "dark");
  const displayName = account?.display_name || user?.email || "Account";
  useEffect(() => {
    let active = true;
    let lastSignedAt = 0;
    let inFlight = false;
    setPhotoUrl("");
    const load = async () => {
      if (!configured || !accountProfile?.photo_path) { if (active) setPhotoUrl(""); return; }
      if (inFlight || Date.now() - lastSignedAt < 40 * 60 * 1000) return;
      inFlight = true;
      try { const url = await signedOwnProfilePhoto(accountProfile.photo_path); if (active) { setPhotoUrl(url); lastSignedAt = Date.now(); } }
      catch { /* Keep the current signed URL while offline; retry on reconnect or visibility. */ }
      finally { inFlight = false; }
    };
    void load();
    const renew = window.setInterval(() => { void load(); }, 45 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastSignedAt >= 40 * 60 * 1000) void load(); };
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(renew); window.removeEventListener("online", load); document.removeEventListener("visibilitychange", onVisible); };
  }, [accountProfile?.photo_path, configured]);

  useEffect(() => {
    function closeOnOutside(event) { if (!menuRef.current?.contains(event.target)) setOpenMenu(""); }
    function closeOnEscape(event) { if (event.key === "Escape") setOpenMenu(""); }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  function toggleTheme() { setTheme(isDark ? "light" : "dark"); }

  return <header className="topbar">
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" className="menu-button" aria-label="Open navigation" onClick={onMenuClick}><Menu size={19} /></Button>
      <span className="breadcrumb">Workspace <span className="breadcrumb-separator">/</span> {currentPage}</span>
    </div>
    <div className="topbar-actions" ref={menuRef}>
      <Button variant="ghost" size="icon" aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} onClick={toggleTheme}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</Button>
      {configured && user && <div className="topbar-popover-anchor">
        <Button variant="ghost" size="icon" className="topbar-notification-button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={openMenu === "notifications"} onClick={() => setOpenMenu((current) => current === "notifications" ? "" : "notifications")}>
          <Bell size={18} />{unreadCount > 0 && <span className="topbar-notification-count">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        </Button>
        {openMenu === "notifications" && <NotificationMenu close={() => setOpenMenu("")} />}
      </div>}
      {configured && (user
        ? <div className="topbar-popover-anchor">
            <Button variant="ghost" className="topbar-profile-button" aria-label="Open profile menu" aria-expanded={openMenu === "profile"} onClick={() => setOpenMenu((current) => current === "profile" ? "" : "profile")}>
              <span className="topbar-profile-avatar">{photoUrl ? <img src={photoUrl} alt="" /> : displayName.slice(0, 1).toUpperCase()}</span><ChevronDown size={14} />
            </Button>
            {openMenu === "profile" && <section className="profile-menu" aria-label="Profile menu">
              <div className="profile-menu-identity"><strong>{displayName}</strong><span>{user.email}</span>{accountProfile?.summary && <p>{accountProfile.summary}</p>}</div>
              <Link to="/settings" onClick={() => setOpenMenu("")}><UserRoundPen size={15} /> Edit profile</Link>
              <button type="button" onClick={() => { setOpenMenu(""); void signOut(); }}><LogOut size={15} /> Sign out</button>
            </section>}
          </div>
        : <Link className="topbar-login" to="/login"><LogIn size={15} /> Sign in</Link>)}
    </div>
  </header>;
}
