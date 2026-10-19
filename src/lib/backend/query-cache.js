import { QueryClient } from "@tanstack/react-query";

export const QUERY_STALE_TIME = 30_000;
export const QUERY_GC_TIME = 10 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

export const queryKeys = {
  account: (userId) => ["account", userId],
  roster: (userId, canEdit) => ["organization-roster", userId, canEdit ? "editor" : "viewer"],
  branding: () => ["workspace-branding"],
  dashboard: () => ["dashboard-publication"],
  publicDashboard: () => ["public-dashboard-publication"],
  dashboardDraft: (userId) => ["dashboard-draft", userId],
  seatPlans: (userId, canEdit) => ["seat-plans", userId, canEdit ? "editor" : "viewer"],
  projectCoverage: (userId, canEdit) => ["project-coverage", userId, canEdit ? "editor" : "viewer"],
  callSchedules: (userId, canEdit) => ["call-schedules", userId, canEdit ? "editor" : "viewer"],
  workSchedule: (userId, canEdit) => ["work-schedule", userId, canEdit ? "editor" : "viewer"],
  vlCredits: (userId, canEdit) => ["vl-credits", userId, canEdit ? "editor" : "viewer"],
  appLinks: (userId, canEdit) => ["app-links", userId, canEdit ? "editor" : "viewer"],
  qaCriteria: (userId, canEdit) => ["qa-criteria", userId, canEdit ? "editor" : "viewer"],
  kpiScoring: () => ["kpi-scoring"],
  kpiMonths: (userId, canEdit) => ["kpi-months", userId, canEdit ? "editor" : "viewer"],
  history: (userId, canEdit) => ["history", userId, canEdit ? "editor" : "viewer"],
  notifications: (userId) => ["notifications", userId],
  runbookSessionSettings: (userId) => ["runbook-session-settings", userId],
  accounts: (userId) => ["app-accounts", userId],
};

export function readCachedQuery(queryKey) {
  return queryClient.getQueryData(queryKey);
}

export function fetchCachedQuery(queryKey, queryFn, { staleTime = QUERY_STALE_TIME, force = false } = {}) {
  if (force) {
    return queryClient.fetchQuery({ queryKey, queryFn, staleTime: 0, retry: false });
  }
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime, retry: false });
}

export function invalidateCachedQuery(queryKey) {
  return queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
}

export function invalidateCachedQueries(prefix) {
  return queryClient.invalidateQueries({ queryKey: prefix, refetchType: "none" });
}

export function clearMemoryQueryCache() {
  queryClient.clear();
}
