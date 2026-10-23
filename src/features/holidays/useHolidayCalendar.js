import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import { subscribeToTables } from "@/lib/backend/shared";
import { useAuth } from "@/app/auth-provider";
import { loadHolidayCalendar, syncHolidayYear } from "./holiday-service";

export function useHolidayCalendar(year, { autoSync = true } = {}) {
  const key = useMemo(() => queryKeys.holidays(year), [year]);
  const { user, isAdmin } = useAuth();
  const cached = readCachedQuery(key);
  const [holidays, setHolidays] = useState(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    try {
      const data = await fetchCachedQuery(key, () => loadHolidayCalendar(year), { force });
      setHolidays(data);
      setError("");
      return data;
    } catch (cause) { setError(cause.message || "Holiday calendar could not be loaded."); throw cause; }
    finally { setLoading(false); }
  }, [key, year]);

  const sync = useCallback(async (country, force = false) => {
    setSyncing(true);
    try {
      await syncHolidayYear(country, year, force);
      await refresh(true);
    } catch (cause) { setError(cause.message || "Holiday sync failed."); throw cause; }
    finally { setSyncing(false); }
  }, [refresh, year]);

  useEffect(() => {
    let active = true;
    void refresh().catch(() => {});
    const unsubscribe = subscribeToTables(["holiday_calendar"], () => { if (active) void refresh(true).catch(() => {}); }, `holiday-calendar-${year}`);
    if (user && isAdmin && autoSync) for (const country of ["US", "PH"]) void syncHolidayYear(country, year, false).then(() => active && refresh(true)).catch((cause) => { if (active) setError(cause.message || "Holiday sync failed."); });
    return () => { active = false; unsubscribe(); };
  }, [autoSync, isAdmin, refresh, user?.id, year]);

  return { holidays, loading, error, syncing, isAdmin: Boolean(user && isAdmin), refresh, sync };
}
