import { useState } from "react";
import { Bell, Cake as CakeIcon, CheckCheck, ChartNoAxesColumnIncreasing as KpiIcon, CalendarClock as CalendarIcon, Link2 as LinkIcon, LoaderCircle, Megaphone as MegaphoneIcon, PhoneIncoming as PhoneIcon, UsersRound as UsersIcon, Wallet as WalletIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { useNotifications } from "@/app/notification-provider";

export default function NotificationsPage() {
  const { notifications, loading, error, hasMore, loadMore, markAllRead } = useNotifications();
  const [actionError, setActionError] = useState("");
  return <section className="page-content notifications-page">
    <header className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Notifications</h1><p className="page-description">Updates for your account and team.</p></div>{notifications.some((item) => !item.read_at) && <Button type="button" variant="outline" onClick={() => void markAllRead().catch((cause) => setActionError(cause.message || "Could not mark notifications read."))}><CheckCheck size={15} /> Mark all read</Button>}</header>
    {actionError && <p className="auth-error" role="alert">{actionError}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
    {loading && notifications.length === 0 ? <div className="notification-archive-state"><LoaderCircle className="topbar-sync-spinner" size={20} /> Loading notifications</div>
      : notifications.length ? <div className="notification-archive-list">{notifications.map((item) => <NotificationMenuRow key={item.id} item={item} />)}</div>
        : <div className="notification-archive-state"><Bell size={22} /><strong>No notifications yet</strong><span>New updates will appear here.</span></div>}
    {hasMore && <Button type="button" variant="outline" className="notification-load-more" onClick={() => void loadMore().catch((cause) => setActionError(cause.message || "Could not load older notifications."))}>Load older notifications</Button>}
  </section>;
}

function NotificationMenuRow({ item }) {
  return <div className="notification-archive-item"><NotificationMenuRowContent item={item} /></div>;
}

function NotificationMenuRowContent({ item }) {
  const { markRead } = useNotifications();
  const [error, setError] = useState("");
  const Icon = ({ birthday: CakeIcon, "vl-credit": WalletIcon, dashboard: MegaphoneIcon, project: UsersIcon, "inbound-call": PhoneIcon, "work-schedule": CalendarIcon, "work-link": LinkIcon, "monthly-kpi": KpiIcon }[item.category]) ?? Bell;
  return <>
    <Link className="notification-archive-open" to={item.href || "/"} onClick={() => { if (!item.read_at) void markRead(item.id).catch((cause) => setError(cause.message || "Could not mark read.")); }}><span className="notification-row-icon"><Icon size={17} /></span><span className="notification-archive-copy"><strong>{item.title}</strong><span>{item.body}</span><time dateTime={item.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</time>{error && <small role="alert">{error}</small>}</span></Link>
    {!item.read_at && <Button size="sm" variant="outline" onClick={() => void markRead(item.id).catch((cause) => setError(cause.message || "Could not mark read."))}>Mark read</Button>}
  </>;
}

