import { assertBackendConfigured, throwIfError, throwIfErrors } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadCallSchedules() {
  assertBackendConfigured();
  const [monthsResult, assignmentsResult] = await Promise.all([
    supabase.from("call_schedule_months").select("month_start,call_window_start,call_window_end"),
    supabase.from("call_assignments").select("id,month_start,employee_id,call_start,call_end,sort_order").order("sort_order"),
  ]);
  throwIfErrors([monthsResult, assignmentsResult]);
  const schedules = Object.fromEntries((monthsResult.data ?? []).map((row) => [row.month_start.slice(0, 7), {
    callWindow: { start: row.call_window_start.slice(0, 5), end: row.call_window_end.slice(0, 5) }, callAssignments: [],
  }]));
  for (const row of assignmentsResult.data ?? []) {
    const month = row.month_start.slice(0, 7);
    if (!schedules[month]) schedules[month] = { callWindow: { start: "21:00", end: "06:00" }, callAssignments: [] };
    schedules[month].callAssignments.push({ id: row.id, memberId: row.employee_id, start: row.call_start.slice(0, 5), end: row.call_end.slice(0, 5) });
  }
  return schedules;
}

export async function saveCallScheduleMonth(month, schedule) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_call_schedule_month", {
    p_month: `${month}-01`,
    p_window: schedule.callWindow ?? { start: "21:00", end: "06:00" },
    p_assignments: (schedule.callAssignments ?? []).map((item) => ({
      id: item.id, memberId: item.memberId, start: item.start, end: item.end,
    })),
  });
  throwIfError(error);
}

export async function loadWorkScheduleDocument() {
  assertBackendConfigured();
  const [monthsResult, monthAssignmentsResult, periodsResult, periodAssignmentsResult, historyResult] = await Promise.all([
    supabase.from("work_schedule_months").select("month_start,work_preset").order("month_start"),
    supabase.from("work_schedule_month_assignments").select("month_start,id,employee_id,start_time,end_time,sort_order").order("sort_order"),
    supabase.from("work_schedule_periods").select("id,start_date,end_date,work_preset,label,updated_at").order("start_date"),
    supabase.from("work_schedule_period_assignments").select("period_id,id,employee_id,start_time,end_time,sort_order").order("sort_order"),
    supabase.from("work_schedule_revisions").select("schedule_snapshot,created_at").order("created_at", { ascending: false }),
  ]);
  throwIfErrors([monthsResult, monthAssignmentsResult, periodsResult, periodAssignmentsResult, historyResult]);
  const months = Object.fromEntries((monthsResult.data ?? []).map((row) => [row.month_start.slice(0, 7), { workPreset: row.work_preset, workSchedules: [] }]));
  for (const row of monthAssignmentsResult.data ?? []) {
    const month = row.month_start.slice(0, 7);
    if (!months[month]) months[month] = { workPreset: "custom", workSchedules: [] };
    months[month].workSchedules.push({ id: row.id, memberId: row.employee_id, start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) });
  }
  const periods = (periodsResult.data ?? []).map((row) => ({
    id: row.id, startDate: row.start_date, endDate: row.end_date, workPreset: row.work_preset,
    label: row.label ?? "", updatedAt: row.updated_at, workSchedules: [],
  }));
  const periodById = new Map(periods.map((period) => [period.id, period]));
  for (const row of periodAssignmentsResult.data ?? []) periodById.get(row.period_id)?.workSchedules.push({
    id: row.id, memberId: row.employee_id, start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5),
  });
  return { months, periods, history: (historyResult.data ?? []).map((row) => row.schedule_snapshot) };
}

export async function saveWorkScheduleDocument(document) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_work_schedule_document", {
    p_months: Object.entries(document.months ?? {}).map(([month, value]) => ({
      month, workPreset: value.workPreset ?? "custom", workSchedules: value.workSchedules ?? [],
    })),
    p_periods: document.periods ?? [],
    p_history: document.history ?? [],
  });
  throwIfError(error);
}
