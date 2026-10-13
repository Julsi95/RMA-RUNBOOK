import { Armchair, BarChart3, BriefcaseBusiness, CalendarClock, ChevronsLeft, ChevronsRight, ClipboardCheck, Coins, ContactRound, LayoutDashboard, Link2, Network, PanelsTopLeft, PhoneIncoming, Settings, SlidersHorizontal, X } from "lucide-react";
import { NavLink } from "react-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { useBranding } from "@/app/branding-provider";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/history", label: "History", icon: ClipboardCheck, editorOnly: true },
  { to: "/admin/dashboard", label: "Dashboard settings", icon: PanelsTopLeft, editorOnly: true },
  { to: "/organizational", label: "Organizational", icon: Network },
  { to: "/seat-plan", label: "Seat plan", icon: Armchair },
  { to: "/projects", label: "Project coverage", icon: BriefcaseBusiness },
  { to: "/inbound-call-time", label: "Inbound call time", icon: PhoneIncoming },
  { to: "/work-schedule", label: "Work schedule", icon: CalendarClock },
  { to: "/vl-credits", label: "VL credits", icon: Coins },
  { to: "/app-links", label: "App / Links", icon: Link2 },
  { to: "/agent-profiles", label: "Agent profiles", icon: ContactRound },
  { to: "/kpi-qa", label: "Monthly KPI / QA", icon: BarChart3 },
  { to: "/admin/kpi-scoring", label: "KPI scoring settings", icon: SlidersHorizontal, editorOnly: true },
  { to: "/admin/qa-parameters", label: "QA parameters", icon: ClipboardCheck },
];

export default function Sidebar({ open, collapsed, onClose, onToggleCollapse }) {
  const { canEdit } = useAuth();
  const { branding, logoUrl } = useBranding();
  return (
    <>
      {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand-row">
          <NavLink to="/" className="brand" onClick={onClose} title={branding.sidebar_title}>
            <span className="brand-mark">{logoUrl ? <img src={logoUrl} alt="" /> : "VF"}</span>
            <span>{branding.sidebar_title}</span>
          </NavLink>
          <Button
            variant="ghost"
            size="icon"
            className="sidebar-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </Button>
          <Button variant="ghost" size="icon" className="sidebar-close" aria-label="Close navigation" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          {links.filter((item) => !item.editorOnly || canEdit).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={onClose} title={label} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings" onClick={onClose} title="Settings" className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
            <Settings size={18} strokeWidth={1.8} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}
