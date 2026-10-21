import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCachedQuery, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";
import { subscribeToTables } from "@/lib/backend/shared";
import { notifyWfhExpirations, loadWfhPrivileges } from "./wfh-service";
import { useAuth } from "@/app/auth-provider";

export function useWfhPrivileges() {
  const { user } = useAuth();
  const key = useMemo(() => queryKeys.wfhPrivileges(user?.id ?? "anonymous"), [user?.id]);
  const cached = readCachedQuery(key);
  const [data, setData] = useState(cached ?? { rewards: [], requests: [], allocations: [], audit: [], settings: null });
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await fetchCachedQuery(key, loadWfhPrivileges, { force });
      setData(next); setError(""); return next;
    } catch (cause) { setError(cause.message || "WFH privilege data could not be loaded."); throw cause; }
    finally { setLoading(false); }
  }, [key]);

  useEffect(() => {
    if (!user) { setLoading(false); return undefined; }
    let active = true;
    void refresh().catch(() => {});
    void notifyWfhExpirations().catch(() => {});
    const unsubscribe = subscribeToTables(["wfh_privilege_rewards", "wfh_privilege_requests", "wfh_privilege_allocations", "wfh_privilege_audit", "wfh_privilege_settings"], () => { if (active) void refresh(true).catch(() => {}); }, `wfh-privileges-${user.id}`);
    return () => { active = false; unsubscribe(); };
  }, [refresh, user?.id]);

  return { ...data, loading, error, refresh };
}
