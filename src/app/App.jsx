import { Navigate, Route, Routes } from "react-router";
import AppShell from "@/components/layout/AppShell";
import DashboardPage from "@/pages/DashboardPage";
import SettingsPage from "@/pages/SettingsPage";
import OrganizationPage from "@/features/organization/OrganizationPage";
import SeatPlanPage from "@/features/seating/SeatPlanPage";
import KpiQaPage from "@/features/kpi/KpiQaPage";
import KpiScoringSettingsPage from "@/features/kpi/KpiScoringSettingsPage";
import ProjectsPage from "@/pages/ProjectsPage";
import InboundSchedulePage from "@/features/inbound/InboundSchedulePage";
import WorkSchedulePage from "@/features/inbound/WorkSchedulePage";
import VlCreditsPage from "@/features/vl/VlCreditsPage";
import AppLinksPage from "@/features/links/AppLinksPage";
import QaParametersPage from "@/features/qa/QaParametersPage";
import AgentProfilesPage from "@/features/agents/AgentProfilesPage";
import DashboardSettingsPage from "@/features/dashboard/DashboardSettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="admin/dashboard" element={<DashboardSettingsPage />} />
        <Route path="organizational" element={<OrganizationPage />} />
        <Route path="seat-plan" element={<SeatPlanPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="inbound-call-time" element={<InboundSchedulePage />} />
        <Route path="work-schedule" element={<WorkSchedulePage />} />
        <Route path="vl-credits" element={<VlCreditsPage />} />
        <Route path="app-links" element={<AppLinksPage />} />
        <Route path="admin/qa-parameters" element={<QaParametersPage />} />
        <Route path="agent-profiles" element={<AgentProfilesPage />} />
        <Route path="kpi-qa" element={<KpiQaPage />} />
        <Route path="admin/kpi-scoring" element={<KpiScoringSettingsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
