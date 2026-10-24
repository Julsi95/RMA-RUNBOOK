const MAX_RECENT_REQUESTS = 500;
const RETENTION_DAYS = 7;
const STORAGE_KEY = "runbook-backend-request-monitor-v1";
const SHARED_REPORT_PATH = "/rest/v1/rpc/record_runbook_backend_request_metrics";
const INTERNAL_METRIC_ENDPOINTS = new Set(["record_runbook_backend_request_metrics", "get_runbook_backend_request_metrics"]);
const listeners = new Set();
let sharedBatch = { total: 0, failed: 0, slowestMs: 0, byPage: {}, byCategory: {} };
let sharedTimer = null;
let sharedFlush = null;
let sharedTransport = null;
let sharedRetryCount = 0;
let sharedRetryDelay = 5000;
let sharedReportingDisabled = false;

function emptySnapshot() {
  return { startedAt: Date.now(), total: 0, failed: 0, lastAt: null, slowestMs: 0, byPage: {}, byCategory: {}, requests: [] };
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRetentionStart(now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (RETENTION_DAYS - 1));
  return start.getTime();
}

function readStoredData() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null");
    return stored && typeof stored === "object" ? stored : { days: {}, requests: [] };
  } catch {
    return { days: {}, requests: [] };
  }
}

function writeStoredData(data) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* Storage may be unavailable or full. */ }
}

function pruneStoredData(data, now = Date.now()) {
  const firstRetainedDay = dayKey(getRetentionStart(now));
  const today = dayKey(now);
  const days = Object.fromEntries(Object.entries(data.days ?? {}).filter(([key]) => key >= firstRetainedDay && key <= today));
  const requests = (Array.isArray(data.requests) ? data.requests : [])
    .filter((request) => Number.isFinite(request.at) && request.at >= getRetentionStart(now) && request.at <= now)
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_RECENT_REQUESTS);
  return { days, requests };
}

function makeSnapshot(data) {
  const snapshot = emptySnapshot();
  snapshot.requests = data.requests;
  for (const day of Object.values(data.days)) {
    snapshot.total += day.total ?? 0;
    snapshot.failed += day.failed ?? 0;
    snapshot.slowestMs = Math.max(snapshot.slowestMs, day.slowestMs ?? 0);
    if (day.lastAt && (!snapshot.lastAt || day.lastAt > snapshot.lastAt)) snapshot.lastAt = day.lastAt;
    for (const [page, count] of Object.entries(day.byPage ?? {})) snapshot.byPage[page] = (snapshot.byPage[page] ?? 0) + count;
    for (const [category, count] of Object.entries(day.byCategory ?? {})) snapshot.byCategory[category] = (snapshot.byCategory[category] ?? 0) + count;
  }
  snapshot.startedAt = getRetentionStart();
  return snapshot;
}

function loadSnapshot({ persistPruned = false } = {}) {
  const data = pruneStoredData(readStoredData());
  if (persistPruned) writeStoredData(data);
  return makeSnapshot(data);
}

let snapshot = loadSnapshot({ persistPruned: true });

function notify() { listeners.forEach((listener) => listener(snapshot)); }

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

function scheduleSharedFlush() {
  if (sharedTimer || sharedFlush || sharedReportingDisabled || !sharedBatch.total) return;
  sharedTimer = globalThis.setTimeout(() => {
    sharedTimer = null;
    void flushSharedMetrics();
  }, sharedRetryDelay);
}

async function flushSharedMetrics(keepalive = false) {
  if (sharedFlush || sharedReportingDisabled || !sharedTransport || !sharedBatch.total) return;
  if (sharedTimer) globalThis.clearTimeout(sharedTimer);
  sharedTimer = null;
  const batch = sharedBatch;
  sharedBatch = { total: 0, failed: 0, slowestMs: 0, byPage: {}, byCategory: {} };
  const body = JSON.stringify({
    p_total: batch.total,
    p_failed: batch.failed,
    p_slowest_ms: batch.slowestMs,
    p_by_page: batch.byPage,
    p_by_category: batch.byCategory,
  });
  sharedFlush = sharedTransport.fetch(`${sharedTransport.origin}${SHARED_REPORT_PATH}`, {
    method: "POST",
    headers: {
      apikey: sharedTransport.apiKey,
      Authorization: sharedTransport.authorization,
      "Content-Type": "application/json",
    },
    body,
    keepalive,
  }).then((response) => {
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      sharedReportingDisabled = true;
      sharedBatch = { total: 0, failed: 0, slowestMs: 0, byPage: {}, byCategory: {} };
      return;
    }
    if (!response.ok) throw new Error("Shared request metrics could not be saved.");
    sharedRetryCount = 0;
    sharedRetryDelay = 5000;
  }).catch(() => {
    sharedBatch.total += batch.total;
    sharedBatch.failed += batch.failed;
    sharedBatch.slowestMs = Math.max(sharedBatch.slowestMs, batch.slowestMs);
    for (const [page, count] of Object.entries(batch.byPage)) sharedBatch.byPage[page] = (sharedBatch.byPage[page] ?? 0) + count;
    for (const [category, count] of Object.entries(batch.byCategory)) sharedBatch.byCategory[category] = (sharedBatch.byCategory[category] ?? 0) + count;
    sharedRetryCount += 1;
    if (sharedRetryCount >= 3) {
      sharedReportingDisabled = true;
      sharedBatch = { total: 0, failed: 0, slowestMs: 0, byPage: {}, byCategory: {} };
    } else {
      sharedRetryDelay = 5000 * (2 ** sharedRetryCount);
    }
  }).finally(() => {
    sharedFlush = null;
    scheduleSharedFlush();
  });
  await sharedFlush;
}

function queueSharedMetric(event, baseFetch, projectOrigin, headers) {
  const apiKey = readHeader(headers, "apikey");
  if (!apiKey) return;
  const authorization = readHeader(headers, "authorization") || `Bearer ${apiKey}`;
  sharedTransport = { fetch: baseFetch, origin: projectOrigin, apiKey, authorization };
  sharedBatch.total += 1;
  sharedBatch.failed += Number(event.failed);
  sharedBatch.slowestMs = Math.max(sharedBatch.slowestMs, event.durationMs);
  sharedBatch.byPage[event.page] = (sharedBatch.byPage[event.page] ?? 0) + 1;
  sharedBatch.byCategory[event.category] = (sharedBatch.byCategory[event.category] ?? 0) + 1;
  if (sharedBatch.total >= 20) void flushSharedMetrics();
  else scheduleSharedFlush();
}

function recordRequest({ method, endpoint, category, page, status, durationMs, failed }) {
  const at = Date.now();
  const data = pruneStoredData(readStoredData(), at);
  const key = dayKey(at);
  const day = data.days[key] ?? { total: 0, failed: 0, slowestMs: 0, lastAt: null, byPage: {}, byCategory: {} };
  const request = { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, method, endpoint, category, page, status, durationMs, at, failed };
  day.total += 1;
  day.failed += Number(failed);
  day.slowestMs = Math.max(day.slowestMs, durationMs);
  day.lastAt = Math.max(day.lastAt ?? 0, at);
  day.byPage[page] = (day.byPage[page] ?? 0) + 1;
  day.byCategory[category] = (day.byCategory[category] ?? 0) + 1;
  data.days[key] = day;
  data.requests = [request, ...data.requests].slice(0, MAX_RECENT_REQUESTS);
  writeStoredData(data);
  snapshot = makeSnapshot(data);
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      snapshot = loadSnapshot();
      notify();
    }
  });
  window.addEventListener("pagehide", () => { void flushSharedMetrics(true); });
}

function classifyEndpoint(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "rest" && parts[1] === "v1") {
    return { category: "Database API", endpoint: parts[2] === "rpc" ? `/rest/v1/rpc/${parts[3] ?? "unknown"}` : `/rest/v1/${parts[2] ?? "root"}` };
  }
  if (parts[0] === "auth" && parts[1] === "v1") return { category: "Authentication", endpoint: `/${parts.slice(0, 3).join("/")}` };
  if (parts[0] === "storage" && parts[1] === "v1") return { category: "Storage API", endpoint: `/${parts.slice(0, 3).join("/")}` };
  if (parts[0] === "functions" && parts[1] === "v1") return { category: "Edge Function", endpoint: `/${parts.slice(0, 3).join("/")}` };
  if (parts[0] === "realtime" && parts[1] === "v1") return { category: "Realtime HTTP", endpoint: "/realtime/v1" };
  return { category: "Supabase API", endpoint: `/${parts.slice(0, 3).join("/")}` };
}

export function createMonitoredFetch(supabaseUrl, baseFetch = globalThis.fetch.bind(globalThis)) {
  let projectOrigin = "";
  try { projectOrigin = new URL(supabaseUrl).origin; } catch { return baseFetch; }

  return async function monitoredFetch(input, init) {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    let parsed;
    try { parsed = new URL(rawUrl, globalThis.location?.origin); } catch { return baseFetch(input, init); }
    if (parsed.origin !== projectOrigin) return baseFetch(input, init);

    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const { endpoint, category } = classifyEndpoint(parsed.pathname);
    const shouldTrack = !INTERNAL_METRIC_ENDPOINTS.has(endpoint.split("/").at(-1));
    const requestHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const page = globalThis.location?.pathname || "(no page)";
    const start = globalThis.performance?.now?.() ?? Date.now();
    try {
      const response = await baseFetch(input, init);
      const durationMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - start);
      if (shouldTrack) {
        const event = { method, endpoint, category, page, status: response.status, durationMs, failed: !response.ok };
        recordRequest(event);
        queueSharedMetric(event, baseFetch, projectOrigin, requestHeaders);
      }
      return response;
    } catch (error) {
      const durationMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - start);
      if (shouldTrack) {
        const event = { method, endpoint, category, page, status: "Network error", durationMs, failed: true };
        recordRequest(event);
        queueSharedMetric(event, baseFetch, projectOrigin, requestHeaders);
      }
      throw error;
    }
  };
}

export function subscribeToRequestMetrics(listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function clearRequestMetrics() {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  snapshot = emptySnapshot();
  notify();
}
