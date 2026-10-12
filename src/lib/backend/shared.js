import { isSupabaseConfigured, requireSupabase } from "@/lib/supabase";

let realtimeSequence = 0;

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

export async function createPrivateSignedUrlMap(paths, expiresIn = 300) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return new Map();

  const client = assertBackendConfigured();
  const { data, error } = await client.storage.from("runbook-private").createSignedUrls(uniquePaths, expiresIn);
  throwIfError(error);
  const failed = (data ?? []).find((item) => item.error);
  if (failed) throw new Error(`Could not create a signed profile photo URL: ${failed.error}`);
  return new Map((data ?? []).filter((item) => item.path).map(({ path, signedUrl }) => [path, signedUrl ?? ""]));
}

export function subscribeToTables(tables, onChange, label = "data") {
  if (!isSupabaseConfigured) return () => {};
  const client = requireSupabase();
  const channel = client.channel(`runbook-${label}-${Date.now()}-${realtimeSequence++}`);
  for (const item of tables) {
    const table = typeof item === "string" ? item : item.table;
    const filter = typeof item === "string" ? undefined : item.filter;
    channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, onChange);
  }
  channel.subscribe();
  return () => { void client.removeChannel(channel); };
}
