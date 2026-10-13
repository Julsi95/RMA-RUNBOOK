import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/auth-provider";
import { countUnreadNotifications, ensureBirthdayNotifications, loadNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/backend/notifications";
import { isSupabaseConfigured } from "@/lib/supabase";
import { retryDataLoad, subscribeToTables } from "@/lib/backend/shared";

const NotificationContext = createContext(null);
const PAGE_SIZE = 30;

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !user) { setNotifications([]); setUnreadCount(0); setLoading(false); return; }
    const requestId = ++requestRef.current;
    try {
      await retryDataLoad(ensureBirthdayNotifications);
      const [rows, unread] = await Promise.all([retryDataLoad(() => loadNotifications({ limit: PAGE_SIZE })), retryDataLoad(countUnreadNotifications)]);
      if (requestId === requestRef.current) { setNotifications(rows); setHasMore(rows.length === PAGE_SIZE); setUnreadCount(unread); setError(""); }
    } catch (cause) { if (requestId === requestRef.current) setError(cause.message || "Notifications could not be loaded."); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) { setNotifications([]); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    const load = async () => { if (active) await refresh(); };
    void load();
    const unsubscribe = subscribeToTables([{ table: "user_notifications", filter: `recipient_id=eq.${user.id}` }], load, "user-notifications");
    const birthdayTimer = window.setInterval(() => { void load(); }, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(birthdayTimer); unsubscribe(); };
  }, [refresh, user?.id]);

  const value = useMemo(() => ({
    notifications, loading, error, hasMore, unreadCount,
    async loadMore() {
      if (!hasMore) return;
      const next = await loadNotifications({ offset: notifications.length, limit: PAGE_SIZE });
      setNotifications((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...next.filter((item) => !seen.has(item.id))];
      });
      setHasMore(next.length === PAGE_SIZE);
    },
    async markRead(id) {
      const wasUnread = notifications.some((item) => item.id === id && !item.read_at);
      const readAt = new Date().toISOString();
      await markNotificationRead(id);
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
      if (wasUnread) setUnreadCount((current) => Math.max(0, current - 1));
    },
    async markAllRead() {
      const readAt = new Date().toISOString();
      await markAllNotificationsRead();
      setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }));
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
