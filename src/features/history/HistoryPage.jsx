import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Clock3, RotateCcw, Trash2 } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { deleteHistoryEvent, isHistoryEventRestorable, loadHistoryEvents, resetHistory, restoreHistoryEvent } from "@/lib/backend/history";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { useAuth } from "@/app/auth-provider";
import { Button } from "@/components/ui/Button";
import { fetchCachedQuery, invalidateCachedQueries, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const PAGE_SIZE = 25;

function when(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function HistoryPage() {
  const { canEdit, isAdmin, user } = useAuth();
  const [page, setPage] = useState(0);
  const resourceKey = useMemo(() => [...queryKeys.history(user?.id ?? "anonymous", canEdit), page], [canEdit, page, user?.id]);
  const cached = readCachedQuery(resourceKey);
  const [events, setEvents] = useState(cached?.events ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [loading, setLoading] = useState(isSupabaseConfigured && !cached);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const loadEvents = useCallback(async ({ force = false } = {}) => {
    const result = await fetchCachedQuery(resourceKey, () => retryDataLoad(() => loadHistoryEvents(canEdit, page, PAGE_SIZE)), { force });
    setEvents(result.events);
    setTotal(result.total);
    setError("");
    setLoading(false);
    return result;
  }, [canEdit, page, resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void loadEvents().catch((queryError) => { if (active) { setError(queryError.message || "Could not load history."); setLoading(false); } });
    const unsubscribe = subscribeToTables(["history_events", "history_recovery"], () => {
      if (active) void loadEvents({ force: true }).catch((queryError) => setError(queryError.message || "Could not refresh history."));
    }, "history");
    return () => { active = false; unsubscribe(); };
  }, [loadEvents]);

  async function restore(event) {
    if (!canEdit || !isHistoryEventRestorable(event)) return;
    setBusyId(event.id); setError("");
    try { await restoreHistoryEvent(event.id); await loadEvents({ force: true }); }
    catch (queryError) { setError(queryError.message || "The change was restored, but history could not refresh."); }
    finally { setBusyId(""); }
  }

  async function removeEvent(event) {
    if (!isAdmin || !window.confirm(`Permanently delete this history record?\n\n${event.summary}`)) return;
    setBusyId(event.id); setError("");
    try {
      await deleteHistoryEvent(event.id);
      await invalidateCachedQueries(["history"]);
      if (events.length === 1 && page > 0) setPage((current) => current - 1);
      else await loadEvents({ force: true });
    } catch (cause) { setError(cause.message || "History record could not be deleted."); }
    finally { setBusyId(""); }
  }

  async function clearHistory() {
    if (!isAdmin || !window.confirm("Permanently delete all RUNBOOK history records and recovery snapshots? This cannot be undone.")) return;
    if (window.prompt('Type "reset history" to confirm.') !== "reset history") return;
    setBusyId("reset"); setError("");
    try {
      await resetHistory();
      await invalidateCachedQueries(["history"]);
      setPage(0);
      setEvents([]);
      setTotal(0);
      if (page === 0) await loadEvents({ force: true });
    } catch (cause) { setError(cause.message || "History could not be reset."); }
    finally { setBusyId(""); }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRecord = total ? page * PAGE_SIZE + 1 : 0;
  const lastRecord = Math.min(total, (page + 1) * PAGE_SIZE);

  return <section className="page-content history-page">
    <header className="page-heading"><div><p className="eyebrow">WORKSPACE · RECENT CHANGES</p><h1>History</h1><p className="page-description">A timeline of changes across the workspace. Recoverable changes are kept for 30 days.</p></div><div className="history-heading-actions"><span className="history-retention"><Clock3 size={15} /> Last 30 days</span>{isAdmin && isSupabaseConfigured && <Button type="button" variant="outline" onClick={() => void clearHistory()} disabled={busyId === "reset"}><Trash2 size={14} />{busyId === "reset" ? "Resetting…" : "Reset history"}</Button>}</div></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!isSupabaseConfigured ? <div className="history-empty"><Activity size={22} /><strong>History will appear when Supabase is connected</strong><span>This browser-only prototype does not have a shared change log.</span></div>
      : loading ? <div className="history-empty"><span>Loading recent activity…</span></div>
      : events.length ? <>
        <ol className="history-timeline">{events.map((event) => <li key={event.id} className="history-entry"><span className="history-entry-icon"><Activity size={16} /></span><div className="history-entry-content"><div className="history-entry-heading"><strong>{event.summary}</strong><time dateTime={event.created_at}>{when(event.created_at)}</time></div><p>{event.actor_label} · {event.module}{event.entity_id ? ` · ${event.entity_id}` : ""}</p>{event.recoverable && <div className="history-recoverable"><span><RotateCcw size={13} /> {event.restored_at ? `Restored ${when(event.restored_at)}` : event.hasRecovery ? `Recovery available until ${when(event.expires_at)}` : "Recovery snapshot expired"}</span>{canEdit && event.hasRecovery && !event.restored_at && (isHistoryEventRestorable(event) ? <Button type="button" size="sm" variant="outline" onClick={() => void restore(event)} disabled={Boolean(busyId)}><RotateCcw size={13} /> Restore</Button> : <small>Restore this entry from its page</small>)}</div>}</div>{isAdmin && <Button type="button" size="icon" variant="ghost" className="history-delete-button" aria-label={`Delete history record: ${event.summary}`} title="Delete history record" onClick={() => void removeEvent(event)} disabled={Boolean(busyId)}><Trash2 size={15} /></Button>}</li>)}</ol>
        <nav className="history-pagination" aria-label="History pages"><span>Showing {firstRecord}–{lastRecord} of {total}</span><div><Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page <= 0 || Boolean(busyId)}><ChevronLeft size={15} /> Previous</Button><span>Page {page + 1} of {pageCount}</span><Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount || Boolean(busyId)}>Next <ChevronRight size={15} /></Button></div></nav>
      </>
      : <div className="history-empty"><Activity size={22} /><strong>No recent changes yet</strong><span>Edits made by an authenticated editor will show up here.</span></div>}
  </section>;
}
