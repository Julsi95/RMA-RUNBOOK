import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/auth-provider";
import { countUnreadNotifications, ensureBirthdayNotifications, loadNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/backend/notifications";
import { isSupabaseConfigured } from "@/lib/supabase";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";
import { fetchCachedQuery, queryClient, queryKeys, readCachedQuery } from "@/lib/backend/query-cache";

const NotificationContext = createContext(null);
const PAGE_SIZE = 30;

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const cacheKey = useMemo(() => queryKeys.notifications(user?.id ?? "anonymous"), [user?.id]);
  const cached = readCachedQuery(cacheKey);
  const [notifications, setNotifications] = useState(cached?.rows ?? []);
  const [loading, setLoading] = useState(isSupabaseConfigured && !cached);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [unreadCount, setUnreadCount] = useState(cached?.unreadCount ?? 0);
  const requestRef = useRef(0);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseConfigured || !user) { setNotifications([]); setUnreadCount(0); setLoading(false); return; }
    const requestId = ++requestRef.current;
    try {
      const cachedValue = readCachedQuery(cacheKey);
      if (cachedValue) {
        setNotifications(cachedValue.rows);
        setHasMore(cachedValue.hasMore);
        setUnreadCount(cachedValue.unreadCount);
      }
      const value = await fetchCachedQuery(cacheKey, async () => {
        await retryDataLoad(ensureBirthdayNotifications);
        const [rows, unread] = await Promise.all([retryDataLoad(() => loadNotifications({ limit: PAGE_SIZE })), retryDataLoad(countUnreadNotifications)]);
        return { rows, unreadCount: unread, hasMore: rows.length === PAGE_SIZE };
      }, { force });
      if (requestId === requestRef.current) { setNotifications(value.rows); setHasMore(value.hasMore); setUnreadCount(value.unreadCount); setError(""); }
    } catch (cause) { if (requestId === requestRef.current) setError(cause.message || "Notifications could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, [cacheKey, user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) { setNotifications([]); setLoading(false); return undefined; }
    let active = true;
    if (!readCachedQuery(cacheKey)) setLoading(true);
    const load = async (force = false) => { if (active) await refresh({ force }); };
    void load();
    const unsubscribe = subscribeToTables([{ table: "user_notifications", filter: `recipient_id=eq.${user.id}` }], () => { void load(true); }, "user-notifications");
    const birthdayTimer = window.setInterval(() => { void load(true); }, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(birthdayTimer); unsubscribe(); };
  }, [cacheKey, refresh, user?.id]);

  const value = useMemo(() => ({
    notifications, loading, error, hasMore, unreadCount,
    async loadMore() {
      if (!hasMore) return;
      const next = await fetchCachedQuery([...cacheKey, "page", notifications.length], () => loadNotifications({ offset: notifications.length, limit: PAGE_SIZE }));
      setNotifications((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...next.filter((item) => !seen.has(item.id))];
      });
      setHasMore(next.length === PAGE_SIZE);
      queryClient.setQueryData(cacheKey, (current) => {
        if (!current) return current;
        const seen = new Set(current.rows.map((item) => item.id));
        return { ...current, rows: [...current.rows, ...next.filter((item) => !seen.has(item.id))], hasMore: next.length === PAGE_SIZE };
      });
    },
    async markRead(id) {
      const wasUnread = notifications.some((item) => item.id === id && !item.read_at);
      const readAt = new Date().toISOString();
      await markNotificationRead(id);
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
      queryClient.setQueryData(cacheKey, (current) => current ? { ...current, rows: current.rows.map((item) => item.id === id ? { ...item, read_at: readAt } : item) } : current);
      if (wasUnread) setUnreadCount((current) => Math.max(0, current - 1));
    },
    async markAllRead() {
      const readAt = new Date().toISOString();
      await markAllNotificationsRead();
      setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }));
      queryClient.setQueryData(cacheKey, (current) => current ? { ...current, rows: current.rows.map((item) => item.read_at ? item : { ...item, read_at: readAt }) } : current);
      setUnreadCount(0);
    },
    async refresh() { setLoading(true); await refresh(); },
  }), [error, hasMore, loading, notifications, refresh, unreadCount]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used within NotificationProvider.");
  return value;
}
