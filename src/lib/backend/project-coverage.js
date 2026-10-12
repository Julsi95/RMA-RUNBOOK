import { assertBackendConfigured, throwIfError, throwIfErrors } from "./shared.js";
import { supabase } from "@/lib/supabase";

export async function loadProjectCoverage() {
  assertBackendConfigured();
  const [projectsResult, trainersResult, assignmentsResult] = await Promise.all([
    supabase.from("projects").select("id,name,description,is_active,poc_employee_id,sort_order").is("deleted_at", null).order("sort_order"),
    supabase.from("project_trainers").select("project_id,employee_id"),
    supabase.from("project_assignments").select("project_id,employee_id,status"),
  ]);
  throwIfErrors([projectsResult, trainersResult, assignmentsResult]);
  const projects = (projectsResult.data ?? []).map((row) => ({
    id: row.id, name: row.name, description: row.description ?? "", isActive: row.is_active,
    pocId: row.poc_employee_id ?? "", trainerIds: [], assignments: {},
  }));
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const row of trainersResult.data ?? []) byId.get(row.project_id)?.trainerIds.push(row.employee_id);
  for (const row of assignmentsResult.data ?? []) if (byId.has(row.project_id)) byId.get(row.project_id).assignments[row.employee_id] = row.status;
  return projects;
}

export async function saveProjectCoverage(projects) {
  assertBackendConfigured();
  const { error } = await supabase.rpc("save_project_coverage", {
    p_projects: projects.map((project) => ({
      id: project.id, name: project.name, description: project.description ?? "", isActive: project.isActive !== false,
      pocId: project.pocId || null, trainerIds: project.trainerIds ?? [], assignments: project.assignments ?? {},
    })),
  });
  throwIfError(error);
}
