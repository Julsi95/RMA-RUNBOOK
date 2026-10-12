import { isSupabaseConfigured } from "@/lib/supabase";
import { assertBackendConfigured, throwIfError, throwIfErrors } from "./shared.js";

const RESTORABLE_TYPES = new Set([
  "seat_plans", "vl_months", "projects", "call_schedule_months", "work_schedule_document",
  "kpi_months", "current_kpi_scoring", "dashboard_publication", "employees", "employee_profiles", "app_links",
  "qa_criteria", "agent_profile_field_definitions",
]);

export const isHistoryEventRestorable = (event) => RESTORABLE_TYPES.has(event?.entity_type);

export async function loadHistoryEvents(canEdit) {
  if (!isSupabaseConfigured) return [];
  const client = assertBackendConfigured();
  const [eventsResult, recoveryResult] = await Promise.all([
    client.from("history_events")
      .select("id, actor_label, module, entity_type, entity_id, action, summary, recoverable, created_at, expires_at, restored_at")
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false }),
    canEdit
      ? client.from("history_recovery").select("event_id,expires_at").gt("expires_at", new Date().toISOString())
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfErrors([eventsResult, recoveryResult]);
  const recoveryIds = new Set((recoveryResult.data ?? []).map((row) => row.event_id));
  return (eventsResult.data ?? []).map((event) => ({ ...event, hasRecovery: recoveryIds.has(event.id) }));
}

export async function restoreHistoryEvent(eventId) {
  const { error } = await assertBackendConfigured().rpc("restore_history_event", { p_event_id: eventId });
  throwIfError(error);
}
