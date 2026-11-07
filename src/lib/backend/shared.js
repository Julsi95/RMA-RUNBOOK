import { isSupabaseConfigured, requireSupabase } from "@/lib/supabase";
import { invalidateCachedQueries } from "@/lib/backend/query-cache";

let realtimeSequence = 0;
const syncListeners = new Set();
const channelStates = new Map();
let refreshing = false;
let refreshTimer;
let networkWatcherAttached = false;
const privateSignedUrlCache = new Map();
const privateSignedUrlRequests = new Map();
const PRIVATE_SIGNED_URL_RENEWAL_BUFFER_MS = 5 * 60 * 1000;
const PRIVATE_SIGNED_URL_CACHE_LIMIT = 1000;
let privateSignedUrlGeneration = 0;

const TABLE_QUERY_PREFIXES = {
  workspace_branding: [["workspace-branding"]],
  dashboard_publication: [["dashboard-publication"]],
  employees: [["organization-roster"]],
  employee_profiles: [["organization-roster"]],
  agent_profile_field_definitions: [["organization-roster"]],
  seat_plans: [["seat-plans"]],
  seat_positions: [["seat-plans"]],
  seat_assignments: [["seat-plans"]],
  projects: [["project-coverage"]],
  project_trainers: [["project-coverage"]],
  project_assignments: [["project-coverage"]],
  call_schedule_months: [["call-schedules"]],
  call_assignments: [["call-schedules"]],
  work_schedule_months: [["work-schedule"]],
  work_schedule_month_assignments: [["work-schedule"]],
  work_schedule_periods: [["work-schedule"]],
  work_schedule_period_assignments: [["work-schedule"]],
  work_schedule_revisions: [["work-schedule"]],
  vl_months: [["vl-credits"]],
  vl_credit_entries: [["vl-credits"]],
  app_links: [["app-links"]],
  qa_criteria: [["qa-criteria"]],
  kpi_months: [["kpi-months"]],
  kpi_results: [["kpi-months"]],
  current_kpi_scoring: [["kpi-scoring"]],
  kpi_scoring_versions: [["kpi-scoring"]],
  history_events: [["history"]],
  history_recovery: [["history"]],
  user_notifications: [["notifications"]],
  app_accounts: [["app-accounts"], ["account"]],
  runbook_session_settings: [["runbook-session-settings"]],
  holiday_calendar: [["holiday-calendar"]],
  wfh_privilege_rewards: [["wfh-privileges"]],
  wfh_privilege_requests: [["wfh-privileges"]],
  wfh_privilege_allocations: [["wfh-privileges"]],
  wfh_privilege_audit: [["wfh-privileges"]],
  wfh_privilege_settings: [["wfh-privileges"]],
};

function invalidateRealtimeQueryFamilies(table, filter) {
  const prefixes = [...(TABLE_QUERY_PREFIXES[table] ?? [])];
  if (table === "realtime_sync_signals") {
    const source = filter?.match(/^source_table=eq\.(.+)$/)?.[1];
    prefixes.push(...(TABLE_QUERY_PREFIXES[source] ?? []));
    if (source === "employee_profiles") prefixes.push(["notifications"]);
  }
  if (table === "employee_profiles") prefixes.push(["notifications"]);
  prefixes.forEach((prefix) => { void invalidateCachedQueries(prefix); });
}

function emitSyncState() {
  const states = [...channelStates.values()];
  const connectedChannels = states.filter((status) => status === "connected").length;
  const reconnecting = states.some((status) => status === "reconnecting");
  const state = {
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    refreshing,
    channelCount: states.length,
    connectedChannels,
    reconnecting,
  };
  syncListeners.forEach((listener) => listener(state));
}

export function subscribeToSyncState(listener) {
  if (!networkWatcherAttached && typeof window !== "undefined") {
    const updateNetworkState = (online) => {
      channelStates.forEach((_, id) => channelStates.set(id, online ? "connecting" : "reconnecting"));
      emitSyncState();
    };
    window.addEventListener("offline", () => updateNetworkState(false));
    window.addEventListener("online", () => updateNetworkState(true));
    networkWatcherAttached = true;
  }
  syncListeners.add(listener);
  emitSyncState();
  return () => syncListeners.delete(listener);
}

export function markDataRefreshing() {
  refreshing = true;
  window.clearTimeout(refreshTimer);
  emitSyncState();
  refreshTimer = window.setTimeout(() => {
    refreshing = false;
    emitSyncState();
  }, 1400);
}

export async function retryDataLoad(load, { attempts = 3, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await load(); }
    catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || (typeof navigator !== "undefined" && !navigator.onLine)) break;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs * (2 ** attempt)));
    }
  }
  throw lastError;
}

export function assertBackendConfigured() {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured.");
  return requireSupabase();
}

export function throwIfError(error) {
  if (error) throw error;
}

export function throwIfErrors(results) {
  for (const result of results) {
    throwIfError(result?.error);
  }
}

export function clearPrivateSignedUrlCache() {
  privateSignedUrlGeneration += 1;
  privateSignedUrlCache.clear();
  privateSignedUrlRequests.clear();
}

async function signPrivatePaths(paths, expiresIn, generation) {
  const client = assertBackendConfigured();
  const { data, error } = await client.storage.from("runbook-private").createSignedUrls(paths, expiresIn);
  throwIfError(error);
  const signedAt = Date.now();
  const result = new Map();
  for (const item of data ?? []) {
    if (!item.path || !item.signedUrl || item.error) continue;
    result.set(item.path, item.signedUrl);
    if (generation === privateSignedUrlGeneration) {
      privateSignedUrlCache.set(item.path, { url: item.signedUrl, expiresAt: signedAt + expiresIn * 1000 });
    }
  }
  while (privateSignedUrlCache.size > PRIVATE_SIGNED_URL_CACHE_LIMIT) {
    privateSignedUrlCache.delete(privateSignedUrlCache.keys().next().value);
  }
  return result;
}

export async function createPrivateSignedUrlMap(paths, expiresIn = 3600) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return new Map();

  const now = Date.now();
  for (const [path, cached] of privateSignedUrlCache) {
    if (cached.expiresAt <= now) privateSignedUrlCache.delete(path);
  }
  const renewalBuffer = Math.min(PRIVATE_SIGNED_URL_RENEWAL_BUFFER_MS, Math.max(10_000, expiresIn * 200));
  const pathsToSign = uniquePaths.filter((path) => (privateSignedUrlCache.get(path)?.expiresAt ?? 0) - now <= renewalBuffer);
  const pathsWithoutRequest = pathsToSign.filter((path) => !privateSignedUrlRequests.has(path));

  if (pathsWithoutRequest.length) {
    const generation = privateSignedUrlGeneration;
    const batch = signPrivatePaths(pathsWithoutRequest, expiresIn, generation);
    for (const path of pathsWithoutRequest) {
      const request = batch.then((signed) => signed.get(path) ?? "");
      privateSignedUrlRequests.set(path, request);
      const clearRequest = () => {
        if (privateSignedUrlRequests.get(path) === request) privateSignedUrlRequests.delete(path);
      };
      void request.then(clearRequest, clearRequest);
    }
  }

  await Promise.all(pathsToSign.map((path) => privateSignedUrlRequests.get(path)).filter(Boolean));
  // A stale path or a private photo that is inaccessible in this session is
  // omitted so callers can keep showing their existing fallback.
  return new Map(uniquePaths.flatMap((path) => {
    const cached = privateSignedUrlCache.get(path);
    return cached && cached.expiresAt > Date.now() ? [[path, cached.url]] : [];
  }));
}

export function subscribeToTables(tables, onChange, label = "data") {
  if (!isSupabaseConfigured) return () => {};
  const client = requireSupabase();
  const channelId = `runbook-${label}-${Date.now()}-${realtimeSequence++}`;
  const channel = client.channel(channelId);
  let hasConnected = false;
  let disconnected = false;
  let changeTimer;
  for (const item of tables) {
    const table = typeof item === "string" ? item : item.table;
    const filter = typeof item === "string" ? undefined : item.filter;
    channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
      invalidateRealtimeQueryFamilies(table, filter);
      markDataRefreshing();
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => onChange(payload), 120);
    });
  }
  channelStates.set(channelId, "connecting");
  emitSyncState();
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channelStates.set(channelId, "connected");
      if (hasConnected && disconnected) {
        markDataRefreshing();
        onChange({ type: "RECONNECT" });
      }
      hasConnected = true;
      disconnected = false;
    } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      if (hasConnected) disconnected = true;
      channelStates.set(channelId, "reconnecting");
    }
    emitSyncState();
  });
  return () => {
    window.clearTimeout(changeTimer);
    channelStates.delete(channelId);
    emitSyncState();
    void client.removeChannel(channel);
  };
}
