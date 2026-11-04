import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadKpiMonthData, loadPublicDashboardKpiWidget, loadPublicDashboardRecognition } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const DashboardKpiContext = createContext({ months: {}, recognition: null, loading: false, error: "", refresh: async () => {} });

export function DashboardKpiProvider({ children, publicOnly = false }) {
  const { members: rosterMembers, loading: rosterLoading } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { user, canEdit } = useAuth();
  const anonymousRecognition = publicOnly && !user;
  const cacheKey = useMemo(() => anonymousRecognition ? ["public-dashboard-recognition"] : publicOnly ? ["public-dashboard-kpi-widget"] : queryKeys.kpiMonths(user?.id ?? "anonymous", canEdit), [anonymousRecognition, canEdit, publicOnly, user?.id]);
  const recognitionCacheKey = useMemo(() => ["public-dashboard-recognition"], []);
  const cached = readCachedQuery(cacheKey);
  const cachedRecognition = readCachedQuery(recognitionCacheKey);
  const [months, setMonths] = useState(anonymousRecognition ? {} : cached ?? {});
  const [recognition, setRecognition] = useState(publicOnly ? cachedRecognition : null);
  const [loading, setLoading] = useState(isSupabaseConfigured && (!cached || (publicOnly && !cachedRecognition)));
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseConfigured) { setMonths({}); setRecognition(null); setLoading(false); return; }
    const requestId = ++requestRef.current;
    if (!readCachedQuery(cacheKey) || (publicOnly && !readCachedQuery(recognitionCacheKey))) setLoading(true);
    try {
      const [data, publicRecognition] = anonymousRecognition
        ? [null, await fetchCachedQuery(recognitionCacheKey, () => retryDataLoad(loadPublicDashboardRecognition), { force })]
        : publicOnly
          ? await Promise.all([
            fetchCachedQuery(cacheKey, () => retryDataLoad(loadPublicDashboardKpiWidget), { force }),
            fetchCachedQuery(recognitionCacheKey, () => retryDataLoad(loadPublicDashboardRecognition), { force }),
          ])
          : [await fetchCachedQuery(cacheKey, () => retryDataLoad(loadKpiMonthData), { force }), null];
      if (requestId === requestRef.current) {
        if (anonymousRecognition) setMonths({});
        else setMonths(data);
        setRecognition(publicRecognition);
        setError("");
      }
    }
    catch (cause) { if (requestId === requestRef.current) setError(cause.message || "KPI results could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, [anonymousRecognition, cacheKey, publicOnly, recognitionCacheKey, user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh({ force: true }); }, 180);
    };
    void refresh();
    const unsubscribe = subscribeToTables(publicOnly ? ["dashboard_publication", "kpi_months", "kpi_results"] : ["kpi_months", "kpi_results", "kpi_scoring_versions"], run, publicOnly ? "public-dashboard-kpi-widgets" : "dashboard-kpi-widgets");
    const poll = anonymousRecognition ? window.setInterval(() => {
      if (active && document.visibilityState === "visible") void refresh({ force: true });
    }, 30_000) : null;
    return () => { active = false; window.clearTimeout(timer); if (poll) window.clearInterval(poll); unsubscribe(); };
  }, [anonymousRecognition, publicOnly, refresh]);

  const dashboardMembers = useMemo(() => {
    if (!publicOnly) return members;
    if (anonymousRecognition) return recognition?.agents ?? [];
    const latestMonth = Object.keys(months).sort((left, right) => right.localeCompare(left))[0];
    return Object.values(months[latestMonth]?.records ?? {}).map((record) => ({ id: record.memberId, name: record.memberName, role: record.role }));
  }, [anonymousRecognition, members, months, publicOnly, recognition]);
  // Never let a prior authenticated query remain visible for even one render
  // when this provider is serving the anonymous public workspace.
  const visibleMonths = anonymousRecognition ? {} : months;
  const value = useMemo(() => ({ months: visibleMonths, recognition, members: dashboardMembers, rosterLoading: publicOnly ? false : rosterLoading, loading, error, refresh: () => refresh({ force: true }) }), [dashboardMembers, error, loading, publicOnly, recognition, refresh, rosterLoading, visibleMonths]);
  return <DashboardKpiContext.Provider value={value}>{children}</DashboardKpiContext.Provider>;
}

export function useDashboardKpi() { return useContext(DashboardKpiContext); }
