import { assertBackendConfigured, throwIfError } from "./shared.js";

const PAGE_SIZE = 30;

export async function ensureBirthdayNotifications() {
  const { data, error } = await assertBackendConfigured().rpc("ensure_birthday_notifications");
  throwIfError(error);
  return Number(data) || 0;
}

export async function loadNotifications({ offset = 0, limit = PAGE_SIZE } = {}) {
  const { data, error } = await assertBackendConfigured()
    .from("user_notifications")
    .select("id,event_key,category,title,body,href,created_at,read_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  throwIfError(error);
  return data ?? [];
}

export async function countUnreadNotifications() {
  const { count, error } = await assertBackendConfigured().from("user_notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  throwIfError(error);
  return count ?? 0;
}

export async function markNotificationRead(id) {
  const { error } = await assertBackendConfigured().from("user_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  throwIfError(error);
}

export async function markAllNotificationsRead() {
  const { error } = await assertBackendConfigured().from("user_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  throwIfError(error);
}
