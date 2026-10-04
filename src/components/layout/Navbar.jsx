import { Menu, Moon, Sun } from "lucide-react";
import { useLocation } from "react-router";
import { useTheme } from "@/app/theme-provider";
import { Button } from "@/components/ui/Button";

export default function Navbar({ onMenuClick }) {
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const pageLabels = {
    "/": "Dashboard",
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
        <Button variant="ghost" size="icon" aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} onClick={toggleTheme}>
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
        <div className="avatar" aria-label="Your profile">U</div>
      </div>
    </header>
  );
}
