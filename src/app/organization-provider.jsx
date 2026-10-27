import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/app/auth-provider";
import { ORGANIZATION_STORAGE_KEY, getOrganizationMembers } from "@/features/organization/organization-data";
import { loadRemoteRoster, saveRemoteEmployeeProfile, saveRemoteMembers, saveRemoteProfileFieldDefinitions } from "@/lib/backend/organization";
import { createPrivateSignedUrlMap, retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const { configured, canEdit, loading: authLoading, user } = useAuth();
  const location = useLocation();
  const rosterKey = useMemo(() => queryKeys.roster(user?.id ?? "anonymous", canEdit), [canEdit, user?.id]);
  const cachedRoster = readCachedQuery(rosterKey);
  const [members, setMembers] = useState(() => configured ? cachedRoster?.members ?? [] : getOrganizationMembers());
  const [profiles, setProfiles] = useState(() => cachedRoster?.profiles ?? {});
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState(() => cachedRoster?.definitions ?? []);
  const [loading, setLoading] = useState(configured && !cachedRoster);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const photoUrlsUpdatedAt = useRef(0);

  const refresh = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!configured) {
      const localMembers = getOrganizationMembers();
      setMembers(localMembers);
      setProfiles({});
      setCustomFieldDefinitions([]);
      setError("");
      setLoading(false);
      return;
    }

    // OrganizationProvider mounts before the route-level auth guard. Wait for
    // Supabase to restore the persisted session before calling authenticated RPCs.
    if (authLoading) return;
    if (!user && !["/organizational", "/agent-profiles"].includes(location.pathname)) {
      setMembers([]);
      setProfiles({});
      setCustomFieldDefinitions([]);
      setError("");
      setLoading(false);
      return;
    }

    const cached = readCachedQuery(rosterKey);
    if (cached) {
      setMembers(cached.members);
      setProfiles(cached.profiles);
      setCustomFieldDefinitions(cached.definitions);
      setLoading(false);
    } else setLoading(true);
    try {
      const roster = await fetchCachedQuery(rosterKey, () => retryDataLoad(() => loadRemoteRoster(canEdit, { anonymous: !user })), { force });
      if (requestId !== requestSequence.current) return;
      setMembers(roster.members);
      photoUrlsUpdatedAt.current = Date.now();
      setProfiles(roster.profiles);
      setCustomFieldDefinitions(roster.definitions);
      setError("");
      try { localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify(roster.members)); } catch { /* server remains source of truth */ }
    } catch (cause) {
      if (requestId === requestSequence.current) setError(cause.message || "Could not load the employee directory.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [authLoading, canEdit, configured, location.pathname, rosterKey, user?.id]);

  const refreshSignedPhotoUrls = useCallback(async () => {
    if (!configured || authLoading || !user) return;
    const paths = [...new Set(members.map((member) => member.photoPath).filter(Boolean))];
    if (!paths.length) return;
    const signedPhotos = await createPrivateSignedUrlMap(paths, 3600);
    setMembers((current) => current.map((member) => ({
      ...member,
      photo: member.photoPath ? signedPhotos.get(member.photoPath) ?? member.photo : member.photo,
    })));
    photoUrlsUpdatedAt.current = Date.now();
  }, [authLoading, configured, members, user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!configured || authLoading || !user) return undefined;
    let active = true;
    let inFlight = false;
    const maybeRefresh = () => {
      if (!active || inFlight || Date.now() - photoUrlsUpdatedAt.current < 40 * 60 * 1000) return;
      inFlight = true;
      void refreshSignedPhotoUrls().catch(() => {
        // Keep the existing image URL while offline and retry on reconnect or next visibility.
      }).finally(() => { inFlight = false; });
    };
    const timer = window.setInterval(maybeRefresh, 45 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") maybeRefresh(); };
    window.addEventListener("online", maybeRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authLoading, configured, refreshSignedPhotoUrls, user?.id]);

  useEffect(() => {
    if (!configured || authLoading || !user) return undefined;
    let active = true;
    let timer;
    const reload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh({ force: true }); }, 150);
    };
    const unsubscribe = subscribeToTables([
      "agent_profile_field_definitions",
      { table: "realtime_sync_signals", filter: "source_table=eq.employees" },
      { table: "realtime_sync_signals", filter: "source_table=eq.employee_profiles" },
    ], reload, "organization");
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [authLoading, configured, refresh, user?.id]);

  const saveMembers = useCallback(async (nextMembers, { deletedId = null } = {}) => {
    if (!configured) {
      setMembers(nextMembers);
      try { localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify(nextMembers)); } catch { /* current session remains available */ }
      return;
    }
    if (!canEdit) throw new Error("Sign in with an editor account to change employees.");
    await saveRemoteMembers(members, nextMembers, deletedId);
    await queryClient.cancelQueries({ queryKey: rosterKey, exact: true });
    const cached = readCachedQuery(rosterKey);
    const optimisticRoster = { members: nextMembers, profiles: cached?.profiles ?? profiles, definitions: cached?.definitions ?? customFieldDefinitions };
    queryClient.setQueryData(rosterKey, optimisticRoster);
    setMembers(nextMembers);
    try { localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify(nextMembers)); } catch { /* server remains source of truth */ }
    await refresh({ force: true });
  }, [canEdit, configured, customFieldDefinitions, members, profiles, refresh, rosterKey]);

  const saveEmployeeProfile = useCallback(async (employeeId, profile) => {
    if (!configured) {
      setProfiles((current) => ({ ...current, [employeeId]: profile }));
      return;
    }
    if (!canEdit) throw new Error("Sign in with an editor account to edit profiles.");
    await saveRemoteEmployeeProfile(employeeId, profile);
    await refresh({ force: true });
  }, [canEdit, configured, refresh]);

  const saveFieldDefinitions = useCallback(async (definitions) => {
    if (!configured) {
      setCustomFieldDefinitions(definitions);
      return;
    }
    if (!canEdit) throw new Error("Sign in with an editor account to edit profile fields.");
    await saveRemoteProfileFieldDefinitions(definitions);
    await refresh({ force: true });
  }, [canEdit, configured, refresh]);

  const value = useMemo(() => ({
    members, profiles, customFieldDefinitions, loading, error, refresh,
    saveMembers, saveEmployeeProfile, saveFieldDefinitions,
  }), [members, profiles, customFieldDefinitions, loading, error, refresh, saveMembers, saveEmployeeProfile, saveFieldDefinitions]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganizationRoster() {
  const context = useContext(OrganizationContext);
  if (!context) throw new Error("useOrganizationRoster must be used within OrganizationProvider.");
  return context;
}
