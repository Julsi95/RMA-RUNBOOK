import { useMemo, useState } from "react";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { validateRequestedDates, uniqueSortedDates } from "./wfh-utils";

export function PrivilegeRequestForm({ holidays, allocations, onSubmit, busy }) {
  const [mode, setMode] = useState("use");
  const [dateInput, setDateInput] = useState("");
  const [dates, setDates] = useState([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const cancelableDates = useMemo(() => allocations.filter((row) => row.status === "active").map((row) => row.privilege_date).sort(), [allocations]);
  const selectedDates = mode === "cancel" ? dates.filter((date) => cancelableDates.includes(date)) : dates;
  function addDate() { if (!dateInput) return; setDates((current) => uniqueSortedDates([...current, dateInput])); setDateInput(""); setError(""); }
  async function submit(event) {
    event.preventDefault();
    if (mode === "use") { const issue = validateRequestedDates(selectedDates, holidays); if (issue) { setError(issue); return; } }
    else if (!selectedDates.length) { setError("Select at least one approved date to cancel."); return; }
    setError("");
    try { await onSubmit(mode, selectedDates, note); setDates([]); setNote(""); }
    catch (cause) { setError(cause.message || "Your request could not be sent."); }
  }
  return <form className="wfh-form-card" onSubmit={submit}><header><div><p className="eyebrow">REQUEST</p><h2>Plan your WFH days</h2></div><div className="wfh-mode-tabs"><button type="button" className={mode === "use" ? "active" : ""} onClick={() => { setMode("use"); setDates([]); setError(""); }}>Request dates</button><button type="button" className={mode === "cancel" ? "active" : ""} onClick={() => { setMode("cancel"); setDates([]); setError(""); }}>Cancel dates</button></div></header><p className="wfh-helper">{mode === "use" ? "Choose future working weekdays. Your TL or STL will review the dates." : "Choose approved days that meet the company cancellation notice period. Refunds follow the original reward expiry."}</p><div className="wfh-date-add"><input aria-label="Date" type="date" value={dateInput} onChange={(event) => setDateInput(event.target.value)} /><Button type="button" variant="outline" onClick={mode === "use" ? addDate : () => { setDates((current) => uniqueSortedDates([...current, dateInput])); setDateInput(""); setError(""); }}><CalendarPlus size={15} /> Add date</Button></div>{mode === "cancel" && <div className="wfh-date-checkboxes">{cancelableDates.length ? cancelableDates.map((date) => <label key={date}><input type="checkbox" checked={dates.includes(date)} onChange={() => setDates((current) => current.includes(date) ? current.filter((item) => item !== date) : uniqueSortedDates([...current, date]))} />{date}</label>) : <span>No approved WFH dates to cancel.</span>}</div>}{mode === "use" && dateInput && <button type="button" className="wfh-add-date-link" onClick={addDate}>Add {dateInput}</button>}{selectedDates.length > 0 && <div className="wfh-selected-dates">{selectedDates.map((date) => <span key={date}>{date}{mode === "use" && <button type="button" aria-label={`Remove ${date}`} onClick={() => setDates(dates.filter((item) => item !== date))}><X size={12} /></button>}</span>)}</div>}<label className="wfh-note-label">Note <textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for your lead" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<Button disabled={busy || !selectedDates.length}>{busy ? "Sending…" : mode === "use" ? "Send WFH request" : "Request cancellation"}</Button></form>;
}
