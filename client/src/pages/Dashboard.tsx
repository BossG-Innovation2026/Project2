import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePolling } from "../hooks/usePolling";
import { api, type Absence, type ReliefRow } from "../api";
import { Card, CardHeader, Stat, Spinner, EmptyState, Badge, Button, Input, Flash } from "../components/ui";
import { prettyDate, RELIEF_STATUS_STYLE, ABSENCE_STATUS_STYLE, todayISO } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import Calendar from "./Calendar";
import Reports from "./Reports";
import HistoryPage from "./History";
import NotificationsPage from "./Notifications";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CalendarDays, ClipboardList, LifeBuoy, CheckCircle2, XCircle, LayoutDashboard, BarChart3, History as HistoryIcon, Bell } from "lucide-react";

const PANEL_TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "history", label: "Reliever History", icon: HistoryIcon },
  { key: "notifications", label: "Notifications", icon: Bell },
];

const TAB_KEYS = PANEL_TABS.map((t) => t.key);

interface DashboardData {
  user: { id: number; name: string; role: string };
  my_absences: Absence[];
  my_assignments: (ReliefRow & { absent_teacher_name: string })[];
  upcoming_absences: (Absence & { assigned_count: number })[];
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
  const [fileForm, setFileForm] = useState({ date: todayISO(), period: 1, reason: "" });
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
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

  async function respond(id: number, status: "accepted" | "declined") {
    setRespondError(null);
    try {
      await api(`/api/relief/${id}/respond`, { method: "PUT", body: JSON.stringify({ status }) });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : "Failed to respond");
    }
  }

  async function submitAbsence(e: FormEvent) {
    e.preventDefault();
    setFileBusy(true);
    setFileError(null);
    setFileMsg(null);
    try {
      await api("/api/absences", { method: "POST", body: JSON.stringify(fileForm) });
      setFileMsg("Leave request submitted — pending admin approval.");
      setFileForm({ date: todayISO(), period: 1, reason: "" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setFileBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Welcome back, {data.user.name}</p>
      </div>

      <div className="border-b border-slate-200 flex gap-6 overflow-x-auto">
        {PANEL_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={`flex items-center gap-2 pb-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
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
              isAdmin ? (
                <Link to="/requests" className="text-xs text-brand-600 font-medium hover:underline flex items-center gap-1">
                  <ClipboardList size={14} /> Requests
                </Link>
              ) : undefined
            }
          />
          <div className="p-3">
            {data.upcoming_absences.length === 0 && <EmptyState message="No upcoming leaves" />}
            {data.upcoming_absences.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-slate-700">{a.teacher_name}</div>
                  <div className="text-xs text-slate-500">{prettyDate(a.date)} · Period {a.period}{a.reason ? ` · ${a.reason}` : ""}</div>
                </div>
                <Badge className={a.assigned_count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                  {a.assigned_count > 0 ? "Covered" : "Needs reliever"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {isAdmin ? (
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
                    <div className="text-sm font-medium text-slate-700">Cover for {r.absent_teacher_name}</div>
                    <div className="text-xs text-slate-500">{prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}</div>
                  </div>
                  <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="My relief assignments"
              subtitle="Assignments you are covering"
            />
            <div className="p-3">
              <Flash error={respondError} />
              {data.my_assignments.length === 0 && <EmptyState message="No relief assignments yet" />}
              {data.my_assignments.map((r) => {
                const actionable = r.reliever_id === user?.id && ["assigned", "recommended", "overridden"].includes(r.status);
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-700">Cover for {r.absent_teacher_name}</div>
                      <div className="text-xs text-slate-500">{prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
                      {actionable && (
                        <>
                          <Button variant="success" size="sm" onClick={() => void respond(r.id, "accepted")}>
                            <CheckCircle2 size={14} /> Accept
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => void respond(r.id, "declined")}>
                            <XCircle size={14} /> Decline
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {!isAdmin && (
        <div id="file-absence">
          <Card>
            <CardHeader
              title="File a leave"
              subtitle="Submitted requests go to the admin for approval"
              actions={<ClipboardList className="text-slate-300" size={20} />}
            />
            <form onSubmit={submitAbsence} className="p-4 space-y-3">
              <Flash error={fileError} />
              {fileMsg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">{fileMsg}</div>}
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <Input type="date" value={fileForm.date} onChange={(e) => setFileForm((f) => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Period</label>
                  <Input type="number" min={1} max={24} value={fileForm.period} onChange={(e) => setFileForm((f) => ({ ...f, period: Number(e.target.value) }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reason (optional)</label>
                  <Input value={fileForm.reason} onChange={(e) => setFileForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Sick leave, seminar" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={fileBusy}>{fileBusy ? "Submitting…" : "Submit request"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader
          title="Quick actions"
          actions={<CalendarDays className="text-slate-300" size={20} />}
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          <button type="button" onClick={() => switchTab("calendar")} className="text-left rounded-xl border border-slate-200 p-4 hover:border-brand-400 hover:shadow-sm transition-colors">
            <div className="font-medium text-sm text-slate-700">View calendar</div>
            <div className="text-xs text-slate-400 mt-1">Weekly coverage & assignments</div>
          </button>
          {isAdmin ? (
            <Link to="/requests" className="rounded-xl border border-slate-200 p-4 hover:border-brand-400 hover:shadow-sm transition-colors">
              <div className="font-medium text-sm text-slate-700">File a leave</div>
              <div className="text-xs text-slate-400 mt-1">Log a leave request</div>
            </Link>
          ) : (
            <a href="#file-absence" className="rounded-xl border border-slate-200 p-4 hover:border-brand-400 hover:shadow-sm transition-colors">
              <div className="font-medium text-sm text-slate-700">File a leave</div>
              <div className="text-xs text-slate-400 mt-1">Log a leave request</div>
            </a>
          )}
          <Link to="/availability" className="rounded-xl border border-slate-200 p-4 hover:border-brand-400 hover:shadow-sm transition-colors">
            <div className="font-medium text-sm text-slate-700">Set availability</div>
            <div className="text-xs text-slate-400 mt-1">Mark periods available/unavailable</div>
          </Link>
          <button type="button" onClick={() => switchTab("reports")} className="text-left rounded-xl border border-slate-200 p-4 hover:border-brand-400 hover:shadow-sm transition-colors">
            <div className="font-medium text-sm text-slate-700">Reports</div>
            <div className="text-xs text-slate-400 mt-1">Workload, coverage & analytics</div>
          </button>
        </div>
      </Card>
            </>
            </ErrorBoundary>
          )}
          {tab === "calendar" && <ErrorBoundary label="Calendar"><Calendar /></ErrorBoundary>}
          {tab === "reports" && <ErrorBoundary label="Reports"><Reports /></ErrorBoundary>}
          {tab === "history" && <ErrorBoundary label="Reliever History"><HistoryPage /></ErrorBoundary>}
          {tab === "notifications" && <ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>}
      </div>
    </div>
  );
}