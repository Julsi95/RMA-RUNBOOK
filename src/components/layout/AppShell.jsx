import { useState } from "react";
import { Outlet } from "react-router";
import Navbar from "@/components/layout/Navbar";
import Sidebar from "@/components/layout/Sidebar";

export default function AppShell() {
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
