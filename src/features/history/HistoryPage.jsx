import { useCallback, useEffect, useState } from "react";
import { Activity, Clock3, RotateCcw } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isHistoryEventRestorable, loadHistoryEvents, restoreHistoryEvent } from "@/lib/backend/history";
import { useAuth } from "@/app/auth-provider";
import { Button } from "@/components/ui/Button";

function when(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function HistoryPage() {
  const { canEdit } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    const history = await loadHistoryEvents(canEdit);
    setEvents(history);
    setError("");
    setLoading(false);
  }, [canEdit]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void loadEvents().catch((queryError) => { if (active) { setError(queryError.message || "Could not load history."); setLoading(false); } });
    return () => { active = false; };
  }, [loadEvents]);

  async function restore(event) {
    if (!canEdit || !isHistoryEventRestorable(event)) return;
    setLoading(true); setError("");
    try {
      await restoreHistoryEvent(event.id);
      await loadEvents();
    }
    catch (queryError) { setError(queryError.message || "The change was restored, but history could not refresh."); setLoading(false); }
  }

  return <section className="page-content history-page">
    <header className="page-heading"><div><p className="eyebrow">WORKSPACE · RECENT CHANGES</p><h1>History</h1><p className="page-description">A timeline of changes across the workspace. Recoverable changes are kept for 30 days.</p></div><span className="history-retention"><Clock3 size={15} /> Last 30 days</span></header>
    {!isSupabaseConfigured ? <div className="history-empty"><Activity size={22} /><strong>History will appear when Supabase is connected</strong><span>This browser-only prototype does not have a shared change log.</span></div>
      : loading ? <div className="history-empty"><span>Loading recent activity…</span></div>
      : error ? <div className="history-empty" role="alert"><strong>Could not load history</strong><span>{error}</span></div>
      : events.length ? <ol className="history-timeline">{events.map((event) => <li key={event.id} className="history-entry"><span className="history-entry-icon"><Activity size={16} /></span><div className="history-entry-content"><div className="history-entry-heading"><strong>{event.summary}</strong><time dateTime={event.created_at}>{when(event.created_at)}</time></div><p>{event.actor_label} · {event.module}{event.entity_id ? ` · ${event.entity_id}` : ""}</p>{event.recoverable && <div className="history-recoverable"><span><RotateCcw size={13} /> {event.restored_at ? `Restored ${when(event.restored_at)}` : event.hasRecovery ? `Recovery available until ${when(event.expires_at)}` : "Recovery snapshot expired"}</span>{canEdit && event.hasRecovery && !event.restored_at && (isHistoryEventRestorable(event) ? <Button type="button" size="sm" variant="outline" onClick={() => void restore(event)} disabled={loading}><RotateCcw size={13} /> Restore</Button> : <small>Restore this entry from its page</small>)}</div>}</div></li>)}</ol>
      : <div className="history-empty"><Activity size={22} /><strong>No recent changes yet</strong><span>Edits made by an authenticated editor will show up here.</span></div>}
  </section>;
}
