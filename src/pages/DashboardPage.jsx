import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard, LoaderCircle, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadPublicWorkspaceDashboard } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import DashboardContainer from "@/features/dashboard/DashboardContainer";
import { DashboardGrid } from "@/features/dashboard/DashboardGrid";
import { DASHBOARD_STORAGE_KEY, readPublishedDashboard } from "@/features/dashboard/dashboard-data";
import "@/features/dashboard/dashboard.css";

const DASHBOARD_QUERY_KEY = queryKeys.publicDashboard();

export default function DashboardPage() {
  const { canEdit, user } = useAuth();
  const cachedDashboard = readCachedQuery(DASHBOARD_QUERY_KEY);
  const [dashboard, setDashboard] = useState(() => isSupabaseConfigured ? cachedDashboard ?? { pageTitle: "Dashboard", pageDescription: "", containerGap: 14, canvasPadding: 0, containers: [] } : readPublishedDashboard());
  const [loading, setLoading] = useState(isSupabaseConfigured && !cachedDashboard);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const publicContainers = dashboard.containers.filter((item) => item.publicVisible === true && !["topAgents", "kpiResult"].includes(item.type));

  const refreshDashboard = useCallback(async ({ initial = false, force = false, isActive = () => true } = {}) => {
    if (!isSupabaseConfigured) return;
    if (initial && !readCachedQuery(DASHBOARD_QUERY_KEY)) setLoading(true);
    else setRefreshing(true);
    try {
      const content = await fetchCachedQuery(DASHBOARD_QUERY_KEY, () => retryDataLoad(loadPublicWorkspaceDashboard), { force });
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
    const unsubscribe = user ? subscribeToTables(["dashboard_publication"], () => {
      if (active) void refreshDashboard({ force: true, isActive: () => active });
    }, "published-dashboard") : () => {};
    window.addEventListener("storage", syncPublished);
    return () => { active = false; unsubscribe(); window.removeEventListener("storage", syncPublished); };
  }, [refreshDashboard, user?.id]);

  return <section className="page-content dashboard-live-page">
    <header className="page-heading dashboard-live-heading">
      <div><p className="eyebrow">YOUR WORKSPACE</p><h1>{dashboard.pageTitle}</h1>{dashboard.pageDescription && <p className="page-description">{dashboard.pageDescription}</p>}</div>
      {canEdit && <Link className="dashboard-settings-link" to="/admin/dashboard"><Settings2 size={15} /> Customize dashboard</Link>}
    </header>
    {(loading || refreshing) && <p className="dashboard-live-sync" role="status"><LoaderCircle size={14} className="dashboard-live-spinner" />{loading ? "Loading the published dashboard…" : "Updating the published dashboard…"}</p>}
    {loadError && <p className="auth-error dashboard-live-error" role="alert">{loadError}<Button type="button" variant="outline" size="sm" onClick={() => void refreshDashboard()}><RefreshCw size={14} /> Retry</Button></p>}
    {!loading && (publicContainers.length ? <div className="dashboard-live-canvas" style={{ "--dashboard-gap": `${dashboard.containerGap ?? 14}px`, "--dashboard-canvas-padding": `${dashboard.canvasPadding ?? 0}px`, "--dashboard-canvas-height": `${dashboard.canvasHeight ?? 560}px` }}><DashboardGrid containers={publicContainers} gap={dashboard.containerGap ?? 14}>{publicContainers.map((item) => <div className="dashboard-live-grid-item" key={item.id}><DashboardContainer item={item} containerGap={dashboard.containerGap ?? 14} /></div>)}</DashboardGrid></div> : <div className="dashboard-live-empty"><span><Sparkles size={22} /></span><strong>{canEdit ? "Your dashboard is ready to fill" : "No public dashboard content has been published"}</strong>{canEdit && <><p>Choose which cards to show in Dashboard Settings.</p><Link to="/admin/dashboard"><Button><LayoutDashboard size={16} /> Open dashboard builder <ArrowRight size={15} /></Button></Link></>}</div>)}
  </section>;
}
