import { useMemo, useState } from "react";
import { api, type CoverageCell, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Select, Spinner, Badge, Flash } from "../components/ui";
import { addDaysISO, startOfWeekISO, endOfWeekISO, SCHOOL_DAYS, PERIOD_COLORS, prettyDate } from "../lib/format";
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface CoverageData {
  period_count: number;
  period_names: string[];
  teachers: Teacher[];
  cells: CoverageCell[];
}

export default function Calendar() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(new Date().toISOString().slice(0, 10)));
  const [teacherFilter, setTeacherFilter] = useState<number | 0>(0);

  const weekEnd = endOfWeekISO(weekStart);
  const { data, loading, error } = usePolling<CoverageData>(
    () => api(`/api/availability/coverage?from=${weekStart}&to=${weekEnd}`),
    20000,
    [weekStart]
  );

  const cells = useMemo(() => {
    if (!data) return [];
    return teacherFilter ? data.cells.filter((c) => c.teacher_id === teacherFilter) : data.cells;
  }, [data, teacherFilter]);

  const showAbsent = (c: CoverageCell) => c.status === "absent";
  const needsReliever = (c: CoverageCell) =>
    c.status === "absent" && (c.assignment_status !== "assigned" && c.assignment_status !== "accepted" && c.assignment_status !== "overridden");

  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Coverage Calendar</h1>
          <p className="text-sm text-muted">
            {prettyDate(weekStart)} â€” {prettyDate(weekEnd)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-lg border border-line-strong hover:bg-slate-50"
            onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="px-3 py-2 rounded-lg border border-line-strong hover:bg-slate-50 text-sm"
            onClick={() => setWeekStart(startOfWeekISO(new Date().toISOString().slice(0, 10)))}
          >
            Today
          </button>
          <button
            className="p-2 rounded-lg border border-line-strong hover:bg-slate-50"
            onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
          >
            <ChevronRight size={16} />
          </button>
          <Select value={teacherFilter} onChange={(e) => setTeacherFilter(Number(e.target.value))} className="w-48">
            <option value={0}>All teachers</option>
            {data.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Flash error={error} />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-subtle">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted sticky left-0 bg-subtle">Period</th>
              {Array.from({ length: 5 }, (_, i) => {
                const date = addDaysISO(weekStart, i);
                const isToday = date === new Date().toISOString().slice(0, 10);
                return (
                  <th key={i} className={`px-3 py-2 text-xs font-semibold ${isToday ? "text-brand-600" : "text-muted"}`}>
                    <div>{SCHOOL_DAYS[i]}</div>
                    <div className="font-normal">{date.slice(5)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: data.period_count }, (_, p) => {
              const period = p + 1;
              return (
                <tr key={period} className="border-t border-line">
                  <td className="px-3 py-1.5 text-xs font-medium text-muted sticky left-0 bg-surface whitespace-nowrap">
                    {data.period_names[period - 1] ?? `Period ${period}`}
                  </td>
                  {Array.from({ length: 5 }, (_, i) => {
                    const date = addDaysISO(weekStart, i);
                    const dayCells = cells.filter((c) => c.period === period && c.date === date);
                    return (
                      <td key={i} className="px-1 py-1 align-top border-t border-line">
                        {dayCells.length === 0 && <div className="h-8 text-[10px] text-dim text-center">â€”</div>}
                        {dayCells.map((c) => (
                          <CellBadge key={c.teacher_id} c={c} isAdmin={user?.role === "admin"} />
                        ))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><Badge className={PERIOD_COLORS.class}>Class</Badge></span>
        <span className="inline-flex items-center gap-1"><Badge className={PERIOD_COLORS.available}>Available</Badge></span>
        <span className="inline-flex items-center gap-1"><Badge className={PERIOD_COLORS.unavailable}>Unavailable</Badge></span>
        <span className="inline-flex items-center gap-1"><Badge className={PERIOD_COLORS.absent}>On Leave</Badge></span>
        <span className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-amber-500" /> Needs reliever</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" /> Covered</span>
      </div>
    </div>
  );
}

function CellBadge({ c, isAdmin }: { c: CoverageCell; isAdmin: boolean }) {
  if (c.status === "absent") {
    const covered = ["assigned", "accepted", "overridden"].includes(c.assignment_status ?? "");
    return (
      <div
        title={`${c.teacher_name} â€” ${c.absence_reason || "leave"}${c.reliever_name ? ` Â· covered by ${c.reliever_name}` : ""}`}
        className={`rounded-md px-1.5 py-0.5 my-0.5 text-[10px] leading-tight border ${
          covered ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"
        }`}
      >
        <span className="font-medium">{c.teacher_name.split(" ").slice(-1)[0]}</span>
        <span className="opacity-70"> Â· leave</span>
        {c.reliever_name && <span className="text-emerald-600 font-medium"> â†’ {c.reliever_name.split(" ").slice(-1)[0]}</span>}
        {!covered && isAdmin && <span> âš </span>}
      </div>
    );
  }
  return (
    <div
      className={`rounded-md px-1.5 py-0.5 my-0.5 text-[10px] leading-tight border ${PERIOD_COLORS[c.status]}`}
      title={c.status === "class" ? `${c.teacher_name} â€” ${c.subject} (${c.class_name})` : `${c.teacher_name} â€” ${c.status}`}
    >
      <span className="font-medium">{c.teacher_name.split(" ").slice(-1)[0]}</span>
      {c.status === "class" && <span className="opacity-70"> Â· {c.class_name || c.subject}</span>}
    </div>
  );
}