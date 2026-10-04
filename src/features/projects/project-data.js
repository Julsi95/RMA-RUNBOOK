export const PROJECT_COVERAGE_STORAGE_KEY = "starter-app-project-coverage-v1";

export const PROJECT_STATUSES = [
  { id: "trained", label: "Trained" },
  { id: "refresher", label: "Refresher" },
  { id: "to-train", label: "To be trained" },
];

const referenceProjects = [
  "Homeless Callback Queue",
  "I.Tagger",
  "DOA Cases",
  "DOA Hostage",
  "Hostage Unit",
  "Franchisee Sync",
  "McDonald's (MCU)",
  "MRA Escalations",
  "OOS Process",
  "OOS Update (Emails and PPR)",
  "Premier Portal",
  "RMA Daily",
  "ERS Queue",
  "Retrieval DOA (Report-Call)",
  "RMA Callback",
  "MRA Repair Status (Inbound Call)",
  "Special Project",
  "Deactivation",
];

export const starterProjects = referenceProjects.map((name, index) => ({
  id: `project-${index + 1}`,
  name,
  description: "",
  isActive: name !== "Franchisee Sync",
  pocId: "",
  trainerIds: [],
  assignments: {},
}));

export function createProjectId() {
  return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getSavedProjects() {
  try {
    const saved = localStorage.getItem(PROJECT_COVERAGE_STORAGE_KEY);
    if (!saved) return starterProjects;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return starterProjects;
    return parsed.map((project) => ({
      id: project.id ?? createProjectId(),
      name: String(project.name ?? "Untitled project"),
      description: String(project.description ?? ""),
      isActive: project.isActive !== false,
      pocId: project.pocId ?? "",
      trainerIds: Array.isArray(project.trainerIds) ? project.trainerIds : [],
      assignments: project.assignments && typeof project.assignments === "object" ? project.assignments : {},
    }));
  } catch {
    return starterProjects;
  }
}
