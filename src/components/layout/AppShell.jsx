import { useState } from "react";
import { Outlet } from "react-router";
import Navbar from "@/components/layout/Navbar";
import Sidebar from "@/components/layout/Sidebar";
import { BrandingProvider } from "@/app/branding-provider";
import { NotificationProvider } from "@/app/notification-provider";

export default function AppShell({ publicWorkspace = false }) {
  return <BrandingProvider><NotificationProvider><AppShellLayout publicWorkspace={publicWorkspace} /></NotificationProvider></BrandingProvider>;
}

function AppShellLayout({ publicWorkspace }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("starter-app-sidebar-collapsed") === "true",
  );

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      localStorage.setItem("starter-app-sidebar-collapsed", String(nextCollapsed));
      return nextCollapsed;
    });
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <Sidebar
        publicWorkspace={publicWorkspace}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={toggleSidebar}
      />
      <div className="main-column">
        <Navbar onMenuClick={() => setSidebarOpen(true)} publicWorkspace={publicWorkspace} />
        <main className="page-container"><Outlet /></main>
      </div>
    </div>
  );
}
