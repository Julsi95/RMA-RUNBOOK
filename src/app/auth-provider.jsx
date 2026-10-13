import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { subscribeToTables } from "@/lib/backend/shared";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const loadAccount = useCallback(async (user) => {
    if (!user || !supabase) {
      setAccount(null);
      setAccountProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from("app_accounts")
      .select("user_id, employee_id, display_name, can_edit, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      setAccount(null);
      setAccountProfile(null);
      return;
    }
    setAccount(data ?? null);
    const { data: profile } = await supabase.from("account_profiles").select("summary,photo_path,updated_at").eq("user_id", user.id).maybeSingle();
    setAccountProfile(profile ?? null);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession?.user) {
        setAccount(null);
        setAccountProfile(null);
        setLoading(false);
      } else {
        setLoading(true);
        setTimeout(async () => {
          if (!active) return;
          await loadAccount(nextSession.user);
          if (active) setLoading(false);
        }, 0);
      }
    });

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      const nextSession = error ? null : data.session;
      setSession(nextSession);
      if (nextSession?.user) await loadAccount(nextSession.user);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadAccount]);

  useEffect(() => {
    const currentUser = session?.user;
    if (!supabase || !currentUser) return undefined;
    let active = true;
    const unsubscribe = subscribeToTables([
      { table: "app_accounts", filter: `user_id=eq.${currentUser.id}` },
      { table: "account_profiles", filter: `user_id=eq.${currentUser.id}` },
    ], () => {
      if (active) void loadAccount(currentUser);
    }, "current-account");
    return () => { active = false; unsubscribe(); };
  }, [loadAccount, session?.user?.id]);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    account,
    accountProfile,
    role: isSupabaseConfigured ? account?.role ?? "user" : "admin",
    isAdmin: !isSupabaseConfigured || account?.role === "admin" || account?.role === "super_admin",
    canEdit: !isSupabaseConfigured || account?.role === "admin" || account?.role === "super_admin",
    async updateAccountProfile({ displayName, summary, photoPath }) {
      if (!supabase) throw new Error("Connect Supabase before updating your profile.");
      const { error } = await supabase.rpc("update_my_account_profile", {
        p_display_name: displayName,
        p_summary: summary,
        p_photo_path: photoPath || null,
      });
      if (error) throw error;
      await loadAccount(session?.user);
    },
    async updateEmail(email) {
      if (!supabase) throw new Error("Connect Supabase before changing your login email.");
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
    },
    async signIn(email, password) {
      if (!supabase) throw new Error("Connect Supabase before signing in.");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async requestPasswordReset(email) {
      if (!supabase) throw new Error("Connect Supabase before requesting a password reset.");
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    async updatePassword(password) {
      if (!supabase) throw new Error("Connect Supabase before updating a password.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    async refreshAccount() {
      await loadAccount(session?.user);
    },
  }), [account, accountProfile, loadAccount, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
