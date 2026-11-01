import { useEffect, useMemo, useState } from "react";
import { Award, CalendarDays, ChevronLeft, ChevronRight, Clock3, Gift, Settings2, Shield, UsersRound } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/app/auth-provider";
import { useOrganizationRoster } from "@/app/organization-provider";
import { PrivilegeApprovalPanel } from "./PrivilegeApprovalPanel";
import { PrivilegeBalanceCard } from "./PrivilegeBalanceCard";
import { PrivilegeHistory } from "./PrivilegeHistory";
import { PrivilegeRequestForm } from "./PrivilegeRequestForm";
import { PrivilegeStatusBadge } from "./PrivilegeStatusBadge";
import { EmployeePicker } from "./EmployeePicker";
import { canReviewWfhRequest, employeeIsWfhLead } from "./wfh-permissions";
import { balanceForEmployee } from "./wfh-utils";
import { useWfhPrivileges } from "./useWfhPrivileges";
import { awardWfhPrivileges, decideWfhRequest, requestWfh, requestWfhCancellation, removeWfhPoints, revokeWfhRewardDates, updateWfhSettings } from "./wfh-service";
import "./wfh-privileges.css";

function dateToday() { return new Date().toISOString().slice(0, 10); }

function RewardList({ title, rewards, employeeName, busy, allocations = [], dateRevocations = [], onRevokeDates }) {
  const pageSize = 8;
  const [page, setPage] = useState(0);
  const [selectedDates, setSelectedDates] = useState({});
  const entries = [
    ...rewards.map((reward) => ({ kind: "reward", created_at: reward.created_at, value: reward })),
    ...dateRevocations.flatMap((event) => (Array.isArray(event.details?.dates) ? event.details.dates : []).map((date, index) => ({
      kind: "date-revocation",
      created_at: event.created_at,
      value: { ...event, date, id: `${event.id}-${index}` },
    }))),
  ].sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleEntries = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="wfh-reward-panel">
    <header><h3>{title}</h3><span>{entries.length}</span></header>
    {onRevokeDates && <p className="wfh-revoke-note">Revoking an approved date releases it and returns its eligible WFH point.</p>}
    <div className="wfh-reward-scroll">
      {entries.length === 0 ? <p className="wfh-reward-empty">Nothing to show yet.</p> : visibleEntries.map((entry) => {
        if (entry.kind === "date-revocation") {
          const event = entry.value;
          return <article key={event.id} className="wfh-revoked-date-entry">
            <div className="wfh-reward-person"><strong>{employeeName(event.employee_id)}</strong><small>Approved date {event.date} · revoked {new Date(event.created_at).toLocaleDateString()}</small></div>
            <span className="wfh-reward-remain">{event.details?.credit_returned ? "Point returned" : "Point not returned"}</span>
            <PrivilegeStatusBadge status="revoked" />
          </article>;
        }
        const reward = entry.value;
        const expired = reward.expires_on < dateToday();
        return <article key={reward.id}>
          <div className="wfh-reward-person"><strong>{employeeName(reward.employee_id)}</strong><small>{reward.days_available}/{reward.days_awarded} days · expires {reward.expires_on}{reward.note ? " · " + reward.note : ""}</small>
            {!!allocations.filter((allocation) => allocation.reward_id === reward.id).length && <div className="wfh-approved-date-list">{allocations.filter((allocation) => allocation.reward_id === reward.id).map((allocation) => <label key={allocation.id} className={allocation.status === "active" ? "is-approved" : "is-revoked"}>{onRevokeDates && allocation.status === "active" && !expired && <input type="checkbox" checked={(selectedDates[reward.id] ?? []).includes(allocation.privilege_date)} onChange={(event) => setSelectedDates((current) => ({ ...current, [reward.id]: event.target.checked ? [...(current[reward.id] ?? []), allocation.privilege_date] : (current[reward.id] ?? []).filter((date) => date !== allocation.privilege_date) }))} />}<span>{allocation.privilege_date}<small>approved {new Date(allocation.created_at).toLocaleDateString()}</small></span></label>)}</div>}
          </div>
          <span className="wfh-reward-remain">{reward.days_available} left</span>
          {!reward.revoked_at && !expired && onRevokeDates && (selectedDates[reward.id]?.length ?? 0) > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const dates = selectedDates[reward.id]; if (!window.confirm(`Revoke ${dates.length} approved WFH date${dates.length === 1 ? "" : "s"} for ${employeeName(reward.employee_id)} and return eligible point${dates.length === 1 ? "" : "s"}?`)) return; const saved = await onRevokeDates(reward.id, dates); if (saved) setSelectedDates((current) => ({ ...current, [reward.id]: [] })); }}>Revoke {selectedDates[reward.id].length} date{selectedDates[reward.id].length === 1 ? "" : "s"}</Button>}
          {(reward.revoked_at || expired) && <PrivilegeStatusBadge status={reward.revoked_at ? "revoked" : "expired"} />}
        </article>;
      })}
    </div>
    {pageCount > 1 && <nav className="wfh-pagination" aria-label={`${title} pages`}><span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, entries.length)} of {entries.length}</span><div><Button variant="outline" size="sm" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button><Button variant="outline" size="sm" aria-label="Next page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div></nav>}
  </section>;
}

function EmployeeBalances({ members, rewards, busy, onRemovePoints }) {
  const [pointsByEmployee, setPointsByEmployee] = useState({});
  const today = dateToday();
  const rows = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const totalDays = rows.reduce((total, member) => total + balanceForEmployee(rewards, member.id, new Date(`${today}T12:00:00`)), 0);
  return <section className="wfh-agent-balances">
    <header><div><h3><Gift size={15} /> Agent WFH balances</h3><p>Remove a chosen point count from one agent’s balance.</p></div><span>{totalDays} days</span></header>
    <div className="wfh-agent-balance-list">
      {rows.map((member) => {
        const days = balanceForEmployee(rewards, member.id, new Date(`${today}T12:00:00`));
        const points = Number(pointsByEmployee[member.id] ?? 1);
        const pointLimit = Math.min(days, 10000);
        const selectedPoints = days ? Math.min(pointLimit, points) : 0;
        return <div className="wfh-agent-balance-row" key={member.id}><span><strong>{member.name}</strong><small>{member.role || "Team member"}</small></span><b>{days}<small>{days === 1 ? "day" : "days"}</small></b><div className="wfh-agent-point-controls"><input aria-label={`Points to remove from ${member.name}`} type="number" min="1" max={pointLimit} step="1" value={selectedPoints} disabled={!days || busy} onChange={(event) => setPointsByEmployee((current) => ({ ...current, [member.id]: Math.min(pointLimit, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) }))} /><Button size="sm" variant="outline" disabled={!days || busy} onClick={async () => { if (!window.confirm(`Remove ${selectedPoints} WFH point${selectedPoints === 1 ? "" : "s"} from ${member.name}? This cannot be undone.`)) return; const saved = await onRemovePoints(member.id, selectedPoints); if (saved) setPointsByEmployee((current) => ({ ...current, [member.id]: 1 })); }}>{busy ? "Saving…" : "Remove"}</Button></div></div>;
      })}
      {!rows.length && <p className="wfh-reward-empty">No employees are available.</p>}
    </div>
  </section>;
}

function AdminControls({ members, settings, rewards, allocations, audit, onRefresh }) {
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState(1);
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [expirationDays, setExpirationDays] = useState(settings?.expiration_days ?? 365);
  const [noticeDays, setNoticeDays] = useState(settings?.cancellation_notice_days ?? 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rewardFilter, setRewardFilter] = useState("active");
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);
  useEffect(() => {
    if (settings) { setExpirationDays(settings.expiration_days); setNoticeDays(settings.cancellation_notice_days); }
  }, [settings?.expiration_days, settings?.cancellation_notice_days]);

  async function run(action) { setBusy(true); setError(""); setMessage(""); try { await action(); await onRefresh(); return true; } catch (cause) { setError(cause.message || "The change could not be saved."); return false; } finally { setBusy(false); } }
  const activeRewards = rewards.filter((reward) => !reward.revoked_at && reward.expires_on >= dateToday());
  const expiredRewards = rewards.filter((reward) => !reward.revoked_at && reward.expires_on < dateToday());
  const revokedRewards = rewards.filter((reward) => Boolean(reward.revoked_at));

  return <section className="wfh-admin-workspace">
    <header className="wfh-admin-heading"><div><h2>Manage WFH privileges</h2><p>Awards, policy, and remaining balances.</p></div><Shield size={18} /></header>
    <div className="wfh-admin-bento">
      <div className="wfh-admin-primary">
        <form className="wfh-admin-tile wfh-award-form" onSubmit={(event) => {
          event.preventDefault();
          if (!selected.length) { setError("Select one or more employees."); return; }
          void run(async () => {
            const count = await awardWfhPrivileges(selected, days, expiresOn, note);
            setMessage("Awarded " + days + " WFH day(s) to " + count + " employee(s).");
            setSelected([]);
            setNote("");
          });
        }}>
          <h3><Award size={16} /> Award WFH days</h3>
          <EmployeePicker members={members} value={selected} onChange={setSelected} />
          <div className="wfh-form-grid">
            <label>Days<input type="number" min="1" max="365" required value={days} onChange={(event) => setDays(event.target.value)} /></label>
            <label>Expires on (optional)<input type="date" min={dateToday()} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
          </div>
          <label>Reason or note<textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional award note" /></label>
          <Button disabled={busy || members.length === 0}><Award size={15} /> Award WFH days</Button>
        </form>
        {(message || error) && <p className={error ? "auth-error" : "wfh-success"} role={error ? "alert" : "status"}>{error || message}</p>}
      </div>
      <div className="wfh-admin-side">
        <form className="wfh-admin-tile wfh-policy-form" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => { await updateWfhSettings(expirationDays, noticeDays); setMessage("Company WFH policy saved."); });
        }}>
          <h3><Settings2 size={16} /> Company policy</h3>
          <p>Set reward expiry and the minimum cancellation notice.</p>
          <div className="wfh-form-grid">
            <label>Reward lifetime (days)<input type="number" min="1" max="3650" value={expirationDays} onChange={(event) => setExpirationDays(event.target.value)} /></label>
            <label>Cancellation notice (days)<input type="number" min="0" max="90" value={noticeDays} onChange={(event) => setNoticeDays(event.target.value)} /></label>
          </div>
          <Button variant="outline" disabled={busy}>Save policy</Button>
        </form>
        <EmployeeBalances members={members} rewards={rewards} busy={busy} onRemovePoints={(id, points) => run(() => removeWfhPoints(id, points, "Removed by administrator"))} />
      </div>
    </div>
    <div className="wfh-admin-reward-filters" role="group" aria-label="Filter WFH rewards">{[["active", "Active rewards"], ["expired", "Expired rewards"]].map(([value, label]) => <button type="button" key={value} className={rewardFilter === value ? "active" : ""} onClick={() => setRewardFilter(value)}>{label} · {value === "active" ? activeRewards.length : expiredRewards.length}</button>)}</div>
    <div className="wfh-admin-reward-grid">
      <RewardList title={rewardFilter === "active" ? "Active rewards" : "Expired rewards"} rewards={rewardFilter === "active" ? activeRewards : expiredRewards} employeeName={(id) => byId.get(id) ?? "Employee"} busy={busy} allocations={allocations} onRevokeDates={(id, dates) => run(() => revokeWfhRewardDates(id, dates, "Revoked by administrator"))} />
      <RewardList title="Revoked rewards" rewards={revokedRewards} dateRevocations={audit.filter((event) => event.action === "revoked" && Array.isArray(event.details?.dates))} employeeName={(id) => byId.get(id) ?? "Employee"} allocations={allocations} />
    </div>
  </section>;
}
export default function WfhPrivilegesPage() {
  const { account, isAdmin } = useAuth();
  const { members } = useOrganizationRoster();
  const roster = useMemo(() => members ?? [], [members]);
  const { rewards, requests, allocations, audit, settings, holidays, loading, error, refresh } = useWfhPrivileges();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const employeeId = account?.employee_id;
  const employeeName = useMemo(() => (id) => roster.find((member) => member.id === id)?.name ?? id, [roster]);
  const ownRequests = requests.filter((item) => item.employee_id === employeeId);
  const ownAllocations = allocations.filter((item) => item.employee_id === employeeId);
  const ownRewards = rewards.filter((item) => item.employee_id === employeeId);
  const ownAudit = audit.filter((item) => item.employee_id === employeeId);
  const myAudit = isAdmin ? audit : audit.filter((item) => item.employee_id === employeeId);
  const currentEmployee = roster.find((member) => member.id === employeeId);
  const isLead = employeeIsWfhLead(currentEmployee);
  const isSuperAdmin = account?.role === "super_admin";
  const canReview = isLead || isSuperAdmin;
  const reviewableRequests = requests.filter((item) => canReviewWfhRequest(item, { employeeId, isLead, isSuperAdmin }));
  const today = dateToday();
  const availableDays = employeeId ? balanceForEmployee(rewards, employeeId, new Date(`${today}T12:00:00`)) : 0;

  async function sendRequest(mode, dates, note) {
    setBusy(true); setActionError("");
    try { if (mode === "use") await requestWfh(dates, note); else await requestWfhCancellation(dates, note); await refresh(true); }
    catch (cause) { setActionError(cause.message || "Request could not be sent."); throw cause; }
    finally { setBusy(false); }
  }
  async function review(item, decision, dates, note) { setBusy(true); setActionError(""); try { await decideWfhRequest(item.id, decision, dates, note); await refresh(true); } catch (cause) { setActionError(cause.message || "Request could not be reviewed."); throw cause; } finally { setBusy(false); } }

  return <section className="page-content wfh-page"><header className="page-heading wfh-page-heading"><div><p className="eyebrow">TEAM BENEFITS</p><h1>WFH privileges</h1><p className="page-description">Awarded remote-work days, requests, and approvals in one place.</p></div><Link to="/holidays" className="wfh-holiday-link"><CalendarDays size={16} /> Holiday calendar</Link></header>
    {(error || actionError) && <p className="auth-error" role="alert">{actionError || error}</p>}{loading && <p className="wfh-load-note"><Clock3 size={15} /> Loading WFH recordsâ€¦</p>}
    {!employeeId && !isAdmin && <div className="wfh-empty-card"><UsersRound size={22} /><strong>Your account is not linked to an employee record.</strong><span>Ask an administrator to link your RUNBOOK account before requesting WFH days.</span></div>}
    {employeeId && <div className="wfh-overview-grid"><PrivilegeBalanceCard rewards={rewards} employeeId={employeeId} today={today} /><section className="wfh-overview-note"><span className="wfh-overview-icon"><Shield size={18} /></span><div><strong>Fair and traceable allocation</strong><p>Approved dates consume the earliest-expiring eligible rewards. Cancellations require lead approval; refunds cannot outlive the original reward.</p></div></section></div>}
    {employeeId && <div className="wfh-user-rewards"><RewardList title="My rewards" rewards={ownRewards.filter((reward) => !reward.revoked_at)} employeeName={() => "My reward"} allocations={ownAllocations} /><RewardList title="Revoked rewards" rewards={ownRewards.filter((reward) => Boolean(reward.revoked_at))} dateRevocations={ownAudit.filter((event) => event.action === "revoked" && Array.isArray(event.details?.dates))} employeeName={() => "My reward"} allocations={ownAllocations} /></div>}
    {employeeId && !canReview && !isAdmin && <div className="wfh-request-history-grid"><PrivilegeRequestForm holidays={holidays} allocations={ownAllocations} requests={ownRequests} availableDays={availableDays} onSubmit={sendRequest} busy={busy} /><PrivilegeHistory requests={ownRequests} audit={myAudit} employeeName={employeeName} /></div>}
    {(employeeId && (canReview || isAdmin) || canReview) && <div className={`wfh-main-grid${!employeeId || !canReview ? " wfh-main-grid-single" : ""}`}>{employeeId && <PrivilegeRequestForm holidays={holidays} allocations={ownAllocations} requests={ownRequests} availableDays={availableDays} onSubmit={sendRequest} busy={busy} />}{canReview && <PrivilegeApprovalPanel requests={reviewableRequests} employeeName={employeeName} onDecide={review} />}</div>}
    {isAdmin && <AdminControls members={roster} settings={settings} rewards={rewards} allocations={allocations} audit={audit} onRefresh={() => refresh(true)} />}
    {(employeeId || isAdmin) && !(employeeId && !canReview && !isAdmin) && <PrivilegeHistory requests={isAdmin ? requests : ownRequests} audit={myAudit} employeeName={employeeName} isAdmin={isAdmin} />}
    {!employeeId && isAdmin && <div className="wfh-empty-card"><UsersRound size={22} /><strong>Administrator actions are available.</strong><span>Link your own account to an employee record to request personal WFH days.</span></div>}
  </section>;
}

