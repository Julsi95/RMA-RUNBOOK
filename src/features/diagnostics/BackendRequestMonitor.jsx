import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Database, Eraser, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { clearRequestMetrics, subscribeToRequestMetrics } from "@/lib/backend/request-monitor";
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
    </div>) : <p className="request-monitor-empty-small">No requests yet in this browser session.</p>}
  </section>;
}

export default function BackendRequestMonitor() {
  const [metrics, setMetrics] = useState(null);
  const [search, setSearch] = useState("");
  const [pageFilter, setPageFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => subscribeToRequestMetrics(setMetrics), []);

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
      <div><p className="request-monitor-kicker"><Activity size={13} /> DEVELOPER DIAGNOSTICS</p><h2 id="request-monitor-title">Backend request monitor</h2><p>Track Supabase API traffic over the last seven days, across page reloads.</p></div>
      <div className="request-monitor-header-actions"><span className="request-monitor-local"><ShieldCheck size={14} /> Saved in this browser</span><Button type="button" variant="outline" size="sm" disabled={!metrics?.total} onClick={clearRequestMetrics}><Eraser size={14} /> Reset</Button></div>
    </header>

    <div className="request-monitor-stats">
      <article className="request-monitor-stat is-primary"><span>Supabase HTTP requests</span><strong>{metrics?.total ?? 0}</strong><small>Last 7 days · saved locally</small></article>
      <article className="request-monitor-stat"><span>Database API requests</span><strong>{metrics?.byCategory?.["Database API"] ?? 0}</strong><small>REST and RPC endpoints</small></article>
      <article className="request-monitor-stat"><span>Failed requests</span><strong className={metrics?.failed ? "is-error" : ""}>{metrics?.failed ?? 0}</strong><small>Network errors or HTTP 4xx/5xx</small></article>
      <article className="request-monitor-stat"><span>Slowest response</span><strong>{metrics?.total ? `${metrics.slowestMs} ms` : "—"}</strong><small>Observed in the last 7 days</small></article>
    </div>

    <div className="request-monitor-insights">
      <Breakdown title="Requests by page" icon={Activity} values={metrics?.byPage ?? {}} />
      <Breakdown title="Requests by service" icon={Database} values={metrics?.byCategory ?? {}} />
      <section className="request-monitor-last"><h3><Clock3 size={15} />Last request</h3><strong>{metrics?.lastAt ? timeFormat.format(metrics.lastAt) : "No requests yet"}</strong><small>{metrics?.lastAt ? dateFormat.format(metrics.lastAt) : "Supabase calls will appear here as they happen."}</small></section>
    </div>

    <div className="request-monitor-recent-heading"><div><h3>Recent requests</h3><p>Newest first · up to 500 details saved locally for 7 days</p></div><span>{requests.length} shown</span></div>
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

    <p className="request-monitor-note"><ShieldCheck size={14} /> These are HTTP/API requests, not SQL statement or billing counts. Search and filters that run only in the browser make no backend request. Request bodies, query values, credentials, and personal data are never recorded. Realtime WebSocket messages are outside this HTTP counter.</p>
  </section>;
}
