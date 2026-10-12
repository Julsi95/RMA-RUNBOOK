import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard, LoaderCircle, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadPublishedDashboard } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import DashboardContainer from "@/features/dashboard/DashboardContainer";
import { DASHBOARD_STORAGE_KEY, readPublishedDashboard } from "@/features/dashboard/dashboard-data";
import "@/features/dashboard/dashboard.css";

export default function DashboardPage() {
  const { canEdit } = useAuth();
  const [dashboard, setDashboard] = useState(() => isSupabaseConfigured ? { pageTitle: "Dashboard", pageDescription: "", containerGap: 14, canvasPadding: 0, containers: [] } : readPublishedDashboard());
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refreshDashboard = useCallback(async ({ initial = false, isActive = () => true } = {}) => {
    if (!isSupabaseConfigured) return;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const content = await retryDataLoad(loadPublishedDashboard);
      if (!isActive()) return;
      setDashboard(content ?? { pageTitle: "Dashboard", pageDescription: "", containerGap: 14, canvasPadding: 0, containers: [] });
      setLoadError("");
    } catch (error) {
      if (isActive()) setLoadError(error.message || "Could not load the published dashboard. Check your connection and retry.");
    } finally {
      if (isActive()) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (isSupabaseConfigured) {
      void refreshDashboard({ initial: true, isActive: () => active });
    }
    function syncPublished(event) {
      if (!isSupabaseConfigured && event.key === DASHBOARD_STORAGE_KEY) setDashboard(readPublishedDashboard());
    }
    const unsubscribe = subscribeToTables(["dashboard_publication"], () => {
      if (active) void refreshDashboard({ isActive: () => active });
    }, "published-dashboard");
    window.addEventListener("storage", syncPublished);
    return () => { active = false; unsubscribe(); window.removeEventListener("storage", syncPublished); };
  }, [refreshDashboard]);

  return <section className="page-content dashboard-live-page">
    <header className="page-heading dashboard-live-heading">
      <div><p className="eyebrow">YOUR WORKSPACE</p><h1>{dashboard.pageTitle}</h1>{dashboard.pageDescription && <p className="page-description">{dashboard.pageDescription}</p>}</div>
      {canEdit && <Link className="dashboard-settings-link" to="/admin/dashboard"><Settings2 size={15} /> Customize dashboard</Link>}
    </header>
    {(loading || refreshing) && <p className="dashboard-live-sync" role="status"><LoaderCircle size={14} className="dashboard-live-spinner" />{loading ? "Loading the published dashboard…" : "Updating the published dashboard…"}</p>}
    {loadError && <p className="auth-error dashboard-live-error" role="alert">{loadError}<Button type="button" variant="outline" size="sm" onClick={() => void refreshDashboard()}><RefreshCw size={14} /> Retry</Button></p>}
    {!loading && (dashboard.containers.length ? <div className="dashboard-live-canvas" style={{ "--dashboard-gap": `${dashboard.containerGap ?? 14}px`, "--dashboard-canvas-padding": `${dashboard.canvasPadding ?? 0}px` }}><div className="dashboard-layout-grid">{dashboard.containers.map((item) => <DashboardContainer item={item} key={item.id} />)}</div></div> : <div className="dashboard-live-empty"><span><Sparkles size={22} /></span><strong>{canEdit ? "Your dashboard is ready to fill" : "No dashboard content has been published"}</strong>{canEdit && <><p>Add announcement cards, features, team messages, or quick links.</p><Link to="/admin/dashboard"><Button><LayoutDashboard size={16} /> Open dashboard builder <ArrowRight size={15} /></Button></Link></>}</div>)}
  </section>;
}
