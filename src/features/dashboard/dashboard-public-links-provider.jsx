import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadAppLinks } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, readCachedQuery } from "@/lib/backend/query-cache";
import { DASHBOARD_PUBLIC_APP_LINKS_QUERY_KEY, readLocalAppLinks } from "@/features/links/app-links-data";

const DashboardPublicLinksContext = createContext({ links: [], loading: false, error: "", refresh: async () => {} });

export function DashboardPublicLinksProvider({ children }) {
  const cached = readCachedQuery(DASHBOARD_PUBLIC_APP_LINKS_QUERY_KEY);
  const [links, setLinks] = useState(cached ?? (isSupabaseConfigured ? [] : readLocalAppLinks()));
  const [loading, setLoading] = useState(isSupabaseConfigured && !cached);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseConfigured) {
      setLinks(readLocalAppLinks());
      setLoading(false);
      return;
    }
    const requestId = ++sequence.current;
    if (!readCachedQuery(DASHBOARD_PUBLIC_APP_LINKS_QUERY_KEY)) setLoading(true);
    try {
      const data = await fetchCachedQuery(DASHBOARD_PUBLIC_APP_LINKS_QUERY_KEY, () => retryDataLoad(() => loadAppLinks({ publicOnly: true })), { force });
      if (requestId === sequence.current) { setLinks(data); setError(""); }
    } catch (cause) {
      if (requestId === sequence.current) setError(cause.message || "Public app links could not be loaded.");
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh({ force: true }); }, 160);
    };
    void refresh();
    const unsubscribe = subscribeToTables(["app_links"], () => { if (document.visibilityState === "visible") onChange(); }, "dashboard-public-app-links");
    const poll = window.setInterval(() => {
      if (active && document.visibilityState === "visible") void refresh({ force: true });
    }, 60_000);
    const onVisibilityChange = () => { if (active && document.visibilityState === "visible") void refresh({ force: true }); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(poll); document.removeEventListener("visibilitychange", onVisibilityChange); unsubscribe(); };
  }, [refresh]);

  const value = useMemo(() => ({ links, loading, error, refresh: () => refresh({ force: true }) }), [error, links, loading, refresh]);
  return <DashboardPublicLinksContext.Provider value={value}>{children}</DashboardPublicLinksContext.Provider>;
}

export function useDashboardPublicLinks() { return useContext(DashboardPublicLinksContext); }
