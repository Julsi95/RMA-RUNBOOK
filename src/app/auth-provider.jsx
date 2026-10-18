import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { subscribeToTables } from "@/lib/backend/shared";
import {
  checkRunbookSession,
  claimRunbookSession,
  getSessionId,
  releaseRunbookSession,
  touchRunbookSession,
} from "@/lib/backend/session";

const AuthContext = createContext(null);

function sessionEndMessage(state) {
  if (state === "replaced") return "This account was signed in on another device. Sign in again to continue.";
  if (state === "expired") return "You have been logged out due to inactivity.";
  return "This sign-in could not be verified. Sign in again to continue.";
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const [sessionCheckError, setSessionCheckError] = useState("");
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const currentSessionRef = useRef(null);
  const sessionCheckSequence = useRef(0);
  const sessionStatusRequestRef = useRef(null);
  const lastActivityPing = useRef(0);

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
    if (error) throw error;
    setAccount(data ?? null);
    const { data: profile, error: profileError } = await supabase
      .from("account_profiles")
      .select("summary,photo_path,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    setAccountProfile(profile ?? null);
  }, []);

  const clearLocalSession = useCallback((message = "", release = true, revokeAuthSessions = false) => {
    sessionCheckSequence.current += 1;
    currentSessionRef.current = null;
    setSessionNotice(message);
    setSession(null);
    setAccount(null);
    setAccountProfile(null);
    setSessionStatus(null);
    setLoading(false);
    if (release) void releaseRunbookSession().catch(() => {});
    void supabase?.auth.signOut({ scope: revokeAuthSessions ? "global" : "local" }).catch(() => {});
  }, []);

  const verifyCurrentSession = useCallback(async (nextSession, { claim = false, updateLoading = false } = {}) => {
    if (!nextSession?.user || !supabase) return false;
    const sequence = ++sessionCheckSequence.current;
    const sessionId = getSessionId(nextSession);
    if (!sessionId) {
      clearLocalSession("Could not verify this sign-in. Please sign in again.", false);
      return false;
    }
    const previousId = getSessionId(currentSessionRef.current);
    currentSessionRef.current = nextSession;
    setSession(nextSession);
    if (updateLoading || !previousId || previousId !== sessionId) {
      setLoading(true);
      setSessionStatus(null);
    }

    try {
      if (claim) {
        const claimed = await claimRunbookSession(nextSession);
        if (!claimed) {
          const status = await checkRunbookSession();
          if (sequence === sessionCheckSequence.current) clearLocalSession(sessionEndMessage(status?.state), true, status?.state === "expired");
          return false;
        }
      }
      const status = await checkRunbookSession();
      if (sequence !== sessionCheckSequence.current) return false;
      if (!status?.active) {
        clearLocalSession(sessionEndMessage(status?.state), true, status?.state === "expired");
        return false;
      }
      await loadAccount(nextSession.user);
      if (sequence !== sessionCheckSequence.current) return false;
      setSessionStatus(status);
      setSessionNotice("");
      setSessionCheckError("");
      setLoading(false);
      return true;
    } catch (error) {
      if (sequence === sessionCheckSequence.current) {
        // Keep a valid session during brief network outages; retry on focus,
        // reconnect, and the next status poll rather than signing out blindly.
        setSessionCheckError(error?.message || "Could not verify your session. Check your connection and retry.");
        setLoading(false);
      }
      return false;
    }
  }, [clearLocalSession, loadAccount]);

  const refreshSessionStatus = useCallback(async () => {
    if (!session?.user) return null;
    const sessionId = getSessionId(currentSessionRef.current);
    if (sessionStatusRequestRef.current?.sessionId === sessionId) return sessionStatusRequestRef.current.promise;
    const request = (async () => {
      try {
        const status = await checkRunbookSession();
        if (getSessionId(currentSessionRef.current) !== sessionId) return null;
        if (!status?.active) {
          clearLocalSession(sessionEndMessage(status?.state), true, status?.state === "expired");
          return null;
        }
        setSessionStatus(status);
        setSessionCheckError("");
        return status;
      } catch (error) {
        setSessionCheckError(error?.message || "Could not verify your session. Check your connection and retry.");
        return null;
      }
    })();
    const requestState = { sessionId, promise: request };
    sessionStatusRequestRef.current = requestState;
    try {
      return await request;
    } finally {
      if (sessionStatusRequestRef.current === requestState) sessionStatusRequestRef.current = null;
    }
  }, [clearLocalSession, session?.user?.id]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (!nextSession?.user) {
        currentSessionRef.current = null;
        setSession(null);
        setAccount(null);
        setAccountProfile(null);
        setSessionStatus(null);
        setLoading(false);
        return;
      }
      const shouldClaim = ["INITIAL_SESSION", "SIGNED_IN", "PASSWORD_RECOVERY"].includes(event);
      const existingSessionId = getSessionId(currentSessionRef.current);
      const nextSessionId = getSessionId(nextSession);
      if (!shouldClaim && existingSessionId && existingSessionId === nextSessionId) {
        // Routine refreshes rotate the JWT but keep the same Auth session.
        // Updating only the token-bearing session avoids reloading account
        // records and resetting forms that depend on them.
        currentSessionRef.current = nextSession;
        setSession(nextSession);
        return;
      }
      window.setTimeout(() => {
        if (active) void verifyCurrentSession(nextSession, { claim: shouldClaim });
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [verifyCurrentSession]);

  useEffect(() => {
    if (!session?.user || !sessionStatus?.active) return undefined;
    lastActivityPing.current = Date.now();
    let pingInFlight = false;
    const onActivity = () => {
      if (document.visibilityState === "hidden" || pingInFlight) return;
      const now = Date.now();
      if (now - lastActivityPing.current < 45_000) return;
      lastActivityPing.current = now;
      pingInFlight = true;
      void touchRunbookSession().then(async (active) => {
        if (!active) {
          const status = await checkRunbookSession().catch(() => null);
          clearLocalSession(sessionEndMessage(status?.state), true, status?.state === "expired");
          return;
        }
        await refreshSessionStatus();
      }).catch(() => {}).finally(() => { pingInFlight = false; });
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, onActivity));
  }, [clearLocalSession, refreshSessionStatus, session?.user?.id, sessionStatus?.active]);

  useEffect(() => {
    if (!session?.user || !sessionStatus?.active) return undefined;
    const interval = window.setInterval(() => { void refreshSessionStatus(); }, 15_000);
    const onOnline = () => { void refreshSessionStatus(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshSessionStatus(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSessionStatus, session?.user?.id, sessionStatus?.active]);

  useEffect(() => {
    if (!session?.user || !sessionStatus?.active) return undefined;
    const unsubscribe = subscribeToTables([
      { table: "runbook_session_signals", filter: `user_id=eq.${session.user.id}` },
    ], () => { void refreshSessionStatus(); }, "session-replacement");
    return unsubscribe;
  }, [refreshSessionStatus, session?.user?.id, sessionStatus?.active]);

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
    sessionStatus,
    sessionNotice,
    sessionCheckError,
    clearSessionNotice: () => setSessionNotice(""),
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
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const claimed = await claimRunbookSession(data.session);
      if (!claimed) {
        const status = await checkRunbookSession().catch(() => null);
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(sessionEndMessage(status?.state));
      }
      const status = await checkRunbookSession();
      if (!status?.active) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(sessionEndMessage(status?.state));
      }
      setSession(data.session);
      currentSessionRef.current = data.session;
      setSessionStatus(status);
      setSessionCheckError("");
      setSessionNotice("");
      await loadAccount(data.session.user);
      setLoading(false);
    },
    async signOut() {
      if (!supabase) return;
      try { await releaseRunbookSession(); } catch { /* local logout must still work offline */ }
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setSessionNotice("");
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
    async refreshSessionStatus() {
      return refreshSessionStatus();
    },
  }), [account, accountProfile, clearLocalSession, loadAccount, loading, refreshSessionStatus, session, sessionCheckError, sessionNotice, sessionStatus]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
