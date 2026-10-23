import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapHolidayProviderEntries } from "./holiday-mapping.js";
import { corsHeaders, isAllowedOrigin } from "../_shared/cors.ts";

function respond(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...Object.fromEntries(corsHeaders(request)), "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (!isAllowedOrigin(request)) return new Response("Origin not allowed.", { status: 403, headers });
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(request, { error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt) return respond(request, { error: "Sign in to sync the holiday calendar." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return respond(request, { error: "Holiday synchronization is not configured on the server." }, 500);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: authData, error: authError } = await caller.auth.getUser(jwt);
  if (authError || !authData.user) return respond(request, { error: "Your session is invalid or expired." }, 401);
  const { data: sessionIsCurrent, error: sessionError } = await caller.rpc("is_current_runbook_session");
  if (sessionError || !sessionIsCurrent) return respond(request, { error: "This session is no longer active. Sign in again." }, 401);

  let body: { country?: unknown; year?: unknown; force?: unknown };
  try { body = await request.json(); } catch { return respond(request, { error: "Send a valid JSON request." }, 400); }
  const country = typeof body.country === "string" ? body.country.toUpperCase() : "";
  const year = Number(body.year);
  const thisYear = new Date().getUTCFullYear();
  if (!["US", "PH"].includes(country) || !Number.isInteger(year) || year < thisYear - 2 || year > thisYear + 3) {
    return respond(request, { error: "Choose US or PH and a year within the supported range." }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const force = body.force === true;
  const { data: account, error: accountError } = await admin.from("app_accounts").select("role").eq("user_id", authData.user.id).maybeSingle();
  if (accountError || !["admin", "super_admin"].includes(account?.role ?? "")) return respond(request, { error: "Administrator access is required to sync holidays." }, 403);

  const { data: syncState, error: stateError } = await admin.from("holiday_sync_state")
    .select("synced_at,item_count").eq("country_code", country).eq("sync_year", year).maybeSingle();
  if (stateError) return respond(request, { error: "Could not check the holiday sync status." }, 500);
  if (!force && syncState?.synced_at && Date.now() - new Date(syncState.synced_at).getTime() < 24 * 60 * 60 * 1000) {
    return respond(request, { country, year, count: syncState.item_count, skipped: true, syncedAt: syncState.synced_at });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, {
      headers: { Accept: "application/json" }, signal: controller.signal,
    });
    if (!upstream.ok) return respond(request, { error: `Holiday provider returned ${upstream.status}.` }, 502);
    const upstreamData: unknown = await upstream.json();
    if (!Array.isArray(upstreamData)) return respond(request, { error: "Holiday provider returned an invalid response." }, 502);

    const entries = mapHolidayProviderEntries(upstreamData, country);
    if (!entries.length) return respond(request, { error: "The provider returned no nationwide holidays for that year." }, 502);

    const { data, error } = await admin.rpc("sync_holiday_calendar", { p_country: country, p_year: year, p_entries: entries });
    if (error) return respond(request, { error: error.message || "Holiday data could not be saved." }, 500);
    return respond(request, { ...data, skipped: false });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Holiday provider timed out. Try again later." : "Holiday provider could not be reached. Try again later.";
    return respond(request, { error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
