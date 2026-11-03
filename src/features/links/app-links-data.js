export const APP_LINKS_STORAGE_KEY = "starter-app-app-links-v1";
export const DASHBOARD_PUBLIC_APP_LINKS_QUERY_KEY = ["dashboard-public-app-links"];

export function readLocalAppLinks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_LINKS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === "object" && item.id && item.name && Boolean(item.publicVisible))
      : [];
  } catch {
    return [];
  }
}
