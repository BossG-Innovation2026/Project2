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
import { CalendarDays, ClipboardList, LifeBuoy, CheckCircle2, XCircle, LayoutDashboard, BarChart3, History as HistoryIcon, Bell, X } from "lucide-react";

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
  period_count: number;
  period_names: string[];
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
  const [fileForm, setFileForm] = useState({ date: todayISO(), reason: "" });
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>([1]);
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
  const [reportsOpen, setReportsOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("tab") === "reports") {
      setReportsOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
    if (next === "reports") {
      setReportsOpen(true);
      return;
    }
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

  async function submitAbsence(e: FormEvent) {
    e.preventDefault();
    if (selectedPeriods.length === 0) return;
    setFileBusy(true);
    setFileError(null);
    setFileMsg(null);
    try {
      const res = await api<{ ids: number[]; duplicates: number[] }>("/api/absences", {
        method: "POST",
        body: JSON.stringify({ ...fileForm, periods: selectedPeriods }),
      });
      const count = res.ids.length;
      const dupCount = res.duplicates.length;
      let msg = `${count} leave request${count !== 1 ? "s" : ""} submitted — pending admin approval.`;
      if (dupCount > 0) msg += ` (${dupCount} period${dupCount !== 1 ? "s" : ""} already filed)`;
      setFileMsg(msg);
      setFileForm({ date: todayISO(), reason: "" });
      setSelectedPeriods([1]);
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Hours Relieved" value={data.relief_hours} sub="periods done" />
        <Stat label="Hours on Leave" value={data.leave_hours} sub="periods taken" />
        <Stat label="Pending leaves" value={s.pending_absences} />
        <Stat label="Leaves this week" value={s.absences_this_week} />
      </div>

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
          {tab === "file-leave" && !isAdmin && (
            <ErrorBoundary label="File a Leave">
              <Card>
                <CardHeader
                  title="File a leave"
                  subtitle="Submitted requests go to the admin for approval"
                  actions={<ClipboardList className="text-dim" size={20} />}
                />
                <form onSubmit={submitAbsence} className="p-4 space-y-3">
                  <Flash error={fileError} />
                  {fileMsg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">{fileMsg}</div>}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-fg mb-1">Date</label>
                  <Input type="date" value={fileForm.date} onChange={(e) => setFileForm((f) => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg mb-1">Reason (optional)</label>
                  <Input value={fileForm.reason} onChange={(e) => setFileForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Sick leave, seminar" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-2">Period(s)</label>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: data.period_count }, (_, i) => {
                    const period = i + 1;
                    const isSelected = selectedPeriods.includes(period);
                    const subtitle = data.period_names[i] ?? "";
                    return (
                      <button
                        key={period}
                        type="button"
                        onClick={() => {
                          setSelectedPeriods((prev) =>
                            prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period]
                          );
                        }}
                        title={subtitle}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          isSelected
                            ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:bg-brand-50"
                        }`}
                      >
                        P{period}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const all = Array.from({ length: data.period_count }, (_, i) => i + 1);
                      setSelectedPeriods((prev) => prev.length === all.length ? [] : all);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selectedPeriods.length === data.period_count
                        ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    {selectedPeriods.length === data.period_count ? "Clear All" : "Whole Day"}
                  </button>
                </div>
                {selectedPeriods.length > 0 && (
                  <div className="text-xs text-muted mt-1.5">
                    {selectedPeriods.length} period{selectedPeriods.length !== 1 ? "s" : ""} selected
                    {selectedPeriods.length < data.period_count && (
                      <span> — {data.period_count - selectedPeriods.length} remaining</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={fileBusy || selectedPeriods.length === 0}>{fileBusy ? "Submitting..." : `Submit${selectedPeriods.length > 1 ? ` (${selectedPeriods.length})` : ""}`}</Button>
              </div>
                </form>
              </Card>
            </ErrorBoundary>
          )}
          {tab === "calendar" && <ErrorBoundary label="Calendar"><Calendar /></ErrorBoundary>}
          {tab === "history" && <ErrorBoundary label="Reliever History"><HistoryPage /></ErrorBoundary>}
          {tab === "notifications" && <ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>}
      </div>

      {reportsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setReportsOpen(false)}>
          <div className="relative w-full max-w-5xl bg-canvas border-l border-line overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-canvas border-b border-line">
              <h2 className="text-lg font-bold text-fg">Reports & Analytics</h2>
              <button
                type="button"
                onClick={() => setReportsOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-hov transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <Reports />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}