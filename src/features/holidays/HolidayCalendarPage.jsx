import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useHolidayCalendar } from "./useHolidayCalendar";
import { deleteHoliday, saveHoliday } from "./holiday-service";
import { HOLIDAY_COUNTRIES } from "./holiday-types";
import "./holidays.css";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthTitle = (date) => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
const isoDate = (date) => date.toISOString().slice(0, 10);

function HolidayEditor({ holiday, onClose, onSaved }) {
  const [form, setForm] = useState({ country: holiday?.country_code ?? "PH", date: holiday?.holiday_date ?? "", name: holiday?.name_override ?? holiday?.name ?? "", isWorking: holiday?.is_working ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await saveHoliday({ id: holiday?.id, ...form }); onClose(); await onSaved(!holiday); }
    catch (cause) { setError(cause.message || "Holiday could not be saved."); }
    finally { setBusy(false); }
  }
  return <div className="holiday-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="holiday-editor" onSubmit={submit} aria-labelledby="holiday-editor-title">
    <header><div><p className="eyebrow">HOLIDAY CALENDAR</p><h2 id="holiday-editor-title">{holiday ? "Edit holiday" : "Add holiday"}</h2></div><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={18} /></Button></header>
    <label>Holiday name<input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
    <div className="holiday-form-row"><label>Country<select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}><option value="US">United States</option><option value="PH">Philippines</option></select></label><label>Date<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label></div>
    <label>Work status<select value={String(form.isWorking)} onChange={(event) => setForm({ ...form, isWorking: event.target.value === "true" })}><option value="false">Non-working holiday</option><option value="true">Working holiday</option></select></label>
    {holiday?.source === "api" && <p className="holiday-form-hint">Your name and work-status overrides are retained when the holiday provider syncs.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}<footer><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save holiday"}</Button></footer>
  </form></div>;
}

function HolidayYearPreview({ initialYear, onClose }) {
  const [year, setYear] = useState(initialYear);
  const { holidays, loading, error } = useHolidayCalendar(Number(year), { autoSync: false });
  const yearOptions = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 3 + index);
  const sorted = [...holidays].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  return <div className="holiday-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="holiday-year-preview" role="dialog" aria-modal="true" aria-labelledby="holiday-year-title">
    <header><div><p className="eyebrow">YEAR AT A GLANCE</p><h2 id="holiday-year-title">Holiday list</h2></div><Button type="button" variant="ghost" size="icon" aria-label="Close holiday preview" onClick={onClose}><X size={18} /></Button></header>
    <label className="holiday-year-select">Preview year<select value={year} onChange={(event) => setYear(event.target.value)}>{yearOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
    <div className="holiday-year-list" aria-live="polite">
      {loading && <p className="holiday-empty">Loading {year} holidays…</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!loading && !error && sorted.length === 0 && <p className="holiday-empty">No holidays listed for {year}.</p>}
      {sorted.map((item) => <article className={`holiday-year-item ${item.is_working ? "working" : "nonworking"}`} key={item.id}>
        <time dateTime={item.holiday_date}>{DATE_FORMAT.format(new Date(`${item.holiday_date}T00:00:00Z`))}</time><span><strong>{item.name_override || item.name}</strong><small>{HOLIDAY_COUNTRIES[item.country_code]}</small></span><b>{item.is_working ? "Working" : "Non-working"}</b>
      </article>)}
    </div>
    <footer><span>{sorted.length} holidays</span><Button type="button" variant="outline" onClick={onClose}>Close</Button></footer>
  </section></div>;
}

export default function HolidayCalendarPage() {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)); });
  const [country, setCountry] = useState("all");
  const [editor, setEditor] = useState(null);
  const [previewYear, setPreviewYear] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const year = month.getUTCFullYear();
  const { holidays, loading, error, syncing, isAdmin, refresh, sync } = useHolidayCalendar(year);
  const shownHolidays = useMemo(() => holidays.filter((holiday) => country === "all" || holiday.country_code === country), [country, holidays]);
  const byDate = useMemo(() => shownHolidays.reduce((map, item) => map.set(item.holiday_date, [...(map.get(item.holiday_date) ?? []), item]), new Map()), [shownHolidays]);
  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(year, month.getUTCMonth(), 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(year, month.getUTCMonth(), 1 - offset));
    return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * 86_400_000));
  }, [month, year]);
  const monthHolidays = shownHolidays.filter((holiday) => Number(holiday.holiday_date.slice(5, 7)) === month.getUTCMonth() + 1).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));

  async function removeHoliday(item) {
    if (!window.confirm(`Delete “${item.name_override || item.name}” from the calendar?`)) return;
    setActionError(""); setActionMessage("");
    try { await deleteHoliday(item.id); } catch (cause) { setActionError(cause.message || "Holiday could not be deleted."); return; }
    setActionMessage("Holiday deleted successfully.");
    try { await refresh(true); } catch { setActionError("Holiday was deleted, but the calendar could not refresh. Try reloading the calendar."); }
  }
  async function syncCountry(code) { setActionError(""); setActionMessage(""); try { await sync(code, true); setActionMessage(`${code} holidays synchronized successfully.`); } catch (cause) { setActionError(cause.message || "Holiday sync failed."); } }
  async function onHolidaySaved(created) {
    setActionError(""); setActionMessage(created ? "Holiday added successfully." : "Holiday updated successfully.");
    try { await refresh(true); } catch { setActionError("Holiday was saved, but the calendar could not refresh. Try reloading the calendar."); }
  }

  return <section className="page-content holiday-page">
    <header className="page-heading holiday-heading"><div><p className="eyebrow">WORKPLACE CALENDAR</p><h1>US &amp; PH holidays</h1><p className="page-description">Plan WFH dates around public holidays. Non-working holidays are marked in coral.</p></div><div className="holiday-heading-actions">{isAdmin && <><Button type="button" variant="outline" disabled={syncing} onClick={() => { void syncCountry("US"); void syncCountry("PH"); }}><RefreshCw size={15} className={syncing ? "holiday-spin" : ""} />{syncing ? "Syncing" : "Sync holidays"}</Button><Button type="button" onClick={() => setEditor({})}><Plus size={16} /> Add holiday</Button></>}</div></header>
    {(error || actionError) && <p className="auth-error holiday-error" role="alert">{actionError || error}</p>}{actionMessage && <p className="auth-success" role="status">{actionMessage}</p>}
    <div className="holiday-toolbar"><div className="holiday-month-controls"><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(year, month.getUTCMonth() - 1, 1)))}><ChevronLeft size={18} /></Button><h2>{monthTitle(month)}</h2><Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(year, month.getUTCMonth() + 1, 1)))}><ChevronRight size={18} /></Button></div><div className="holiday-toolbar-end"><div className="holiday-filter" role="group" aria-label="Filter by country">{[["all", "Both countries"], ["US", "US"], ["PH", "Philippines"]].map(([value, label]) => <button type="button" key={value} className={country === value ? "selected" : ""} onClick={() => setCountry(value)}>{label}</button>)}</div><Button type="button" variant="outline" onClick={() => setPreviewYear(String(year))}><Eye size={15} /> Preview year</Button></div></div>
    <div className="holiday-layout"><section className="holiday-calendar-panel" aria-label={`${monthTitle(month)} calendar`}><div className="holiday-calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div><div className="holiday-calendar-grid">{monthDays.map((day) => { const date = isoDate(day); const inMonth = day.getUTCMonth() === month.getUTCMonth(); const items = byDate.get(date) ?? []; return <div key={date} className={`holiday-calendar-day ${!inMonth ? "outside" : ""} ${items.some((item) => !item.is_working) ? "has-nonworking" : items.length ? "has-working" : ""}`}><span className="holiday-day-number">{day.getUTCDate()}</span>{items.slice(0, 2).map((item) => <span key={item.id} title={`${item.name_override || item.name} · ${HOLIDAY_COUNTRIES[item.country_code]}`} className={`holiday-day-marker ${item.is_working ? "working" : "nonworking"}`}>{item.name_override || item.name}</span>)}{items.length > 2 && <span className="holiday-more">+{items.length - 2} more</span>}</div>; })}</div><div className="holiday-legend"><span><i className="nonworking" />Non-working</span><span><i className="working" />Working holiday</span></div></section>
      <aside className="holiday-list-panel"><header><div><p className="eyebrow">{HOLIDAY_COUNTRIES[country] ?? "UNITED STATES + PHILIPPINES"}</p><h2>Holidays this month</h2></div><span className="holiday-count">{monthHolidays.length}</span></header>{loading && <p className="holiday-empty">Loading calendar…</p>}{!loading && monthHolidays.length === 0 && <div className="holiday-empty"><CalendarDays size={22} /><span>No holidays in this month.</span></div>}<div className="holiday-list">{monthHolidays.map((item) => <article key={item.id} className={`holiday-list-item ${item.is_working ? "working" : "nonworking"}`}><div className="holiday-list-date"><strong>{Number(item.holiday_date.slice(8, 10))}</strong><span>{DATE_FORMAT.format(new Date(`${item.holiday_date}T00:00:00Z`)).split(" ")[0]}</span></div><div className="holiday-list-copy"><strong>{item.name_override || item.name}</strong><span>{HOLIDAY_COUNTRIES[item.country_code]}</span><span className={`holiday-status ${item.is_working ? "working" : "nonworking"}`}>{item.is_working ? "Working holiday" : "Non-working holiday"}</span></div>{isAdmin && <div className="holiday-item-actions"><Button variant="ghost" size="icon" aria-label={`Edit ${item.name}`} onClick={() => setEditor(item)}><Pencil size={15} /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${item.name}`} onClick={() => void removeHoliday(item)}><Trash2 size={15} /></Button></div>}</article>)}</div><footer>{isAdmin && <div className="holiday-sync-actions"><Button variant="outline" size="sm" disabled={syncing} onClick={() => void syncCountry("US")}>Sync US</Button><Button variant="outline" size="sm" disabled={syncing} onClick={() => void syncCountry("PH")}>Sync PH</Button></div>}<span>Updated automatically from Nager.Date</span></footer></aside></div>
    {editor && <HolidayEditor holiday={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={(created) => onHolidaySaved(created)} />}
    {previewYear && <HolidayYearPreview initialYear={previewYear} onClose={() => setPreviewYear(null)} />}
  </section>;
}
