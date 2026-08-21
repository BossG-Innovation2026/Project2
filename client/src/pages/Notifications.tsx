import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Notification } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Badge, Spinner, EmptyState, Button } from "../components/ui";
import { prettyDateLong } from "../lib/format";
import { CheckCheck } from "lucide-react";

const TYPE_STYLE: Record<string, string> = {
  relief_assignment: "bg-violet-100 text-violet-700",
  relief_accepted: "bg-emerald-100 text-emerald-700",
  relief_declined: "bg-rose-100 text-rose-700",
  relief_assigned: "bg-sky-100 text-sky-700",
  absence_request: "bg-amber-100 text-amber-700",
  absence_approved: "bg-emerald-100 text-emerald-700",
  absence_declined: "bg-rose-100 text-rose-700",
  daily_summary: "bg-hov text-muted",
};

export default function NotificationsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data } = usePolling<{ notifications: Notification[]; unread_count: number }>(
    () => api("/api/notifications?limit=100"),
    15000,
    [refreshKey]
  );

  const items = useMemo(() => data?.notifications ?? [], [data]);

  async function markRead(id: number) {
    await api(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setRefreshKey((k) => k + 1);
  }

  async function readAll() {
    await api("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    setRefreshKey((k) => k + 1);
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Notifications</h1>
          <p className="text-sm text-muted">{data.unread_count} unread</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void readAll()}>
          <CheckCheck size={14} /> Mark all read
        </Button>
      </div>

      <Card>
        {items.length === 0 && <EmptyState message="No notifications yet" />}
        {items.map((n) => (
          <div
            key={n.id}
            className={`px-5 py-3 border-b border-slate-50 last:border-0 flex items-start gap-3 ${n.is_read ? "opacity-60" : ""}`}
            onClick={() => !n.is_read && void markRead(n.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge className={TYPE_STYLE[n.type] ?? "bg-hov text-muted"}>{n.type.replace(/_/g, " ")}</Badge>
                {!n.is_read && <span className="h-2 w-2 rounded-full bg-brand-600" />}
              </div>
              <p className="text-sm text-fg mt-1.5">{n.message}</p>
              <div className="text-xs text-dim mt-1">{prettyDateLong(n.created_at.slice(0, 10))}</div>
              {n.link && (
                <Link to={n.link} className="text-xs text-brand-600 font-medium hover:underline mt-1 inline-block">
                  View â†’
                </Link>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}