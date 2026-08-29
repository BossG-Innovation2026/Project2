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
import Reports from "./Reports";
import FileLeave from "./FileLeave";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ClipboardList, LifeBuoy, CheckCircle2, XCircle, LayoutDashboard, BarChart3, FileDown, X } from "lucide-react";

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

const PANEL_TABS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "leave", label: "File a leave", icon: FileDown },
];

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
  const rawPanel = searchParams.get("panel");
  const panel: string | null =
    rawPanel === "reports" || rawPanel === "leave" || rawPanel === "dashboard" ? rawPanel : null;
  const [panelTab, setPanelTab] = useState(panel ?? "dashboard");

  useEffect(() => {
    if (panel) setPanelTab(panel);
  }, [panel]);

  function closePanel() {
    setSearchParams({}, { replace: true });
  }

  function switchPanelTab(tab: string) {
    setPanelTab(tab);
    setSearchParams({ panel: tab }, { replace: true });
  }

  if (loading || !data) return <Spinner />;

  const s = data.summary;
  const isAdmin = user?.role === "admin";
  const pendingAssignments = data.my_assignments.filter((r) => ["assigned", "recommended", "overridden"].includes(r.status));
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
    <>
      <div className="space-y-6">
        {!isAdmin && pendingAssignments.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <LifeBuoy size={20} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Relief assignment offer pending</p>
              <p className="text-sm text-amber-700">You have {pendingAssignments.length} pending relief {pendingAssignments.length === 1 ? "assignment" : "assignments"} waiting for your response.</p>
            </div>
          </div>
        )}
        {!isAdmin && data.my_absences.some((a) => a.status === "approved") && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">Leave request approved</p>
              <p className="text-sm text-emerald-700">Your leave {data.my_absences.filter((a) => a.status === "approved").length === 1 ? "request has" : "requests have"} been approved.</p>
            </div>
          </div>
        )}

        <div>
          <h1 className="text-xl font-bold text-fg">Dashboard</h1>
          <p className="text-sm text-muted">Welcome back, {data.user.name}</p>
        </div>

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

        {!isAdmin && (
          <>
            <ErrorBoundary label="Calendar"><Calendar /></ErrorBoundary>
            <ErrorBoundary label="Reliever History"><HistoryPage /></ErrorBoundary>
            <ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>
          </>
        )}
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closePanel} />
          <div className="relative w-full max-w-5xl bg-canvas border-l border-line overflow-y-auto shadow-2xl animate-slide-in-right">
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-canvas border-b border-line">
              <div className="flex gap-1">
                {PANEL_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => switchPanelTab(key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      panelTab === key
                        ? "bg-brand-600 text-white"
                        : "text-muted hover:text-fg hover:bg-hov"
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-hov transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {panelTab === "dashboard" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-xl font-bold text-fg">Dashboard</h1>
                    <p className="text-sm text-muted">Welcome back, {data.user.name}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Teachers" value={s.teachers} />
                    <Stat label="Pending leaves" value={s.pending_absences} />
                    <Stat label="Leaves this week" value={s.absences_this_week} />
                    <Stat label="Relief this week" value={s.assignments_this_week} sub={`${s.assignments_total} all-time`} />
                  </div>
                  <div className="grid lg:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader title="Upcoming leaves" subtitle={`${prettyDate(s.today)} — 7 days ahead`} />
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
                      <CardHeader title="My relief assignments" subtitle="Your accepted & pending assignments" />
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
                </div>
              )}
              {panelTab === "reports" && (
                <ErrorBoundary label="Reports">
                  <Reports />
                </ErrorBoundary>
              )}
              {panelTab === "leave" && (
                <ErrorBoundary label="File a leave">
                  <FileLeave />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
