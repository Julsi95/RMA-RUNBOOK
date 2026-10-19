import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadKpiMonthData, loadPublicDashboardKpiWidget } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { useOrganizationRoster } from "@/app/organization-provider";
import { useAuth } from "@/app/auth-provider";
import { getOperationalRoster } from "@/features/organization/organization-data";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const DashboardKpiContext = createContext({ months: {}, loading: false, error: "", refresh: async () => {} });

export function DashboardKpiProvider({ children, publicOnly = false }) {
  const { members: rosterMembers, loading: rosterLoading } = useOrganizationRoster();
  const members = useMemo(() => getOperationalRoster(rosterMembers), [rosterMembers]);
  const { user, canEdit } = useAuth();
  const cacheKey = useMemo(() => publicOnly ? ["public-dashboard-kpi-widget"] : queryKeys.kpiMonths(user?.id ?? "anonymous", canEdit), [canEdit, publicOnly, user?.id]);
  const cached = readCachedQuery(cacheKey);
  const [months, setMonths] = useState(cached ?? {});
  const [loading, setLoading] = useState(isSupabaseConfigured && !cached);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseConfigured) { setMonths({}); setLoading(false); return; }
    const requestId = ++requestRef.current;
    if (!readCachedQuery(cacheKey)) setLoading(true);
    try { const data = await fetchCachedQuery(cacheKey, () => retryDataLoad(publicOnly ? loadPublicDashboardKpiWidget : loadKpiMonthData), { force }); if (requestId === requestRef.current) { setMonths(data); setError(""); } }
    catch (cause) { if (requestId === requestRef.current) setError(cause.message || "KPI results could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, [cacheKey, publicOnly]);

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
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [publicOnly, refresh]);

  const dashboardMembers = useMemo(() => {
    if (!publicOnly) return members;
    const latestMonth = Object.keys(months).sort((left, right) => right.localeCompare(left))[0];
    return Object.values(months[latestMonth]?.records ?? {}).map((record) => ({ id: record.memberId, name: record.memberName, role: record.role }));
  }, [members, months, publicOnly]);
  const value = useMemo(() => ({ months, members: dashboardMembers, rosterLoading: publicOnly ? false : rosterLoading, loading, error, refresh: () => refresh({ force: true }) }), [dashboardMembers, error, loading, publicOnly, refresh, rosterLoading, months]);
  return <DashboardKpiContext.Provider value={value}>{children}</DashboardKpiContext.Provider>;
}

export function useDashboardKpi() { return useContext(DashboardKpiContext); }
