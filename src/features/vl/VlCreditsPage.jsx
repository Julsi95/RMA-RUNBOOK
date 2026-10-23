import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CirclePlus, Coins, Pencil, Search, Trash2, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useOrganizationRoster } from "@/app/organization-provider";
import { getOperationalRoster, isOrganizationOnlyLeader } from "@/features/organization/organization-data";
import { useAuth } from "@/app/auth-provider";
import { isSupabaseConfigured } from "@/lib/supabase";
import { deleteVlCreditEntry, loadVlCreditRecords, saveVlCreditEntry } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import "@/features/vl/vl-credits.css";

const STORAGE_KEY = "starter-app-vl-credit-records-v2";
const LEGACY_STORAGE_KEY = "starter-app-vl-credits-v1";

function thisMonth() {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? "vl-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function monthBounds(month) {
  const [year, index] = month.split("-").map(Number);
  const lastDay = new Date(year, index, 0).getDate();
  return { start: month + "-01", end: month + "-" + String(lastDay).padStart(2, "0") };
}

function readLocalRecords() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(current)) return current;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "{}");
    return Object.entries(legacy).flatMap(([month, data]) => (data.entries ?? []).map((entry) => ({
      ...entry, validFrom: month + "-01", validTo: monthBounds(month).end, updatedAt: data.updatedOn ?? "",
    })));
  } catch { return []; }
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Selected month";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(month + "-01T12:00:00"));
}

function prettyDate(value) {
  if (!value) return "Not updated yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value + "T12:00:00"));
}

function displayRange(from, to) {
  return from === to ? prettyDate(from) : prettyDate(from) + " – " + prettyDate(to);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
}

function validValue(value) {
  const cleaned = value.trim();
  return /^proby$/i.test(cleaned) || /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(cleaned);
}

export default function VlCreditsPage() {
  const { members: rosterMembers } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { canEdit, user } = useAuth();
  const resourceKey = useMemo(() => queryKeys.vlCredits(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cachedRecords = readCachedQuery(resourceKey);
  const [month, setMonth] = useState(thisMonth);
  const [records, setRecords] = useState(() => isSupabaseConfigured ? cachedRecords ?? [] : readLocalRecords());
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured || Boolean(cachedRecords));
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const bounds = monthBounds(month);
  const entries = useMemo(() => records.filter((entry) => entry.validFrom <= bounds.end && entry.validTo >= bounds.start), [records, bounds.start, bounds.end]);
  const assignedIds = useMemo(() => new Set(entries.map((entry) => entry.memberId)), [entries]);
  const untrackedCount = members.filter((member) => !assignedIds.has(member.id)).length;
  const visibleEntries = entries.filter((entry) => entry.name.toLowerCase().includes(search.trim().toLowerCase()));
  const numericCount = entries.filter((entry) => entry.value.trim() && Number.isFinite(Number(entry.value))).length;
  const statusCount = entries.length - numericCount;
  const updatedOn = entries.map((entry) => entry.updatedAt?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? "";

  async function refreshRemote(force = true) {
    const saved = await fetchCachedQuery(resourceKey, () => retryDataLoad(loadVlCreditRecords), { force });
    setRecords(saved);
    setSyncError("");
    return saved;
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    void fetchCachedQuery(resourceKey, () => retryDataLoad(loadVlCreditRecords)).then((saved) => {
      if (!active) return;
      setRecords(saved); setRemoteReady(true); setSyncError("");
    }).catch((error) => { if (active) { setSyncError(error.message || "Could not load VL credits."); setRemoteReady(true); } });
    return () => { active = false; };
  }, [resourceKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* keep this view usable for the session */ }
    }
  }, [records]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const unsubscribe = subscribeToTables([
      "vl_months",
      { table: "realtime_sync_signals", filter: "source_table=eq.vl_credit_entries" },
    ], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refreshRemote(true).catch((error) => setSyncError(error.message || "Could not sync VL credits.")); }, 160);
    }, "vl-credits");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [resourceKey]);

  function openEditor(entry = null) {
    if (!canEdit || (isSupabaseConfigured && !remoteReady)) return;
    setFormError(""); setFormMessage("");
    setEditor(entry ? { ...entry } : {
      id: "", memberId: "", value: "", ...bounds,
    });
  }

  async function saveEntry(event) {
    event.preventDefault();
    if (!canEdit || !editor) return;
    setFormError("");
    if (!validValue(editor.value)) { setFormError("Enter a non-negative number (up to 2 decimals) or Proby."); return; }
    if (!editor.validFrom || !editor.validTo || editor.validTo < editor.validFrom) { setFormError("Choose a valid From–To date range."); return; }
    const member = members.find((person) => person.id === editor.memberId);
    if (!member) { setFormError("Choose an active employee from the organization roster."); return; }
    const overlaps = records.some((record) => record.memberId === editor.memberId && record.id !== editor.id && record.validFrom <= editor.validTo && record.validTo >= editor.validFrom);
    if (overlaps) { setFormError("This employee already has a record during those dates. Choose a non-overlapping range."); return; }
    const next = {
      id: editor.id || makeId(), memberId: member.id, name: member.name, role: member.role,
      photo: member.photo ?? "", photoPath: member.photoPath ?? "",
      value: /^proby$/i.test(editor.value.trim()) ? "Proby" : editor.value.trim(),
      validFrom: editor.validFrom, validTo: editor.validTo, updatedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      if (isSupabaseConfigured) {
        await saveVlCreditEntry(next);
        const refreshed = await refreshRemote(true);
        queryClient.setQueryData(resourceKey, refreshed);
      } else {
        setRecords((current) => current.some((record) => record.id === next.id) ? current.map((record) => record.id === next.id ? next : record) : [...current, next]);
      }
      setEditor(null);
      setFormMessage(editor.id ? "VL credit record updated successfully." : "VL credit record added successfully.");
    } catch (error) { setFormError(error.message || "VL record could not be saved."); }
    finally { setBusy(false); }
  }

  async function removeEntry(entry) {
    if (!canEdit || !window.confirm("Delete the VL record for " + entry.name + " (" + displayRange(entry.validFrom, entry.validTo) + ")?")) return;
    setBusy(true); setSyncError("");
    try {
      if (isSupabaseConfigured) { await deleteVlCreditEntry(entry.id); const refreshed = await refreshRemote(true); queryClient.setQueryData(resourceKey, refreshed); }
      else setRecords((current) => current.filter((record) => record.id !== entry.id));
    } catch (error) { setSyncError(error.message || "VL record could not be deleted."); }
    finally { setBusy(false); }
  }

  return <section className="page-content vl-page">
    <header className="page-heading vl-heading">
      <div><p className="eyebrow">PEOPLE · LEAVE TRACKING</p><h1>VL credits</h1><p className="page-description">View a month’s balances from records with clear effective dates.</p></div>
      {canEdit && <Button onClick={() => openEditor()} disabled={busy || !remoteReady}><CirclePlus size={17} /> Add credit record</Button>}
    </header>
    {(syncError || (!remoteReady && isSupabaseConfigured)) && <p className={syncError ? "auth-error" : "page-description"} role={syncError ? "alert" : "status"}>{syncError || "Loading shared VL records…"}</p>}{formMessage && <p className="auth-success" role="status">{formMessage}</p>}

    <section className="vl-overview" aria-label="Monthly VL overview">
      <div className="vl-overview-main"><span className="vl-overview-icon"><Coins size={19} /></span><div><span className="vl-overview-label">VALID ON ANY DAY IN</span><strong>{monthLabel(month)}</strong><small>Entries appear in every month covered by their validity dates.</small></div><div className="vl-stamp"><span>VL</span><i /></div></div>
      <div className="vl-overview-stats">
        <article><span><UsersRound size={15} /> Active records</span><strong>{entries.length}</strong></article>
        <article><span><ArrowUpRight size={15} /> Numeric balances</span><strong>{numericCount}</strong></article>
        <article><span><ArrowDownRight size={15} /> Proby status</span><strong>{statusCount}</strong></article>
        <article className="vl-total-stat"><span><UsersRound size={15} /> Without a record</span><strong>{untrackedCount}</strong></article>
      </div>
    </section>

    <section className="vl-toolbar" aria-label="VL credit controls">
      <label className="vl-month-picker"><CalendarDays size={16} /><span>Viewing</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="VL credits month" /></label>
      <span className="vl-updated-label">Most recent update <strong>{prettyDate(updatedOn)}</strong></span>
      <label className="vl-search"><Search size={16} /><input type="search" placeholder="Find a person" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search VL credits by employee name" /></label>
    </section>

    <section className="vl-ledger-section">
      <div className="vl-ledger-heading"><div><p className="vl-kicker">EFFECTIVE-DATED RECORDS</p><h2>{monthLabel(month)} overview</h2></div><span>{entries.length} {entries.length === 1 ? "record" : "records"}</span></div>
      {visibleEntries.length ? <div className="vl-credit-grid">{visibleEntries.map((entry, index) => {
        const numeric = entry.value.trim() !== "" && Number.isFinite(Number(entry.value));
        return <article className={"vl-credit-card vl-card-tone-" + (index % 4)} key={entry.id}>
          <div className="vl-card-top"><span className="vl-card-index">{String(index + 1).padStart(2, "0")}</span>{canEdit && <div className="vl-card-actions"><Button type="button" variant="ghost" size="icon" aria-label={"Edit VL record for " + entry.name} title="Edit record" onClick={() => openEditor(entry)}><Pencil size={15} /></Button><Button type="button" variant="ghost" size="icon" className="vl-delete-button" aria-label={"Delete VL record for " + entry.name} title="Delete record" onClick={() => void removeEntry(entry)} disabled={busy}><Trash2 size={15} /></Button></div>}</div>
          <div className="vl-person-line"><span className="vl-person-avatar">{entry.photo ? <img src={entry.photo} alt="" /> : initials(entry.name)}</span><div><strong>{entry.name}</strong><small>{isOrganizationOnlyLeader({ role: entry.role }) ? "Team member" : entry.role || "Team member"}</small></div></div>
          <div className="vl-balance-row"><div><span className="vl-balance-caption">VL CREDIT</span><strong className={numeric ? "vl-credit-number" : "vl-credit-status"}>{numeric ? Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : entry.value || "—"}</strong></div><span className={"vl-value-kind " + (numeric ? "is-number" : "is-status")}>{numeric ? "DAYS" : "STATUS"}</span></div>
          <div className="vl-validity"><CalendarDays size={13} /><span>Valid {displayRange(entry.validFrom, entry.validTo)}</span></div>
          <div className="vl-card-footer"><span>Updated {prettyDate(entry.updatedAt?.slice(0, 10))}</span><span className="vl-card-spark" aria-hidden="true"><i /><i /><i /><i /><i /></span></div>
        </article>;
      })}</div> : <div className="vl-empty-state"><span><Coins size={22} /></span><strong>{search ? "No matching people" : "No VL records cover this month"}</strong><p>{search ? "Try a different name." : "Create one effective-dated record; it will appear in every month within its From–To range."}</p>{!search && canEdit && <Button variant="outline" onClick={() => openEditor()} disabled={!remoteReady}><CirclePlus size={16} /> Add first record</Button>}</div>}
    </section>

    {editor && canEdit && <div className="vl-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form className="vl-dialog" role="dialog" aria-modal="true" aria-labelledby="vl-dialog-title" onSubmit={saveEntry}>
      <div className="vl-dialog-heading"><div><p className="vl-kicker">{editor.id ? "EDIT RECORD" : "NEW RECORD"}</p><h2 id="vl-dialog-title">{editor.id ? "Update VL credit" : "Add VL credit record"}</h2><p>The record will show in each month touched by this date range.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close VL credit form" onClick={() => setEditor(null)}><X size={17} /></Button></div>
      <label className="vl-form-field"><span>Employee</span><Select value={editor.memberId} onValueChange={(memberId) => setEditor((value) => ({ ...value, memberId }))}><SelectTrigger aria-label="Choose employee"><SelectValue placeholder="Choose from roster" /></SelectTrigger><SelectContent>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name} · {member.role}</SelectItem>)}</SelectContent></Select></label>
      <label className="vl-form-field"><span>Credit or status</span><select value={/^proby$/i.test(editor.value) ? "Proby" : "number"} onChange={(event) => setEditor((value) => ({ ...value, value: event.target.value === "Proby" ? "Proby" : "" }))}><option value="number">Numeric days</option><option value="Proby">Proby</option></select></label>
      {/^proby$/i.test(editor.value) ? <div className="vl-form-field"><span>Status</span><input value="Proby" readOnly /></div> : <label className="vl-form-field"><span>VL days</span><input type="number" inputMode="decimal" min="0" step="0.01" value={editor.value} onChange={(event) => setEditor((value) => ({ ...value, value: event.target.value }))} placeholder="e.g. 14.17" required /></label>}
      <div className="vl-date-range-fields"><label className="vl-form-field"><span>From</span><input type="date" value={editor.validFrom} onChange={(event) => setEditor((value) => ({ ...value, validFrom: event.target.value }))} required /></label><label className="vl-form-field"><span>To</span><input type="date" value={editor.validTo} onChange={(event) => setEditor((value) => ({ ...value, validTo: event.target.value }))} required /></label></div>
      {formError && <p className="auth-error" role="alert">{formError}</p>}
      <div className="vl-form-hint"><Coins size={15} /><span>Past months remain historical views. Overlapping dates for the same person are blocked.</span></div>
      <div className="vl-dialog-actions"><Button type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy || !editor.memberId}>{busy ? "Saving…" : editor.id ? "Save changes" : "Add record"}</Button></div>
    </form></div>}
  </section>;
}
