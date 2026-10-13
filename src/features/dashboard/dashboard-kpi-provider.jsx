import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { loadKpiMonthData } from "@/lib/backend-repositories";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { useOrganizationRoster } from "@/app/organization-provider";

const DashboardKpiContext = createContext({ months: {}, loading: false, error: "", refresh: async () => {} });

export function DashboardKpiProvider({ children }) {
  const { members, loading: rosterLoading } = useOrganizationRoster();
  const [months, setMonths] = useState({});
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setMonths({}); setLoading(false); return; }
    const requestId = ++requestRef.current;
    setLoading(true);
    try { const data = await retryDataLoad(loadKpiMonthData); if (requestId === requestRef.current) { setMonths(data); setError(""); } }
    catch (cause) { if (requestId === requestRef.current) setError(cause.message || "KPI results could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let timer;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh(); }, 180);
    };
    void refresh();
    const unsubscribe = subscribeToTables(["kpi_months", "kpi_results", "kpi_scoring_versions"], run, "dashboard-kpi-widgets");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [refresh, revision]);

  const value = useMemo(() => ({ months, members, rosterLoading, loading, error, refresh: () => setRevision((n) => n + 1) }), [error, loading, members, rosterLoading, months]);
  return <DashboardKpiContext.Provider value={value}>{children}</DashboardKpiContext.Provider>;
}

export function useDashboardKpi() { return useContext(DashboardKpiContext); }
