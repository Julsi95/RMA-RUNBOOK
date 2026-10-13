import { useState } from "react";
import { Outlet } from "react-router";
import Navbar from "@/components/layout/Navbar";
import Sidebar from "@/components/layout/Sidebar";
import { BrandingProvider } from "@/app/branding-provider";
import { NotificationProvider } from "@/app/notification-provider";

export default function AppShell() {
  return <BrandingProvider><NotificationProvider><AppShellLayout /></NotificationProvider></BrandingProvider>;
}

function AppShellLayout() {
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
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={toggleSidebar}
      />
      <div className="main-column">
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="page-container"><Outlet /></main>
      </div>
    </div>
  );
}
