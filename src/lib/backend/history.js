import { isSupabaseConfigured } from "@/lib/supabase";
import { assertBackendConfigured, throwIfError } from "./shared.js";

const RESTORABLE_TYPES = new Set([
  "seat_plans", "vl_months", "projects", "call_schedule_months", "work_schedule_document",
  "kpi_months", "current_kpi_scoring", "dashboard_publication", "employees", "employee_profiles", "app_links",
  "qa_criteria", "agent_profile_field_definitions",
]);

export const isHistoryEventRestorable = (event) => RESTORABLE_TYPES.has(event?.entity_type);

export async function loadHistoryEvents(canEdit, page = 0, pageSize = 25) {
  if (!isSupabaseConfigured) return { events: [], total: 0 };
  const client = assertBackendConfigured();
  const from = page * pageSize;
  const eventsResult = await client.from("history_events")
      .select("id, actor_label, module, entity_type, entity_id, action, summary, recoverable, created_at, expires_at, restored_at", { count: "exact" })
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
  throwIfError(eventsResult.error);
  const pageEvents = eventsResult.data ?? [];
  const recoveryResult = canEdit && pageEvents.length
    ? await client.from("history_recovery").select("event_id,expires_at").gt("expires_at", new Date().toISOString()).in("event_id", pageEvents.map((event) => event.id))
    : { data: [], error: null };
  throwIfError(recoveryResult.error);
  const recoveryIds = new Set((recoveryResult.data ?? []).map((row) => row.event_id));
  return { events: pageEvents.map((event) => ({ ...event, hasRecovery: recoveryIds.has(event.id) })), total: eventsResult.count ?? 0 };
}

export async function restoreHistoryEvent(eventId) {
  const { error } = await assertBackendConfigured().rpc("restore_history_event", { p_event_id: eventId });
  throwIfError(error);
}

export async function deleteHistoryEvent(eventId) {
  const { error } = await assertBackendConfigured().rpc("delete_history_event", { p_event_id: eventId });
  throwIfError(error);
}

export async function resetHistory() {
  const { data, error } = await assertBackendConfigured().rpc("reset_runbook_history");
  throwIfError(error);
  return Number(data) || 0;
}
