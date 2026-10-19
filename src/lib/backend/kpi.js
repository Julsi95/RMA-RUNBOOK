import { assertBackendConfigured, throwIfError, throwIfErrors } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadCurrentKpiScoring() {
  assertBackendConfigured();
  const { data, error } = await supabase.from("current_kpi_scoring").select("version_id,kpi_scoring_versions(settings,label,version_number)").eq("singleton", true).maybeSingle();
  throwIfError(error);
  if (!data?.version_id || !data.kpi_scoring_versions?.settings) return null;
  return { id: data.version_id, settings: data.kpi_scoring_versions.settings, label: data.kpi_scoring_versions.label, versionNumber: data.kpi_scoring_versions.version_number };
}

export async function saveCurrentKpiScoring(settings, label = "Scoring settings") {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("save_kpi_scoring_version", { p_label: label, p_settings: settings });
  throwIfError(error);
  return data;
}

export async function loadKpiMonthData() {
  assertBackendConfigured();
  const [monthsResult, resultsResult] = await Promise.all([
    supabase.from("kpi_months").select("month_key,scoring_version_id,status").order("month_key"),
    supabase.from("kpi_results").select("month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,is_deleted").order("result_revision"),
  ]);
  throwIfErrors([monthsResult, resultsResult]);
  const versionIds = [...new Set((monthsResult.data ?? []).map((month) => month.scoring_version_id).filter(Boolean))];
  const versionsResult = versionIds.length
    ? await supabase.from("kpi_scoring_versions").select("id,settings").in("id", versionIds)
    : { data: [], error: null };
  throwIfError(versionsResult.error);
  const versions = new Map((versionsResult.data ?? []).map((version) => [version.id, version.settings]));
  const months = Object.fromEntries((monthsResult.data ?? []).map((month) => [month.month_key, {
    demo: false, scoringVersionId: month.scoring_version_id, scoringSettings: versions.get(month.scoring_version_id) ?? null, records: {},
  }]));
  for (const row of resultsResult.data ?? []) {
    if (!months[row.month_key]) months[row.month_key] = { demo: false, scoringVersionId: null, scoringSettings: null, records: {} };
    if (row.is_deleted) {
      delete months[row.month_key].records[row.employee_id];
      continue;
    }
    months[row.month_key].records[row.employee_id] = {
      memberId: row.employee_id, memberName: row.employee_name_snapshot, role: row.employee_role_snapshot,
      metrics: row.metrics ?? {}, overallScore: row.overall_score == null ? null : Number(row.overall_score), evaluation: row.evaluation,
      resultRevision: row.result_revision, scoringVersionId: months[row.month_key].scoringVersionId,
      scoringSettings: months[row.month_key].scoringSettings,
    };
  }
  return months;
}

export async function loadPublicDashboardKpiWidget() {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("get_public_dashboard_kpi_widget");
  throwIfError(error);
  if (!data?.monthKey) return {};
  return {
    [data.monthKey]: {
      demo: false,
      scoringVersionId: null,
      scoringSettings: data.scoringSettings ?? null,
      records: data.records ?? {},
    },
  };
}

export async function createKpiMonth(month) {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("create_kpi_month", { p_month: month });
  throwIfError(error);
  return data;
}

export async function saveKpiMonthResults(month, records) {
  assertBackendConfigured();
  const { data, error } = await supabase.rpc("save_kpi_month_results", {
    p_month: month,
    p_results: records.map((record) => ({
      employee_id: record.memberId, employee_name_snapshot: record.memberName, employee_role_snapshot: record.role ?? "",
      metrics: record.metrics, overall_score: record.overallScore, evaluation: record.evaluation ?? "", source: record.source ?? "manual",
    })),
  });
  throwIfError(error);
  return data;
}
