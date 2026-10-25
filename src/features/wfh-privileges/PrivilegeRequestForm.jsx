import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isWorkingWeekday, validateRequestedDates, uniqueSortedDates } from "./wfh-utils";

function runbookToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dateKey(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toCalendarDays(month) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, index - firstWeekday + 1));
    return { key: dateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()), day: date.getUTCDate(), inMonth: date.getUTCMonth() === monthIndex };
  });
}

function prettyDate(value) {
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00Z`));
}

export function PrivilegeRequestForm({ holidays, allocations, requests = [], onSubmit, busy }) {
  const [mode, setMode] = useState("use");
  const today = runbookToday();
  const [month, setMonth] = useState(() => { const [year, monthNumber] = runbookToday().split("-").map(Number); return new Date(Date.UTC(year, monthNumber - 1, 1)); });
  const [stagedDates, setStagedDates] = useState([]);
  const [dates, setDates] = useState([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const cancelableDates = useMemo(() => allocations.filter((row) => row.status === "active").map((row) => row.privilege_date).sort(), [allocations]);
  const selectedDates = mode === "cancel" ? dates.filter((date) => cancelableDates.includes(date)) : dates;
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
  const calendarDays = useMemo(() => toCalendarDays(month), [month]);
  const pendingDates = useMemo(() => new Set(requests.filter((request) => request.request_type === "use" && request.status === "pending").flatMap((request) => request.requested_dates ?? [])), [requests]);
  const activeDates = useMemo(() => new Set(allocations.filter((row) => row.status === "active").map((row) => row.privilege_date)), [allocations]);

  function dateIssue(date) {
    if (date <= today) return "Past or same-day dates cannot be requested. Choose a future date.";
    if (pendingDates.has(date) || activeDates.has(date)) return `${prettyDate(date)} is already filed or scheduled for WFH.`;
    if (!isWorkingWeekday(date, holidays)) return `${prettyDate(date)} is not a working weekday.`;
    if (dates.includes(date) || stagedDates.includes(date)) return `${prettyDate(date)} is already selected.`;
    if (dates.length + stagedDates.length >= 30) return "You can select up to 30 WFH dates per request.";
    return "";
  }

  function toggleStage(date) {
    setError("");
    if (stagedDates.includes(date)) { setStagedDates((current) => current.filter((item) => item !== date)); return; }
    const issue = dateIssue(date);
    if (issue) { setError(issue); return; }
    setStagedDates((current) => uniqueSortedDates([...current, date]));
  }

  function addDates() {
    if (!stagedDates.length) { setError("Select one or more future working dates first."); return; }
    setDates((current) => uniqueSortedDates([...current, ...stagedDates]));
    setStagedDates([]);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    if (mode === "use") {
      const issue = validateRequestedDates(selectedDates, holidays, today);
      if (issue) { setError(issue); return; }
      const conflict = selectedDates.find((date) => pendingDates.has(date) || activeDates.has(date));
      if (conflict) { setError(`${prettyDate(conflict)} is already filed or scheduled for WFH.`); return; }
    } else if (!selectedDates.length) { setError("Select at least one approved date to cancel."); return; }
    setError("");
    try { await onSubmit(mode, selectedDates, note); setDates([]); setStagedDates([]); setNote(""); setMessage(mode === "use" ? "WFH request sent successfully for review." : "Cancellation request sent successfully for review."); }
    catch (cause) { setMessage(""); setError(cause.message || "Your request could not be sent."); }
  }

  return <form className="wfh-form-card" onSubmit={submit}>
    <header><div><p className="eyebrow">REQUEST</p><h2>Plan your WFH days</h2></div><div className="wfh-mode-tabs"><button type="button" className={mode === "use" ? "active" : ""} onClick={() => { setMode("use"); setDates([]); setStagedDates([]); setError(""); setMessage(""); }}>Request dates</button><button type="button" className={mode === "cancel" ? "active" : ""} onClick={() => { setMode("cancel"); setDates([]); setStagedDates([]); setError(""); setMessage(""); }}>Cancel dates</button></div></header>
    <p className="wfh-helper">{mode === "use" ? "Select several future working weekdays, then add them to your request." : "Choose approved days that meet the company cancellation notice period. Refunds follow the original reward expiry."}</p>
    {mode === "use" ? <section className="wfh-request-calendar" aria-label="Select WFH dates">
      <header><Button type="button" size="icon" variant="ghost" aria-label="Previous month" onClick={() => setMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)))}><ChevronLeft size={16} /></Button><strong><CalendarDays size={15} />{monthLabel}</strong><Button type="button" size="icon" variant="ghost" aria-label="Next month" onClick={() => setMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)))}><ChevronRight size={16} /></Button></header>
      <div className="wfh-calendar-layout">
        <div className="wfh-calendar-main">
          <div className="wfh-calendar-grid" role="group" aria-label={monthLabel}>{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span className="wfh-calendar-weekday" key={`${day}-${index}`}>{day}</span>)}{calendarDays.map((entry) => {
            const issue = dateIssue(entry.key);
            const selected = stagedDates.includes(entry.key);
            return <button type="button" key={entry.key} className={`wfh-calendar-day${entry.inMonth ? "" : " outside"}${selected ? " selected" : ""}${issue && entry.inMonth && !selected ? " unavailable" : ""}`} aria-pressed={selected} aria-label={`${prettyDate(entry.key)}${issue ? `: ${issue}` : ""}`} title={issue || prettyDate(entry.key)} onClick={() => toggleStage(entry.key)}>{entry.day}</button>;
          })}</div>
          <div className="wfh-calendar-legend"><span><i className="available" /> Available</span><span><i className="unavailable" /> Filed, scheduled, past, or non-working</span><span><i className="selected" /> Selected</span></div>
        </div>
        <aside className="wfh-calendar-selection" aria-label="Dates ready to add">
          <div className="wfh-staged-dates"><strong>{stagedDates.length ? `${stagedDates.length} date${stagedDates.length === 1 ? "" : "s"} ready to add` : "Dates ready to add"}</strong><div>{stagedDates.length ? stagedDates.map((date) => <span key={date}>{prettyDate(date)}<button type="button" aria-label={`Remove ${date} from selection`} onClick={() => setStagedDates((current) => current.filter((item) => item !== date))}><X size={12} /></button></span>) : <p>Select available days on the calendar. Your choices will appear here.</p>}</div></div>
          <Button type="button" variant="outline" onClick={addDates} disabled={!stagedDates.length}><CalendarPlus size={15} /> Add Date{stagedDates.length > 1 ? "s" : ""}</Button>
        </aside>
      </div>
    </section> : <div className="wfh-date-checkboxes">{cancelableDates.length ? cancelableDates.map((date) => <label key={date}><input type="checkbox" checked={dates.includes(date)} onChange={() => setDates((current) => current.includes(date) ? current.filter((item) => item !== date) : uniqueSortedDates([...current, date]))} />{prettyDate(date)}</label>) : <span>No approved WFH dates to cancel.</span>}</div>}
    {selectedDates.length > 0 && <div className="wfh-selected-dates"><strong>Request dates</strong>{selectedDates.map((date) => <span key={date}>{prettyDate(date)}<button type="button" aria-label={`Remove ${date}`} onClick={() => setDates((current) => current.filter((item) => item !== date))}><X size={12} /></button></span>)}</div>}
    <label className="wfh-note-label">Note <textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for your lead" /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <Button disabled={busy || !selectedDates.length}>{busy ? "Sending…" : mode === "use" ? "Send WFH request" : "Request cancellation"}</Button>
  </form>;
}
