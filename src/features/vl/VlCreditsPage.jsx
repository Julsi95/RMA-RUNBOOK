import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CirclePlus, Coins, Pencil, Search, Trash2, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { getOrganizationMembers } from "@/features/organization/organization-data";
import "@/features/vl/vl-credits.css";

const STORAGE_KEY = "starter-app-vl-credits-v1";

function thisMonth() {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function today() {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? "vl-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function readMonthData() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Selected month";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(month + "-01T12:00:00"));
}

function prettyDate(date) {
  if (!date) return "Not updated yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date + "T12:00:00"));
}

export default function VlCreditsPage() {
  const [members] = useState(getOrganizationMembers);
  const [month, setMonth] = useState(thisMonth);
  const [monthData, setMonthData] = useState(readMonthData);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const currentData = monthData[month] ?? { updatedOn: "", entries: [] };
  const entries = currentData.entries ?? [];
  const assignedIds = useMemo(() => new Set(entries.map((entry) => entry.memberId)), [entries]);
  const untrackedCount = members.filter((member) => !assignedIds.has(member.id)).length;
  const visibleEntries = entries.filter((entry) => entry.name.toLowerCase().includes(search.trim().toLowerCase()));
  const numericCount = entries.filter((entry) => entry.value.trim() && Number.isFinite(Number(entry.value))).length;
  const statusCount = entries.length - numericCount;

  function updateMonth(updater) {
    setMonthData((current) => {
      const base = current[month] ?? { updatedOn: "", entries: [] };
      const next = { ...current, [month]: updater(base) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* retain this session's edits */ }
      return next;
    });
  }

  function openEditor(entry = null) {
    setEditor(entry ? { ...entry } : { id: "", memberId: "", name: "", role: "", photo: "", value: "" });
  }

  function saveEntry(event) {
    event.preventDefault();
    const member = members.find((person) => person.id === editor.memberId);
    const existing = entries.find((entry) => entry.id === editor.id);
    if (!existing && assignedIds.has(editor.memberId)) return;
    if (!member && !existing) return;
    const entry = {
      id: editor.id || makeId(),
      memberId: editor.memberId,
      name: member?.name ?? editor.name,
      role: member?.role ?? editor.role,
      photo: member?.photo ?? editor.photo ?? "",
      value: editor.value.trim(),
    };
    updateMonth((data) => ({
      updatedOn: today(),
      entries: existing ? data.entries.map((item) => item.id === existing.id ? entry : item) : [...data.entries, entry],
    }));
    setEditor(null);
  }

  function deleteEntry(entryId) {
    updateMonth((data) => ({ updatedOn: today(), entries: data.entries.filter((entry) => entry.id !== entryId) }));
  }

  return <section className="page-content vl-page">
    <header className="page-heading vl-heading">
      <div><p className="eyebrow">PEOPLE · LEAVE TRACKING</p><h1>VL credits</h1><p className="page-description">Keep each person’s monthly VL balance or status in one place.</p></div>
      <Button onClick={() => openEditor()} disabled={!untrackedCount}><CirclePlus size={17} /> Add credit</Button>
    </header>

    <section className="vl-overview" aria-label="Monthly VL overview">
      <div className="vl-overview-main"><span className="vl-overview-icon"><Coins size={19} /></span><div><span className="vl-overview-label">MONTHLY SNAPSHOT</span><strong>{monthLabel(month)}</strong><small>Update entries as new credit information arrives.</small></div><div className="vl-stamp"><span>VL</span><i /></div></div>
      <div className="vl-overview-stats">
        <article><span><UsersRound size={15} /> People tracked</span><strong>{entries.length}</strong></article>
        <article><span><ArrowUpRight size={15} /> Numeric balances</span><strong>{numericCount}</strong></article>
        <article><span><ArrowDownRight size={15} /> Status entries</span><strong>{statusCount}</strong></article>
        <article className="vl-total-stat"><span><UsersRound size={15} /> Still to add</span><strong>{untrackedCount}</strong></article>
      </div>
    </section>

    <section className="vl-toolbar" aria-label="VL credit controls">
      <label className="vl-month-picker"><CalendarDays size={16} /><span>Viewing</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="VL credits month" /></label>
      <span className="vl-updated-label">Last updated <strong>{prettyDate(currentData.updatedOn)}</strong></span>
      <label className="vl-search"><Search size={16} /><input type="search" placeholder="Find a person" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search VL credits by employee name" /></label>
    </section>

    <section className="vl-ledger-section">
      <div className="vl-ledger-heading"><div><p className="vl-kicker">CREDIT ROSTER</p><h2>{monthLabel(month)} overview</h2></div><span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span></div>
      {visibleEntries.length ? <div className="vl-credit-grid">{visibleEntries.map((entry, index) => {
        const numeric = entry.value.trim() !== "" && Number.isFinite(Number(entry.value));
        return <article className={"vl-credit-card vl-card-tone-" + (index % 4)} key={entry.id}>
          <div className="vl-card-top"><span className="vl-card-index">{String(index + 1).padStart(2, "0")}</span><div className="vl-card-actions"><Button type="button" variant="ghost" size="icon" aria-label={"Edit VL credit for " + entry.name} title="Edit entry" onClick={() => openEditor(entry)}><Pencil size={15} /></Button><Button type="button" variant="ghost" size="icon" className="vl-delete-button" aria-label={"Delete VL credit for " + entry.name} title="Delete entry" onClick={() => deleteEntry(entry.id)}><Trash2 size={15} /></Button></div></div>
          <div className="vl-person-line"><span className="vl-person-avatar">{entry.photo ? <img src={entry.photo} alt="" /> : initials(entry.name)}</span><div><strong>{entry.name}</strong><small>{entry.role || "Team member"}</small></div></div>
          <div className="vl-balance-row"><div><span className="vl-balance-caption">VL CREDIT</span><strong className={numeric ? "vl-credit-number" : "vl-credit-status"}>{numeric ? Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : entry.value || "—"}</strong></div><span className={"vl-value-kind " + (numeric ? "is-number" : "is-status")}>{numeric ? "DAYS" : "STATUS"}</span></div>
          <div className="vl-card-footer"><span>Updated {prettyDate(currentData.updatedOn)}</span><span className="vl-card-spark" aria-hidden="true"><i /><i /><i /><i /><i /></span></div>
        </article>;
      })}</div> : <div className="vl-empty-state"><span><Coins size={22} /></span><strong>{search ? "No matching people" : "No VL entries for this month"}</strong><p>{search ? "Try a different name." : "Add a roster member and enter their current credit or status."}</p>{!search && <Button variant="outline" onClick={() => openEditor()} disabled={!untrackedCount}><CirclePlus size={16} /> Add first entry</Button>}</div>}
    </section>

    {editor && <div className="vl-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form className="vl-dialog" role="dialog" aria-modal="true" aria-labelledby="vl-dialog-title" onSubmit={saveEntry}>
      <div className="vl-dialog-heading"><div><p className="vl-kicker">{editor.id ? "EDIT ENTRY" : "NEW ENTRY"}</p><h2 id="vl-dialog-title">{editor.id ? "Update VL credit" : "Add VL credit"}</h2><p>Record a number of days or a status such as “Proby”.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close VL credit form" onClick={() => setEditor(null)}><X size={17} /></Button></div>
      <label className="vl-form-field"><span>Employee</span><Select value={editor.memberId} onValueChange={(memberId) => { const member = members.find((person) => person.id === memberId); setEditor((value) => ({ ...value, memberId, name: member?.name ?? "", role: member?.role ?? "", photo: member?.photo ?? "" })); }}><SelectTrigger aria-label="Choose employee"><SelectValue placeholder="Choose from roster" /></SelectTrigger><SelectContent>{members.filter((member) => !assignedIds.has(member.id) || member.id === editor.memberId).map((member) => <SelectItem key={member.id} value={member.id}>{member.name} · {member.role}</SelectItem>)}</SelectContent></Select></label>
      <label className="vl-form-field"><span>VL credit or status</span><input autoFocus value={editor.value} onChange={(event) => setEditor((value) => ({ ...value, value: event.target.value }))} placeholder="e.g. 14.17 or Proby" required /></label>
      <div className="vl-form-hint"><Coins size={15} /><span>This is a manual value for now. The official calculation can be added later.</span></div>
      <div className="vl-dialog-actions"><Button type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={!editor.memberId || !editor.value.trim()}>{editor.id ? "Save changes" : "Add to month"}</Button></div>
    </form></div>}
  </section>;
}
