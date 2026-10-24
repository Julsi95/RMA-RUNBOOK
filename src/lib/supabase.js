import { createClient } from "@supabase/supabase-js";
import { createMonitoredFetch } from "@/lib/backend/request-monitor";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();

export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      global: { fetch: createMonitoredFetch(url) },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}
