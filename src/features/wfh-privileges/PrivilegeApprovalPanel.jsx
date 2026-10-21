import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { Check, Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PrivilegeStatusBadge } from "./PrivilegeStatusBadge";

export function PrivilegeApprovalPanel({ requests, employeeName, onDecide }) {
  const [datesById, setDatesById] = useState({});
  const [notesById, setNotesById] = useState({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const { search } = useLocation();
  const handledRequest = useRef("");
  const pending = requests.filter((item) => item.status === "pending");
  const requestedId = new URLSearchParams(search).get("request");
  useEffect(() => {
    if (!requestedId || handledRequest.current === requestedId) return;
    const target = document.getElementById("wfh-request-" + requestedId);
    if (!target) return;
    handledRequest.current = requestedId;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.dataset.notificationTarget = "true";
    const timeout = window.setTimeout(() => { delete target.dataset.notificationTarget; }, 2600);
    return () => window.clearTimeout(timeout);
  }, [requestedId, pending.length]);
  async function decide(item, decision) {
    const dates = datesById[item.id] ?? item.requested_dates;
    setError(""); setBusyId(item.id);
    try { await onDecide(item, decision, dates, notesById[item.id] ?? ""); }
    catch (cause) { setError(cause.message || "Request could not be updated."); }
    finally { setBusyId(""); }
  }
  return <section className="wfh-approval-card"><header><div><p className="eyebrow">TEAM REVIEW</p><h2>Approval inbox</h2></div><span className="wfh-pending-count"><Clock3 size={14} />{pending.length} pending</span></header>{error && <p className="auth-error" role="alert">{error}</p>}{pending.length === 0 ? <p className="wfh-empty">No pending requests are assigned to you.</p> : <div className="wfh-approval-list">{pending.map((item) => { const dates = datesById[item.id] ?? item.requested_dates; return <article key={item.id} id={"wfh-request-" + item.id}><div className="wfh-approval-title"><div><strong>{employeeName(item.employee_id)}</strong><span>{item.request_type === "cancel" ? "Cancellation" : "WFH dates"} Â· {new Date(item.created_at).toLocaleDateString()}</span></div><PrivilegeStatusBadge status={item.request_type} /></div><div className="wfh-approval-dates">{dates.map((date, index) => <label key={`${item.id}-${index}`}>Date {index + 1}<input type="date" value={date} disabled={item.request_type === "cancel"} onChange={(event) => setDatesById((current) => ({ ...current, [item.id]: dates.map((value, i) => i === index ? event.target.value : value) }))} /></label>)}</div><textarea rows={2} maxLength={500} placeholder="Decision note (optional)" value={notesById[item.id] ?? ""} onChange={(event) => setNotesById((current) => ({ ...current, [item.id]: event.target.value }))} />{item.note && <p className="wfh-request-note">Employee note: {item.note}</p>}<div className="wfh-approval-actions"><Button variant="outline" disabled={Boolean(busyId)} onClick={() => void decide(item, "reject")}><X size={15} /> Reject</Button><Button disabled={Boolean(busyId)} onClick={() => void decide(item, "approve")}><Check size={15} />{busyId === item.id ? "Savingâ€¦" : item.request_type === "cancel" ? "Approve cancellation" : "Approve dates"}</Button></div></article>; })}</div>}</section>;
}

