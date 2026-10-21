import { requireSupabase } from "@/lib/supabase";

export async function loadWfhPrivileges() {
  const client = requireSupabase();
  const [rewards, requests, allocations, audit, settings] = await Promise.all([
    client.from("wfh_privilege_rewards").select("*").order("expires_on").order("created_at", { ascending: false }),
    client.from("wfh_privilege_requests").select("*").order("created_at", { ascending: false }),
    client.from("wfh_privilege_allocations").select("*").order("privilege_date"),
    client.from("wfh_privilege_audit").select("*").order("created_at", { ascending: false }).limit(100),
    client.from("wfh_privilege_settings").select("*").eq("singleton", true).single(),
  ]);
  for (const result of [rewards, requests, allocations, audit, settings]) if (result.error) throw result.error;
  const year = new Date().getUTCFullYear();
  const { data: holidays, error: holidayError } = await client.from("holiday_calendar").select("holiday_date,is_working")
    .gte("holiday_date", `${year}-01-01`).lt("holiday_date", `${year + 2}-01-01`).eq("is_active", true).is("deleted_at", null);
  if (holidayError) throw holidayError;
  return { rewards: rewards.data ?? [], requests: requests.data ?? [], allocations: allocations.data ?? [], audit: audit.data ?? [], settings: settings.data, holidays: holidays ?? [] };
}

export async function awardWfhPrivileges(employeeIds, days, expiresOn, note) {
  const { data, error } = await requireSupabase().rpc("award_wfh_privileges", {
    p_employee_ids: employeeIds, p_days: Number(days), p_expires_on: expiresOn || null, p_note: note,
  });
  if (error) throw error;
  return data;
}
export async function revokeWfhReward(rewardId, reason) {
  const { error } = await requireSupabase().rpc("revoke_wfh_reward", { p_reward_id: rewardId, p_reason: reason });
  if (error) throw error;
}
export async function updateWfhSettings(expirationDays, cancellationNoticeDays) {
  const { error } = await requireSupabase().rpc("update_wfh_privilege_settings", {
    p_expiration_days: Number(expirationDays), p_cancellation_notice_days: Number(cancellationNoticeDays),
  });
  if (error) throw error;
}
export async function requestWfh(dates, note) {
  const { error } = await requireSupabase().rpc("request_wfh_privilege", { p_dates: dates, p_note: note });
  if (error) throw error;
}
export async function requestWfhCancellation(dates, note) {
  const { error } = await requireSupabase().rpc("request_wfh_cancellation", { p_dates: dates, p_note: note });
  if (error) throw error;
}
export async function decideWfhRequest(requestId, decision, dates, note) {
  const { error } = await requireSupabase().rpc("decide_wfh_privilege_request", {
    p_request_id: requestId, p_decision: decision, p_final_dates: dates, p_note: note,
  });
  if (error) throw error;
}
export async function notifyWfhExpirations() {
  const { error } = await requireSupabase().rpc("ensure_wfh_expiry_notifications");
  if (error) throw error;
}
