import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Database, Eraser, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { clearRequestMetrics, subscribeToRequestMetrics } from "@/lib/backend/request-monitor";
import { supabase } from "@/lib/supabase";
import "./backend-request-monitor.css";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateInputValue = (timestamp) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function Breakdown({ title, icon: Icon, values }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return <section className="request-monitor-breakdown">
    <h3><Icon size={15} />{title}</h3>
    {entries.length ? entries.map(([label, count]) => <div className="request-monitor-breakdown-row" key={label}>
      <div><span title={label}>{label}</span><strong>{count}</strong></div>
      <span className="request-monitor-bar"><i style={{ width: `${Math.max(4, (count / max) * 100)}%` }} /></span>
    </div>) : <p className="request-monitor-empty-small">No requests recorded in this browser during the last seven days.</p>}
  </section>;
}

export default function BackendRequestMonitor() {
  const [metrics, setMetrics] = useState(null);
  const [search, setSearch] = useState("");
  const [pageFilter, setPageFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sharedMetrics, setSharedMetrics] = useState(null);
  const [sharedError, setSharedError] = useState("");

  useEffect(() => subscribeToRequestMetrics(setMetrics), []);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const loadSharedMetrics = async () => {
      const { data, error } = await supabase.rpc("get_runbook_backend_request_metrics");
      if (!active) return;
      if (error) setSharedError(error.message || "Shared request totals could not be loaded.");
      else { setSharedMetrics(data ?? null); setSharedError(""); }
    };
    void loadSharedMetrics();
    const channel = supabase.channel("shared-backend-request-metrics")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runbook_backend_request_metrics" }, () => { void loadSharedMetrics(); })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  const pages = useMemo(() => Object.keys(metrics?.byPage ?? {}).sort(), [metrics?.byPage]);
  const requests = useMemo(() => {
    const query = search.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return (metrics?.requests ?? []).filter((item) => {
      const matchesQuery = !query || `${item.endpoint} ${item.method} ${item.category} ${item.page} ${item.status}`.toLowerCase().includes(query);
      return matchesQuery && (pageFilter === "all" || item.page === pageFilter) && item.at >= from && item.at <= to;
    });
  }, [fromDate, metrics?.requests, pageFilter, search, toDate]);

  return <section id="backend-requests" className="settings-card settings-admin-section request-monitor" aria-labelledby="request-monitor-title">
    <header className="request-monitor-header">
      <div><p className="request-monitor-kicker"><Activity size={13} /> DEVELOPER DIAGNOSTICS</p><h2 id="request-monitor-title">Backend request monitor</h2><p>Shared weekly totals include requests reported by all visitors. Request details remain local to this browser.</p></div>
      <div className="request-monitor-header-actions"><span className="request-monitor-local"><ShieldCheck size={14} /> Shared totals · local details</span><Button type="button" variant="outline" size="sm" disabled={!metrics?.total} onClick={clearRequestMetrics}><Eraser size={14} /> Reset local</Button></div>
    </header>

    {sharedError && <p className="auth-error request-monitor-shared-error" role="alert">Shared totals are unavailable. Apply the shared request metrics database migration, then reload this page.</p>}
    <div className="request-monitor-stats">
      <article className="request-monitor-stat is-primary"><span>Supabase requests · all visitors</span><strong>{sharedMetrics?.total ?? 0}</strong><small>Current week · resets Sunday (UTC)</small></article>
      <article className="request-monitor-stat"><span>Database API requests</span><strong>{sharedMetrics?.by_category?.["Database API"] ?? 0}</strong><small>Shared REST and RPC total</small></article>
      <article className="request-monitor-stat"><span>Failed requests</span><strong className={sharedMetrics?.failed ? "is-error" : ""}>{sharedMetrics?.failed ?? 0}</strong><small>Shared HTTP and network failures</small></article>
      <article className="request-monitor-stat"><span>Slowest response</span><strong>{sharedMetrics?.total ? `${sharedMetrics.slowest_ms} ms` : "—"}</strong><small>Shared maximum this week</small></article>
    </div>

    <div className="request-monitor-insights">
      <Breakdown title="Shared requests by page" icon={Activity} values={sharedMetrics?.by_page ?? {}} />
      <Breakdown title="Shared requests by service" icon={Database} values={sharedMetrics?.by_category ?? {}} />
      <section className="request-monitor-last"><h3><Clock3 size={15} />Last shared request</h3><strong>{sharedMetrics?.last_at ? timeFormat.format(new Date(sharedMetrics.last_at).getTime()) : "No requests yet"}</strong><small>{sharedMetrics?.last_at ? dateFormat.format(new Date(sharedMetrics.last_at).getTime()) : "Visitor requests will appear here as they happen."}</small></section>
    </div>

    <div className="request-monitor-recent-heading"><div><h3>Recent requests · this browser</h3><p>Newest first · up to 500 local details retained for 7 days</p></div><span>{requests.length} shown</span></div>
    <div className="request-monitor-filters">
      <label className="request-monitor-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter endpoint, method, or page" aria-label="Filter backend requests" /></label>
      <label><span>Page</span><select value={pageFilter} onChange={(event) => setPageFilter(event.target.value)}><option value="all">All pages</option>{pages.map((page) => <option key={page} value={page}>{page}</option>)}</select></label>
      <label><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
    </div>

    <div className="request-monitor-table-wrap">
      {requests.length ? <table className="request-monitor-table"><thead><tr><th>Operation</th><th>Page</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead><tbody>
        {requests.map((request) => <tr key={request.id}>
          <td><span className="request-monitor-method">{request.method}</span><code>{request.endpoint}</code><small>{request.category}</small></td>
          <td><code>{request.page}</code></td>
          <td><span className={`request-monitor-status ${request.failed ? "is-failed" : "is-success"}`}>{request.status}</span></td>
          <td>{request.durationMs} ms</td><td><time dateTime={new Date(request.at).toISOString()}>{dateFormat.format(request.at)}</time></td>
        </tr>)}
      </tbody></table> : <div className="request-monitor-empty"><span><TriangleAlert size={18} /></span><strong>{metrics?.total ? "No requests match these filters" : "Waiting for Supabase requests"}</strong><p>{metrics?.total ? "Adjust the date, page, or search filters." : "Requests will be captured automatically as the app uses Supabase."}</p></div>}
    </div>

    <p className="request-monitor-note"><ShieldCheck size={14} /> Shared figures are weekly aggregate counts across visitors; individual requests, query values, credentials, and personal data are never sent to the metrics table. Metric reporting requests are excluded to prevent a feedback loop. This is HTTP/API traffic, not SQL statement or billing counts, and Realtime WebSocket messages are not included.</p>
  </section>;
}
