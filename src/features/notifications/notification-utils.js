export function notificationHref(item) {
  const eventKey = String(item?.event_key ?? "");
  if (item?.category === "wfh-privilege" && eventKey.startsWith("wfh-request:")) {
    const requestId = eventKey.slice("wfh-request:".length);
    if (requestId) return "/wfh-privileges?request=" + encodeURIComponent(requestId);
  }
  return item?.href || "/";
}
