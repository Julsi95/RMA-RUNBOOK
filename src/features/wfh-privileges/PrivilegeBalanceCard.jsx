import { Clock3, Gift, ShieldCheck } from "lucide-react";

export function PrivilegeBalanceCard({ rewards, employeeId, today }) {
  const activeRewards = rewards.filter((reward) => reward.employee_id === employeeId && !reward.revoked_at && reward.expires_on >= today && reward.days_available > 0);
  const available = activeRewards.reduce((sum, reward) => sum + reward.days_available, 0);
  const nextExpiry = activeRewards.sort((a, b) => a.expires_on.localeCompare(b.expires_on))[0]?.expires_on;
  return <section className="wfh-balance-card"><div className="wfh-balance-icon"><Gift size={19} /></div><div><span>Available WFH days</span><strong>{available}</strong><small>{activeRewards.length} active reward{activeRewards.length === 1 ? "" : "s"}</small></div><div className="wfh-balance-foot">{nextExpiry ? <><Clock3 size={14} /> Earliest reward expires {nextExpiry}</> : <><ShieldCheck size={14} /> No active reward expiring</>}</div></section>;
}
