import { useMemo, useState } from "react";
import { api, type ReliefRow, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Badge, Select, Spinner, EmptyState, Flash, Button } from "../components/ui";
import { prettyDate, RELIEF_STATUS_STYLE, todayISO, addDaysISO } from "../lib/format";
import { Download } from "lucide-react";

export default function History() {
  const [teacherFilter, setTeacherFilter] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const from = addDaysISO(todayISO(), -90);
  const to = addDaysISO(todayISO(), 60);

  const params = new URLSearchParams({ from, to });
  if (teacherFilter) params.set("teacher_id", String(teacherFilter));
  if (statusFilter) params.set("status", statusFilter);

  const { data } = usePolling<{ history: ReliefRow[] }>(
    () => api(`/api/reports/history?${params}`),
    15000,
    [teacherFilter, statusFilter, refreshKey]
  );
  const { data: teachers } = usePolling<{ teachers: Teacher[] }>(() => api("/api/teachers"), 60000);

  const rows = useMemo(() => data?.history ?? [], [data]);

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Reliever Assignment History</h1>
          <p className="text-sm text-slate-500">Last 90 days · every assignment, response and override</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={teacherFilter} onChange={(e) => setTeacherFilter(Number(e.target.value))} className="w-48">
            <option value={0}>All relievers</option>
            {(teachers?.teachers ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="recommended">Recommended</option>
            <option value="assigned">Assigned</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="overridden">Overridden</option>
          </Select>
          <Button variant="secondary" onClick={() => window.open(`/api/reports/export.csv?from=${from}&to=${to}${teacherFilter ? `&teacher_id=${teacherFilter}` : ""}`, "_blank")}>
            <Download size={14} /> CSV
          </Button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Reliever</th>
              <th className="px-4 py-2.5">Teacher on leave</th>
              <th className="px-4 py-2.5">Period</th>
              <th className="px-4 py-2.5">Class</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Override</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{prettyDate(r.date)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-700">{r.reliever_name}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.absent_teacher_name}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.period}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.class_name || r.subject || "—"}</td>
                <td className="px-4 py-2.5"><Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge></td>
                <td className="px-4 py-2.5 text-slate-600">{r.is_override === 1 ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState message="No assignments in this period" />}
      </Card>
    </div>
  );
}