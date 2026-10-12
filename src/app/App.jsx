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
import RequireEditor from "@/app/RequireEditor";
import RequireAuth from "@/app/RequireAuth";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from "@/pages/AuthPages";
import HistoryPage from "@/features/history/HistoryPage";

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="admin/dashboard" element={<RequireEditor><DashboardSettingsPage /></RequireEditor>} />
        <Route path="organizational" element={<OrganizationPage />} />
        <Route path="seat-plan" element={<SeatPlanPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="inbound-call-time" element={<InboundSchedulePage />} />
        <Route path="work-schedule" element={<WorkSchedulePage />} />
        <Route path="vl-credits" element={<VlCreditsPage />} />
        <Route path="app-links" element={<AppLinksPage />} />
        <Route path="admin/qa-parameters" element={<QaParametersPage />} />
        <Route path="history" element={<RequireEditor><HistoryPage /></RequireEditor>} />
        <Route path="agent-profiles" element={<AgentProfilesPage />} />
        <Route path="kpi-qa" element={<KpiQaPage />} />
        <Route path="admin/kpi-scoring" element={<RequireEditor><KpiScoringSettingsPage /></RequireEditor>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
