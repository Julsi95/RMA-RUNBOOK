import { useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadPublishedDashboard } from "@/lib/backend-repositories";
import DashboardContainer from "@/features/dashboard/DashboardContainer";
import { DASHBOARD_STORAGE_KEY, readPublishedDashboard } from "@/features/dashboard/dashboard-data";
import "@/features/dashboard/dashboard.css";

export default function DashboardPage() {
  const { canEdit } = useAuth();
  const [dashboard, setDashboard] = useState(() => isSupabaseConfigured ? { pageTitle: "Loading dashboard…", pageDescription: "", containerGap: 14, canvasPadding: 0, containers: [] } : readPublishedDashboard());
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    if (isSupabaseConfigured) {
      void loadPublishedDashboard().then((content) => { if (active && content) setDashboard(content); }).catch((error) => { if (active) setLoadError(error.message || "Could not load the published dashboard."); });
    }
    function syncPublished(event) {
      if (!isSupabaseConfigured && event.key === DASHBOARD_STORAGE_KEY) setDashboard(readPublishedDashboard());
    }
    window.addEventListener("storage", syncPublished);
    return () => { active = false; window.removeEventListener("storage", syncPublished); };
  }, []);

  return <section className="page-content dashboard-live-page">
    <header className="page-heading dashboard-live-heading">
      <div><p className="eyebrow">YOUR WORKSPACE</p><h1>{dashboard.pageTitle}</h1>{dashboard.pageDescription && <p className="page-description">{dashboard.pageDescription}</p>}</div>
      {canEdit && <Link className="dashboard-settings-link" to="/admin/dashboard"><Settings2 size={15} /> Customize dashboard</Link>}
    </header>
    {loadError && <p className="auth-error" role="alert">{loadError}</p>}
    {dashboard.containers.length ? <div className="dashboard-live-canvas" style={{ "--dashboard-gap": `${dashboard.containerGap ?? 14}px`, "--dashboard-canvas-padding": `${dashboard.canvasPadding ?? 0}px` }}><div className="dashboard-layout-grid">{dashboard.containers.map((item) => <DashboardContainer item={item} key={item.id} />)}</div></div> : <div className="dashboard-live-empty"><span><Sparkles size={22} /></span><strong>{canEdit ? "Your dashboard is ready to fill" : "No dashboard content has been published"}</strong>{canEdit && <><p>Add announcement cards, features, team messages, or quick links.</p><Link to="/admin/dashboard"><Button><LayoutDashboard size={16} /> Open dashboard builder <ArrowRight size={15} /></Button></Link></>}</div>}
  </section>;
}
