import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePolling } from "../hooks/usePolling";
import { api, type Absence, type ReliefRow } from "../api";
import { Card, CardHeader, Stat, Spinner, EmptyState, Badge, Button, Flash } from "../components/ui";
import { prettyDate, RELIEF_STATUS_STYLE, ABSENCE_STATUS_STYLE } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import Calendar from "./Calendar";
import HistoryPage from "./History";
import NotificationsPage from "./Notifications";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CalendarDays, ClipboardList, LifeBuoy, CheckCircle2, XCircle, LayoutDashboard, History as HistoryIcon, Bell } from "lucide-react";

const PANEL_TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "history", label: "Reliever History", icon: HistoryIcon },
  { key: "notifications", label: "Notifications", icon: Bell },
];

const TAB_KEYS = PANEL_TABS.map((t) => t.key);

interface DashboardData {
  user: { id: number; name: string; role: string };
  my_absences: Absence[];
  my_assignments: (ReliefRow & { absent_teacher_name: string })[];
  upcoming_absences: (Absence & { assigned_count: number })[];
  relief_hours: number;
  leave_hours: number;
  summary: {
    teachers: number;
    pending_absences: number;
    absences_this_week: number;
    assignments_this_week: number;
    assignments_total: number;
    absences_today: number;
    today: string;
    week_start: string;
    week_end: string;
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [respondError, setRespondError] = useState<string | null>(null);
  const { data, loading } = usePolling<DashboardData>(
    () => api("/api/dashboard"),
    30000,
    [refreshKey]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") ?? "overview";
  const tab: string = TAB_KEYS.includes(rawTab) ? rawTab : "overview";
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const d = await api<{ unread_count: number }>("/api/notifications?limit=1");
        if (alive) setUnread(d.unread_count);
      } catch {
        /* ignore */
      }
    }
    void poll();
    const t = setInterval(poll, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  function switchTab(next: string) {
    setSearchParams(next === "overview" ? {} : { tab: next }, { replace: true });
  }

  if (loading || !data) return <Spinner />;

  const s = data.summary;
  const isAdmin = user?.role === "admin";
  const pendingAssignments = data.my_assignments.filter((r) => ["assigned", "recommended", "overridden"].includes(r.status) && r.reliever_id === user?.id);
  const acceptedAssignments = data.my_assignments.filter((r) => r.status === "accepted");

  async function respond(id: number, status: "accepted" | "declined") {
    setRespondError(null);
    try {
      await api(`/api/relief/${id}/respond`, { method: "PUT", body: JSON.stringify({ status }) });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : "Failed to respond");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Dashboard</h1>
        <p className="text-sm text-muted">Welcome back, {data.user.name}</p>
      </div>

      <div className="border-b border-line flex gap-6 overflow-x-auto">
        {PANEL_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={`flex items-center gap-2 pb-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key
                ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            <Icon size={15} />
            {label}
            {key === "notifications" && unread > 0 && (
              <span className="bg-rose-500 text-white text-[10px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                {unread}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-6">
          {tab === "overview" && (
            <ErrorBoundary label="Overview">
            <>
      {isAdmin ? (
        <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Teachers" value={s.teachers} />
        <Stat label="Pending leaves" value={s.pending_absences} />
        <Stat label="Leaves this week" value={s.absences_this_week} />
        <Stat label="Relief this week" value={s.assignments_this_week} sub={`${s.assignments_total} all-time`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Upcoming leaves"
            subtitle={`${prettyDate(s.today)} — 7 days ahead`}
            actions={
              <Link to="/requests" className="text-xs text-brand-600 font-medium hover:underline flex items-center gap-1">
                <ClipboardList size={14} /> Requests
              </Link>
            }
          />
          <div className="p-3">
            {data.upcoming_absences.length === 0 && <EmptyState message="No upcoming leaves" />}
            {data.upcoming_absences.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-fg">{a.teacher_name}</div>
                  <div className="text-xs text-muted">{prettyDate(a.date)} · Period {a.period}{a.reason ? ` · ${a.reason}` : ""}</div>
                </div>
                <Badge className={a.assigned_count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                  {a.assigned_count > 0 ? "Covered" : "Needs reliever"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="My relief workload"
            subtitle="Your accepted & pending assignments"
            actions={
              <Link to="/relief" className="text-xs text-brand-600 font-medium hover:underline flex items-center gap-1">
                <LifeBuoy size={14} /> Finder
              </Link>
            }
          />
          <div className="p-3">
            {data.my_assignments.length === 0 && <EmptyState message="No relief assignments yet" />}
            {data.my_assignments.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-fg">Cover for {r.absent_teacher_name}</div>
                  <div className="text-xs text-muted">{prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}</div>
                </div>
                <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
        </>
      ) : (
        <>
      {pendingAssignments.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <LifeBuoy size={20} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Relief assignment offer pending</p>
            <p className="text-sm text-amber-700">You have {pendingAssignments.length} pending relief {pendingAssignments.length === 1 ? "assignment" : "assignments"} waiting for your response.</p>
          </div>
        </div>
      )}
      {data.my_absences.some((a) => a.status === "approved") && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Leave request approved</p>
            <p className="text-sm text-emerald-700">Your leave {data.my_absences.filter((a) => a.status === "approved").length === 1 ? "request has" : "requests have"} been approved.</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Pending relief requests"
            subtitle="Assignments awaiting your response"
          />
          <div className="p-3">
            <Flash error={respondError} />
            {pendingAssignments.length === 0 && <EmptyState message="No pending relief requests" />}
            {pendingAssignments.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-fg">Cover for {r.absent_teacher_name}</div>
                  <div className="text-xs text-muted">{prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
                  <Button variant="success" size="sm" onClick={() => void respond(r.id, "accepted")}>
                    <CheckCircle2 size={14} /> Accept
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void respond(r.id, "declined")}>
                    <XCircle size={14} /> Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="My accepted assignments"
            subtitle="Relief duties you've accepted"
          />
          <div className="p-3">
            {acceptedAssignments.length === 0 && <EmptyState message="No accepted assignments" />}
            {acceptedAssignments.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-fg">Cover for {r.absent_teacher_name}</div>
                  <div className="text-xs text-muted">{prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}</div>
                </div>
                <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Upcoming leaves"
            subtitle="Your approved absences"
          />
          <div className="p-3">
            {data.my_absences.length === 0 && <EmptyState message="No upcoming leaves" />}
            {data.my_absences.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-fg">{prettyDate(a.date)}</div>
                  <div className="text-xs text-muted">Period {a.period}{a.reason ? ` · ${a.reason}` : ""}</div>
                </div>
                <Badge className={ABSENCE_STATUS_STYLE[a.status]}>{a.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
        </>
      )}

            </>
            </ErrorBoundary>
          )}
          {tab === "calendar" && <ErrorBoundary label="Calendar"><Calendar /></ErrorBoundary>}
          {tab === "history" && <ErrorBoundary label="Reliever History"><HistoryPage /></ErrorBoundary>}
          {tab === "notifications" && <ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>}
      </div>
    </div>
  );
}