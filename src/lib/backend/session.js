import { assertBackendConfigured, throwIfError } from "./shared.js";

export function getSessionId(session) {
  const payload = session?.access_token?.split(".")[1];
  if (!payload) return "";
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof claims.session_id === "string" ? claims.session_id : "";
  } catch {
    return "";
  }
}

export async function claimRunbookSession(session) {
  const client = assertBackendConfigured();
  const sessionId = getSessionId(session);
  if (!sessionId) throw new Error("Could not identify this sign-in session. Please sign in again.");
  const { data, error } = await client.rpc("claim_runbook_session", { p_session_id: sessionId });
  throwIfError(error);
  return Boolean(data);
}

export async function checkRunbookSession() {
  const client = assertBackendConfigured();
  const { data, error } = await client.rpc("get_runbook_session_status");
  throwIfError(error);
  return data;
}

export async function touchRunbookSession() {
  const client = assertBackendConfigured();
  const { data, error } = await client.rpc("touch_runbook_session");
  throwIfError(error);
  return Boolean(data);
}

export async function releaseRunbookSession() {
  const client = assertBackendConfigured();
  const { error } = await client.rpc("release_runbook_session");
  throwIfError(error);
}

export async function loadRunbookSessionSettings() {
  const client = assertBackendConfigured();
  const { data, error } = await client.rpc("get_runbook_session_settings");
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function saveRunbookSessionSettings(settings) {
  const client = assertBackendConfigured();
  const { error } = await client.rpc("save_runbook_session_settings", {
    p_inactivity_timeout_minutes: Number(settings.inactivity_timeout_minutes),
    p_absolute_timeout_hours: Number(settings.absolute_timeout_hours),
    p_warning_minutes: Number(settings.warning_minutes),
  });
  throwIfError(error);
}
