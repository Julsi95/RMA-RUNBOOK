import test from "node:test";
import assert from "node:assert/strict";
import { clearRequestMetrics, createMonitoredFetch, subscribeToRequestMetrics } from "./request-monitor.js";

test("counts Supabase HTTP requests without retaining query strings", async () => {
  clearRequestMetrics();
  const observed = [];
  const unsubscribe = subscribeToRequestMetrics((state) => observed.push(state));
  const fetch = createMonitoredFetch("https://project.supabase.co", async () => new Response("[]", { status: 200 }));
  await fetch("https://project.supabase.co/rest/v1/holiday_calendar?secret_filter=private");
  unsubscribe();

  const latest = observed.at(-1);
  assert.equal(latest.total, 1);
  assert.equal(latest.failed, 0);
  assert.equal(latest.byCategory["Database API"], 1);
  assert.equal(latest.requests[0].endpoint, "/rest/v1/holiday_calendar");
  assert.equal(JSON.stringify(latest).includes("private"), false);
});

test("counts HTTP error responses and network failures", async () => {
  clearRequestMetrics();
  let latest;
  const unsubscribe = subscribeToRequestMetrics((state) => { latest = state; });
  const httpFailure = createMonitoredFetch("https://project.supabase.co", async () => new Response("", { status: 503 }));
  const networkFailure = createMonitoredFetch("https://project.supabase.co", async () => { throw new TypeError("network unavailable"); });

  await httpFailure("https://project.supabase.co/rest/v1/employees");
  await assert.rejects(networkFailure("https://project.supabase.co/auth/v1/user"), /network unavailable/);
  unsubscribe();

  assert.equal(latest.total, 2);
  assert.equal(latest.failed, 2);
  assert.equal(latest.requests[0].status, "Network error");
  assert.equal(latest.requests[1].status, 503);
});

test("ignores requests to hosts other than the configured Supabase project", async () => {
  clearRequestMetrics();
  let latest;
  const unsubscribe = subscribeToRequestMetrics((state) => { latest = state; });
  let calls = 0;
  const fetch = createMonitoredFetch("https://project.supabase.co", async () => { calls += 1; return new Response("ok"); });
  await fetch("https://api.example.com/holidays");
  unsubscribe();

  assert.equal(calls, 1);
  assert.equal(latest.total, 0);
});
