import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadKpiMonthData } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const DashboardKpiContext = createContext({ months: {}, loading: false, error: "", refresh: async () => {} });

export function DashboardKpiProvider({ children }) {
  const { members: rosterMembers, loading: rosterLoading } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { user, canEdit } = useAuth();
  const cacheKey = useMemo(() => queryKeys.kpiMonths(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cached = readCachedQuery(cacheKey);
  const [months, setMonths] = useState(cached ?? {});
  const [loading, setLoading] = useState(isSupabaseConfigured && !cached);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseConfigured) { setMonths({}); setLoading(false); return; }
    const requestId = ++requestRef.current;
    if (!readCachedQuery(cacheKey)) setLoading(true);
    try { const data = await fetchCachedQuery(cacheKey, () => retryDataLoad(loadKpiMonthData), { force }); if (requestId === requestRef.current) { setMonths(data); setError(""); } }
    catch (cause) { if (requestId === requestRef.current) setError(cause.message || "KPI results could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, [cacheKey]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh({ force: true }); }, 180);
    };
    void refresh();
    const unsubscribe = subscribeToTables(["kpi_months", "kpi_results", "kpi_scoring_versions"], run, "dashboard-kpi-widgets");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [refresh]);

  const value = useMemo(() => ({ months, members, rosterLoading, loading, error, refresh: () => refresh({ force: true }) }), [error, loading, members, refresh, rosterLoading, months]);
  return <DashboardKpiContext.Provider value={value}>{children}</DashboardKpiContext.Provider>;
}

export function useDashboardKpi() { return useContext(DashboardKpiContext); }
