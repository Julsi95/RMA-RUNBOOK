import { assertBackendConfigured, throwIfError, throwIfErrors } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadSeatPlans() {
  assertBackendConfigured();
  const [plansResult, positionsResult, assignmentsResult] = await Promise.all([
    supabase.from("seat_plans").select("plan_date,note"),
    supabase.from("seat_positions").select("plan_date,seat_id,seat_type,sort_order").order("sort_order"),
    supabase.from("seat_assignments").select("plan_date,seat_id,employee_id"),
  ]);
  throwIfErrors([plansResult, positionsResult, assignmentsResult]);
  const plans = Object.fromEntries((plansResult.data ?? []).map((row) => [row.plan_date, { note: row.note ?? "", seatIds: [], leadershipSeatIds: [], assignments: {} }]));
  for (const row of positionsResult.data ?? []) {
    const plan = plans[row.plan_date];
    if (!plan) continue;
    (row.seat_type === "leadership" ? plan.leadershipSeatIds : plan.seatIds).push(row.seat_id);
  }
  for (const row of assignmentsResult.data ?? []) {
    if (plans[row.plan_date]) plans[row.plan_date].assignments[row.seat_id] = row.employee_id;
  }
  return plans;
}

export async function saveSeatPlan(date, plan) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_seat_plan", {
    p_plan_date: date,
    p_plan: {
      note: plan.note ?? "",
      seatIds: plan.seatIds ?? [],
      leadershipSeatIds: plan.leadershipSeatIds ?? [],
      assignments: plan.assignments ?? {},
    },
  });
  throwIfError(error);
}
