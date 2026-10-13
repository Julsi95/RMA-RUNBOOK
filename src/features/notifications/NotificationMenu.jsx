import { useState } from "react";
import { Bell, Cake, ChartNoAxesColumnIncreasing, ExternalLink, Link2, PhoneIncoming, UsersRound, Wallet, CalendarClock, Megaphone, CheckCheck } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useNotifications } from "@/app/notification-provider";

const icons = {
  birthday: Cake, "vl-credit": Wallet, dashboard: Megaphone, project: UsersRound,
  "inbound-call": PhoneIncoming, "work-schedule": CalendarClock, "work-link": Link2,
  "monthly-kpi": ChartNoAxesColumnIncreasing,
};

function relativeTime(value) {
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function NotificationRow({ item, close }) {
  const { markRead } = useNotifications();
  const Icon = icons[item.category] ?? Bell;
  const navigate = useNavigate();
  async function open() {
    try { if (!item.read_at) await markRead(item.id); } catch { /* the destination remains available if marking read fails */ }
    close?.();
    navigate(item.href || "/");
  }
  return <button className={`notification-row${item.read_at ? "" : " is-unread"}`} type="button" onClick={() => void open()}>
    <span className="notification-row-icon"><Icon size={16} /></span>
    <span className="notification-row-content"><strong>{item.title}</strong><span>{item.body}</span><time dateTime={item.created_at}>{relativeTime(item.created_at)}</time></span>
    {!item.read_at && <i className="notification-unread-dot" aria-label="Unread" />}
  </button>;
}

export default function NotificationMenu({ close }) {
  const { notifications, loading, error, markAllRead } = useNotifications();
  const [actionError, setActionError] = useState("");
  const unread = notifications.filter((item) => !item.read_at).length;
  return <section className="notification-menu" aria-label="Notifications">
    <header className="notification-menu-heading"><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : "You're all caught up"}</span></div>{unread > 0 && <button type="button" onClick={() => void markAllRead().catch((cause) => setActionError(cause.message || "Could not mark notifications read."))}><CheckCheck size={14} /> Mark all read</button>}</header>
    {actionError && <p className="notification-menu-error" role="alert">{actionError}</p>}
    {loading && notifications.length === 0 ? <p className="notification-menu-empty">Loading notifications…</p>
      : error && notifications.length === 0 ? <p className="notification-menu-empty" role="alert">{error}</p>
        : notifications.length ? <div className="notification-menu-list">{notifications.slice(0, 8).map((item) => <NotificationRow key={item.id} item={item} close={close} />)}</div>
          : <p className="notification-menu-empty">No notifications yet.</p>}
    <Link className="notification-view-all" to="/notifications" onClick={close}>View notification history <ExternalLink size={13} /></Link>
  </section>;
}
