import { useMemo, useState } from "react";
import { api, type WorkloadRow, type MySummary, type MonthlyLeaves, type ReliefBySubject, type MyWorkload } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Stat, Spinner, Button, Select, EmptyState, Flash } from "../components/ui";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { startOfWeekISO, endOfWeekISO, todayISO, addDaysISO, prettyDate } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useAuth } from "../context/AuthContext";
import { Download, FileText, LifeBuoy, Clock, AlertCircle } from "lucide-react";

const PIE_COLORS = ["#3b63f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  return isAdmin ? <AdminReports /> : <TeacherReports />;
}

function TeacherReports() {
  const { theme } = useTheme();
  const gridStroke = theme === "dark" ? "#334155" : "#e2e8f0";
  const tooltipStyle = {
    backgroundColor: "rgb(var(--surface))",
    border: "1px solid rgb(var(--line))",
    borderRadius: "8px",
    color: "rgb(var(--fg))",
    fontSize: "12px",
  };
  const [weekDate, setWeekDate] = useState(todayISO());
  const weekStart = startOfWeekISO(weekDate);
  const weekEnd = endOfWeekISO(weekDate);

  const { data: summary } = usePolling<MySummary>(() => api("/api/reports/my-summary"), 30000);
  const { data: monthly } = usePolling<MonthlyLeaves>(() => api("/api/reports/my-monthly-leaves"), 60000);
  const { data: bySubject } = usePolling<ReliefBySubject>(() => api("/api/reports/my-relief-by-subject"), 60000);
  const { data: workload } = usePolling<MyWorkload>(() => api("/api/reports/my-workload"), 30000);
  const { data: reasons, error: reasonsError } = usePolling<{ reasons: { reason: string; n: number }[] }>(
    () => api("/api/reports/absences-by-reason"), 60000
  );
  const { data: leaveHistory } = usePolling<{ history: { id: number; date: string; period: number; reason: string; status: string; created_at: string }[] }>(
    () => api(`/api/reports/history?teacher_id=${user?.id}&from=${weekStart}&to=${weekEnd}`), 30000, [weekStart, weekEnd]
  );
  const { data: reliefHistory } = usePolling<{ history: { id: number; date: string; period: number; subject: string; class_name: string; status: string; absent_teacher_name: string }[] }>(
    () => api(`/api/reports/history?teacher_id=${user?.id}&from=${weekStart}&to=${weekEnd}`), 30000, [weekStart, weekEnd]
  );

  const workloadPie = useMemo(() => {
    if (!workload) return [];
    return [
      { name: "Scheduled", value: workload.scheduled_periods, fill: "#3b63f6" },
      { name: "Relief", value: workload.relief_this_week, fill: "#10b981" },
      { name: "Available", value: workload.available, fill: "#e2e8f0" },
    ].filter((d) => d.value > 0);
  }, [workload]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">My Reports</h1>
          <p className="text-sm text-muted">Week of {prettyDate(weekStart)} — {prettyDate(weekEnd)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekDate(addDaysISO(weekDate, -7))}>‹ Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekDate(addDaysISO(weekDate, 7))}>Next ›</Button>
          <Select value={weekDate} onChange={(e) => setWeekDate(e.target.value)} className="w-44">
            {Array.from({ length: 12 }, (_, i) => addDaysISO(todayISO(), (i - 6) * 7)).map((d) => (
              <option key={d} value={d}>{prettyDate(startOfWeekISO(d))}</option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(`/api/reports/export.csv?teacher_id=${user?.id}&from=${weekStart}&to=${weekEnd}`, "_blank")}
          >
            <Download size={14} /> CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Leaves (week)" value={summary ? summary.leaves_this_week : "—"} />
        <Stat label="Relief done (week)" value={summary ? summary.relief_this_week : "—"} />
        <Stat label="Total periods load" value={summary ? summary.total_load : "—"} sub={summary ? `of ${summary.max_weekly_load} max` : undefined} />
        <Stat label="Pending leaves" value={summary ? summary.leaves_pending : "—"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total leaves filed" value={summary ? summary.leaves_all_time : "—"} sub="all time" />
        <Stat label="Total relief periods" value={summary ? summary.relief_all_time : "—"} sub="all time" />
        <Stat label="Workload %" value={summary ? `${summary.utilization}%` : "—"} />
        <Stat label="Scheduled periods" value={summary ? summary.scheduled_periods : "—"} sub="per week" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="My monthly leaves" subtitle="Approved leaves over 6 months" />
          <div className="p-4 h-72">
            {!monthly ? (
              <div className="h-full flex items-center justify-center"><Spinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly.months}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="n" name="Leaves" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="My workload breakdown" subtitle="Scheduled vs relief vs available" />
          <div className="p-4 h-72">
            {!workload ? (
              <div className="h-full flex items-center justify-center"><Spinner /></div>
            ) : workloadPie.length === 0 ? (
              <EmptyState message="No workload data" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={workloadPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label={(e) => `${e.name}: ${e.value}`}>
                    {workloadPie.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="My leave reasons" subtitle="Approved leaves by reason" />
          <div className="p-4 h-64">
            {reasonsError ? (
              <div className="h-full flex items-center justify-center text-sm text-rose-600">Failed to load</div>
            ) : !reasons ? (
              <div className="h-full flex items-center justify-center"><Spinner /></div>
            ) : reasons.reasons.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={reasons.reasons} dataKey="n" nameKey="reason" innerRadius={45} outerRadius={80} label={(e) => e.name}>
                    {reasons.reasons.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No leave data yet" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="My relief by subject" subtitle="Which subjects I cover most" />
          <div className="p-4 h-64">
            {!bySubject ? (
              <div className="h-full flex items-center justify-center"><Spinner /></div>
            ) : bySubject.subjects.length === 0 ? (
              <EmptyState message="No relief assignments yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySubject.subjects} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="subject" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} periods`, "Relief"]} contentStyle={tooltipStyle} />
                  <Bar dataKey="n" name="Relief periods" fill="#3b63f6" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="My leave history" subtitle={`Leaves filed ${prettyDate(weekStart)} — ${prettyDate(weekEnd)}`} />
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            {!leaveHistory ? (
              <div className="p-4 flex items-center justify-center"><Spinner /></div>
            ) : leaveHistory.history.length === 0 ? (
              <EmptyState message="No leaves this period" />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-subtle sticky top-0">
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2 text-center">Period</th>
                    <th className="px-4 py-2">Reason</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveHistory.history.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2">{prettyDate(r.date)}</td>
                      <td className="px-4 py-2 text-center">{r.period}</td>
                      <td className="px-4 py-2 text-muted">{r.reason || "—"}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === "approved" ? "bg-emerald-100 text-emerald-700" : r.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                        }`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="My relief history" subtitle={`Relief assignments ${prettyDate(weekStart)} — ${prettyDate(weekEnd)}`} />
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            {!reliefHistory ? (
              <div className="p-4 flex items-center justify-center"><Spinner /></div>
            ) : reliefHistory.history.length === 0 ? (
              <EmptyState message="No relief assignments this period" />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-subtle sticky top-0">
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2 text-center">Period</th>
                    <th className="px-4 py-2">Subject</th>
                    <th className="px-4 py-2">Class</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reliefHistory.history.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2">{prettyDate(r.date)}</td>
                      <td className="px-4 py-2 text-center">{r.period}</td>
                      <td className="px-4 py-2">{r.subject || "—"}</td>
                      <td className="px-4 py-2 text-muted">{r.class_name || "—"}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === "accepted" ? "bg-emerald-100 text-emerald-700" : r.status === "declined" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                        }`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function AdminReports() {
  const { theme } = useTheme();
  const gridStroke = theme === "dark" ? "#334155" : "#e2e8f0";
  const tooltipStyle = {
    backgroundColor: "rgb(var(--surface))",
    border: "1px solid rgb(var(--line))",
    borderRadius: "8px",
    color: "rgb(var(--fg))",
    fontSize: "12px",
  };
  const [weekDate, setWeekDate] = useState(todayISO());
  const weekStart = startOfWeekISO(weekDate);
  const weekEnd = endOfWeekISO(weekDate);

  const { data: workload, error: workloadError } = usePolling<{ workload: WorkloadRow[] }>(
    () => api(`/api/reports/workload?date=${weekDate}`),
    30000,
    [weekDate]
  );
  const { data: coverage, error: coverageError } = usePolling<{
    days: { date: string; absences: number; assigned: number; uncovered: number }[];
    total_absences: number;
    total_assigned: number;
    coverage_rate: number;
  }>(() => api(`/api/reports/coverage?from=${weekStart}&to=${weekEnd}`), 30000, [weekStart, weekEnd]);
  const { data: reasons, error: reasonsError } = usePolling<{ reasons: { reason: string; n: number }[] }>(
    () => api("/api/reports/absences-by-reason"),
    60000
  );

  const workloadData = useMemo(
    () =>
      (workload?.workload ?? []).map((w) => ({
        name: w.name.split(" ")[0],
        load: w.total_current,
        max: w.max_weekly_load,
        utilization: w.utilization,
      })),
    [workload]
  );

  const errors = [coverageError, workloadError, reasonsError].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Reports & Analytics</h1>
          <p className="text-sm text-muted">Week of {prettyDate(weekStart)} — {prettyDate(weekEnd)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekDate(addDaysISO(weekDate, -7))}>‹ Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekDate(addDaysISO(weekDate, 7))}>Next ›</Button>
          <Select value={weekDate} onChange={(e) => setWeekDate(e.target.value)} className="w-44">
            {Array.from({ length: 12 }, (_, i) => addDaysISO(todayISO(), (i - 6) * 7)).map((d) => (
              <option key={d} value={d}>{prettyDate(startOfWeekISO(d))}</option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(`/api/reports/export.csv?from=${weekStart}&to=${weekEnd}`, "_blank")}
          >
            <Download size={14} /> CSV
          </Button>
        </div>
      </div>

      {errors.length > 0 && <Flash error={errors.join(" · ")} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Leaves (week)" value={coverage ? coverage.total_absences : "—"} />
        <Stat label="Assignments (week)" value={coverage ? coverage.total_assigned : "—"} />
        <Stat label="Coverage rate" value={coverage ? `${coverage.coverage_rate}%` : "—"} />
        <Stat label="Teachers" value={workload ? workload.workload.length : "—"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Daily coverage" subtitle="Leaves vs. assignments" />
          <div className="p-4 h-72">
            {!coverage ? (
              <SectionState loading={!coverageError} error={coverageError} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={coverage.days}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(l: string) => prettyDate(l)} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="absences" name="Leaves" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="assigned" name="Assigned" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Teacher workload" subtitle="Scheduled + relief periods vs. max load" />
          <div className="p-4 h-72">
            {!workload ? (
              <SectionState loading={!workloadError} error={workloadError} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [`${v} periods`, n === "max" ? "Max load" : "Current load"]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="load" name="Current load" fill="#3b63f6" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="max" name="Max load" fill="#cbd5e1" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Leave reasons" subtitle="Approved leaves, all time" />
          <div className="p-4 h-64">
            {reasonsError ? (
              <div className="h-full flex items-center justify-center text-sm text-rose-600">
                Failed to load — retrying automatically...
              </div>
            ) : !reasons ? (
              <div className="h-full flex items-center justify-center">
                <Spinner />
              </div>
            ) : reasons.reasons.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={reasons.reasons} dataKey="n" nameKey="reason" innerRadius={45} outerRadius={80} label={(e) => e.name}>
                    {reasons.reasons.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No leave data yet" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Workload table" subtitle="Detailed weekly load" />
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            {!workload ? (
              <SectionState loading={!workloadError} error={workloadError} />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-subtle sticky top-0">
                  <tr className="text-left text-xs font-semibold text-muted">
                    <th className="px-4 py-2">Teacher</th>
                    <th className="px-4 py-2">Dept</th>
                    <th className="px-4 py-2 text-center">Sched</th>
                    <th className="px-4 py-2 text-center">Relief</th>
                    <th className="px-4 py-2 text-center">Total</th>
                    <th className="px-4 py-2 text-center">Max</th>
                    <th className="px-4 py-2 text-center">Load %</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.workload.map((w) => (
                    <tr key={w.teacher_id} className="border-t border-line">
                      <td className="px-4 py-2 font-medium text-fg">{w.name}</td>
                      <td className="px-4 py-2 text-muted">{w.department || "—"}</td>
                      <td className="px-4 py-2 text-center">{w.scheduled_periods}</td>
                      <td className="px-4 py-2 text-center">{w.relief_this_week}</td>
                      <td className="px-4 py-2 text-center font-medium">{w.total_current}</td>
                      <td className="px-4 py-2 text-center">{w.max_weekly_load}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          w.utilization >= 100 ? "bg-rose-100 text-rose-700" : w.utilization >= 75 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {w.utilization}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SectionState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading)
    return (
      <div className="h-full min-h-[8rem] flex items-center justify-center">
        <Spinner />
      </div>
    );
  if (error)
    return (
      <div className="h-full min-h-[8rem] flex items-center justify-center text-sm text-rose-600">
        Failed to load — retrying automatically...
      </div>
    );
  return null;
}
