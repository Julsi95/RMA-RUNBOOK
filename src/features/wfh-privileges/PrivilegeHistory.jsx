import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Gift, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PrivilegeStatusBadge } from "./PrivilegeStatusBadge";

const ACTION_NAMES = { awarded: "Awarded", revoked: "Revoked", requested: "WFH requested", approved: "WFH approved", rejected: "Request rejected", cancellation_requested: "Cancellation requested", cancellation_approved: "Cancellation approved", cancellation_rejected: "Cancellation rejected", policy_updated: "Company policy updated" };

export function PrivilegeHistory({ requests, audit, employeeName }) {
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const rows = [...requests.map((row) => ({ ...row, kind: "request" })), ...audit.map((row) => ({ ...row, kind: "audit" }))].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <section className="wfh-history-card">
    <header><div><p className="eyebrow">ACTIVITY</p><h2>Request history</h2></div><HistoryIcon size={18} /></header>
    <div className="wfh-history-scroll">
      {rows.length === 0 ? <p className="wfh-empty">Your WFH activity will appear here.</p> : <div className="wfh-history-list">{visibleRows.map((row) => {
        const subject = row.employee_id ? employeeName?.(row.employee_id) ?? "Employee" : "Company policy";
        const policy = row.action === "policy_updated" ? ` · rewards expire in ${row.details?.after?.expiration_days} days; cancellation notice ${row.details?.after?.cancellation_notice_days} days` : "";
        return <article key={`${row.kind}-${row.id}`}>
          <span className="wfh-history-icon">{row.kind === "request" ? <Clock3 size={15} /> : <Gift size={15} />}</span>
          <div><strong>{row.kind === "request" ? `${row.request_type === "cancel" ? "Cancellation" : "WFH"} request` : ACTION_NAMES[row.action] ?? row.action}</strong><span>{subject}{row.kind === "request" ? ` · ${(row.approved_dates ?? row.requested_dates).join(", ")}` : row.details?.days ? ` · ${row.details.days} day(s)` : policy}</span><time>{new Date(row.created_at).toLocaleString()}</time></div>
          {row.kind === "request" && <PrivilegeStatusBadge status={row.status} />}
        </article>;
      })}</div>}
    </div>
    {pageCount > 1 && <nav className="wfh-pagination" aria-label="Request history pages"><span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length}</span><div><Button variant="outline" size="sm" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button><Button variant="outline" size="sm" aria-label="Next page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div></nav>}
  </section>;
}
