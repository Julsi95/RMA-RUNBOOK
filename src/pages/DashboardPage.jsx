import { useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard, Settings2, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import DashboardContainer from "@/features/dashboard/DashboardContainer";
import { DASHBOARD_STORAGE_KEY, readPublishedDashboard } from "@/features/dashboard/dashboard-data";
import "@/features/dashboard/dashboard.css";

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(readPublishedDashboard);

  useEffect(() => {
    function syncPublished(event) {
      if (event.key === DASHBOARD_STORAGE_KEY) setDashboard(readPublishedDashboard());
    }
    window.addEventListener("storage", syncPublished);
    return () => window.removeEventListener("storage", syncPublished);
  }, []);

  return <section className="page-content dashboard-live-page">
    <header className="page-heading dashboard-live-heading">
      <div><p className="eyebrow">YOUR WORKSPACE</p><h1>{dashboard.pageTitle}</h1>{dashboard.pageDescription && <p className="page-description">{dashboard.pageDescription}</p>}</div>
      <Link className="dashboard-settings-link" to="/admin/dashboard"><Settings2 size={15} /> Customize dashboard</Link>
    </header>
    {dashboard.containers.length ? <div className="dashboard-live-canvas" style={{ "--dashboard-gap": `${dashboard.containerGap ?? 14}px`, "--dashboard-canvas-padding": `${dashboard.canvasPadding ?? 0}px` }}><div className="dashboard-layout-grid">{dashboard.containers.map((item) => <DashboardContainer item={item} key={item.id} />)}</div></div> : <div className="dashboard-live-empty"><span><Sparkles size={22} /></span><strong>Your dashboard is ready to fill</strong><p>Add announcement cards, features, team messages, or quick links.</p><Link to="/admin/dashboard"><Button><LayoutDashboard size={16} /> Open dashboard builder <ArrowRight size={15} /></Button></Link></div>}
  </section>;
}
