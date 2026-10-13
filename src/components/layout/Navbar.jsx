import { Bell, ChevronDown, Clock3, LogIn, LogOut, Menu, Moon, Sun, UserRoundPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "@/app/theme-provider";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { signedOwnProfilePhoto } from "@/lib/backend-repositories";
import { useNotifications } from "@/app/notification-provider";
import NotificationMenu from "@/features/notifications/NotificationMenu";

export default function Navbar({ onMenuClick }) {
  const { configured, user, account, accountProfile, sessionRemainingSeconds, sessionWarning, sessionStatus, extendSession, signOut } = useAuth();
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
  const countdown = sessionRemainingSeconds == null ? "Checking…" : `${Math.floor(sessionRemainingSeconds / 60)}:${String(sessionRemainingSeconds % 60).padStart(2, "0")}`;
  const absoluteDeadlineFirst = sessionStatus?.absoluteDeadline && sessionStatus?.inactivityDeadline
    && new Date(sessionStatus.absoluteDeadline).getTime() <= new Date(sessionStatus.inactivityDeadline).getTime();

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!configured || !accountProfile?.photo_path) { if (active) setPhotoUrl(""); return; }
      try { const url = await signedOwnProfilePhoto(accountProfile.photo_path); if (active) setPhotoUrl(url); }
      catch { if (active) setPhotoUrl(""); }
    };
    void load();
    const renew = window.setInterval(() => { void load(); }, 4 * 60 * 1000);
    return () => { active = false; window.clearInterval(renew); };
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
              <div className="profile-menu-session"><Clock3 size={14} /><span>Session ends in</span><strong>{countdown}</strong></div>
              <Link to="/settings" onClick={() => setOpenMenu("")}><UserRoundPen size={15} /> Edit profile</Link>
              <button type="button" onClick={() => { setOpenMenu(""); void signOut(); }}><LogOut size={15} /> Sign out</button>
            </section>}
          </div>
        : <Link className="topbar-login" to="/login"><LogIn size={15} /> Sign in</Link>)}
    </div>
    {configured && user && sessionWarning && <div className="session-warning-backdrop">
      <section className="session-warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="session-warning-title" aria-describedby="session-warning-description">
        <span className="session-warning-icon"><Clock3 size={19} /></span>
        <p className="eyebrow">SESSION SECURITY</p>
        <h2 id="session-warning-title">Your session is ending soon</h2>
        <p id="session-warning-description">You will be signed out in <strong>{countdown}</strong>. Save any work you have open.</p>
        <div className="session-warning-actions">
          {!absoluteDeadlineFirst && <Button onClick={() => void extendSession()}>Stay signed in</Button>}
          <Button variant="outline" onClick={() => void signOut()}><LogOut size={15} /> Sign out</Button>
        </div>
      </section>
    </div>}
  </header>;
}
