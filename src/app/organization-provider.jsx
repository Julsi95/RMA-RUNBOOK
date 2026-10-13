import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/auth-provider";
import { ORGANIZATION_STORAGE_KEY, getOrganizationMembers } from "@/features/organization/organization-data";
import { loadRemoteRoster, saveRemoteEmployeeProfile, saveRemoteMembers, saveRemoteProfileFieldDefinitions } from "@/lib/backend/organization";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const { configured, canEdit, loading: authLoading, user } = useAuth();
  const [members, setMembers] = useState(() => configured ? [] : getOrganizationMembers());
  const [profiles, setProfiles] = useState({});
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
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
    if (!user) {
      setMembers([]);
      setProfiles({});
      setCustomFieldDefinitions([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const roster = await retryDataLoad(() => loadRemoteRoster(canEdit));
      setMembers(roster.members);
      setProfiles(roster.profiles);
      setCustomFieldDefinitions(roster.definitions);
      setError("");
      try { localStorage.setItem(ORGANIZATION_STORAGE_KEY, JSON.stringify(roster.members)); } catch { /* server remains source of truth */ }
    } catch (cause) {
      setError(cause.message || "Could not load the employee directory.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, canEdit, configured, user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!configured || authLoading || !user) return undefined;
    let active = true;
    let timer;
    const reload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void refresh(); }, 150);
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
    await refresh();
  }, [canEdit, configured, members, refresh]);

  const saveEmployeeProfile = useCallback(async (employeeId, profile) => {
    if (!configured) {
      setProfiles((current) => ({ ...current, [employeeId]: profile }));
      return;
    }
    if (!canEdit) throw new Error("Sign in with an editor account to edit profiles.");
    await saveRemoteEmployeeProfile(employeeId, profile);
    await refresh();
  }, [canEdit, configured, refresh]);

  const saveFieldDefinitions = useCallback(async (definitions) => {
    if (!configured) {
      setCustomFieldDefinitions(definitions);
      return;
    }
    if (!canEdit) throw new Error("Sign in with an editor account to edit profile fields.");
    await saveRemoteProfileFieldDefinitions(definitions);
    await refresh();
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
