import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Card, CardHeader, Spinner, Button, Badge, Flash } from "../components/ui";
import { addDaysISO, startOfWeekISO, endOfWeekISO, SCHOOL_DAYS, prettyDate, todayISO } from "../lib/format";
import { ChevronLeft, ChevronRight, Save, CheckCircle2, Lock } from "lucide-react";

type SlotStatus = "available" | "unavailable" | "class";

interface AvailabilityData {
  availability: { date: string; period: number; status: SlotStatus }[];
  schedules: { teacher_id: number; weekday: number; period: number }[];
  relief: { teacher_id: number; date: string; period: number }[];
}

interface PeriodData {
  period_count: number;
  period_names: string[];
}

const STATUS_OPTIONS: { value: SlotStatus; label: string; color: string }[] = [
  { value: "available", label: "Available", color: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200" },
  { value: "unavailable", label: "Unavailable", color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-200" },
  { value: "class", label: "Class", color: "bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-200" },
];

function getWeekdayForDate(dateISO: string): number {
  const d = new Date(dateISO + "T00:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

export default function AvailabilityCalendar() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(todayISO()));
  const [periodData, setPeriodData] = useState<PeriodData | null>(null);
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const weekEnd = endOfWeekISO(weekStart);
  const schoolDays = Array.from({ length: 5 }, (_, i) => addDaysISO(weekStart, i));

  const fetchData = useCallback(async () => {
    try {
      const [avail, periods] = await Promise.all([
        api<AvailabilityData>(`/api/availability?teacher_id=${user?.id}&from=${weekStart}&to=${weekEnd}`),
        api<PeriodData>("/api/periods"),
      ]);
      setData(avail);
      setPeriodData(periods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [user?.id, weekStart, weekEnd]);

  useEffect(() => {
    setLoading(true);
    setSaveMsg(null);
    void fetchData();
  }, [fetchData]);

  // Local edits: key = "date|period" -> status
  const [edits, setEdits] = useState<Record<string, SlotStatus>>({});

  // Build lookup maps
  const lockedSlots = new Set<string>();
  const existingAvail = new Map<string, SlotStatus>();

  if (data) {
    for (const s of data.schedules) {
      const wd = s.weekday;
      for (const day of schoolDays) {
        if (getWeekdayForDate(day) === wd) {
          lockedSlots.add(`${day}|${s.period}`);
        }
      }
    }
    for (const r of data.relief) {
      lockedSlots.add(`${r.date}|${r.period}`);
    }
    for (const a of data.availability) {
      existingAvail.set(`${a.date}|${a.period}`, a.status);
    }
  }

  function getSlotStatus(date: string, period: number): { status: SlotStatus | null; locked: boolean; source: string } {
    const key = `${date}|${period}`;
    if (edits[key] !== undefined) return { status: edits[key], locked: false, source: "edited" };
    if (lockedSlots.has(key)) return { status: null, locked: true, source: "locked" };
    if (existingAvail.has(key)) return { status: existingAvail.get(key)!, locked: false, source: "saved" };
    return { status: null, locked: false, source: "none" };
  }

  function setSlotStatus(date: string, period: number, status: SlotStatus) {
    const key = `${date}|${period}`;
    if (lockedSlots.has(key)) return;
    setEdits((prev) => ({ ...prev, [key]: status }));
    setSaveMsg(null);
  }

  function setAll(status: SlotStatus) {
    if (!periodData) return;
    const newEdits: Record<string, SlotStatus> = {};
    for (const day of schoolDays) {
      for (let p = 1; p <= periodData.period_count; p++) {
        const key = `${day}|${p}`;
        if (!lockedSlots.has(key)) {
          newEdits[key] = status;
        }
      }
    }
    setEdits(newEdits);
    setSaveMsg(null);
  }

  async function save() {
    if (!periodData || Object.keys(edits).length === 0) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      // Group edits by period for bulk API
      const periodMap: Record<string, SlotStatus> = {};
      for (const [key, status] of Object.entries(edits)) {
        const [, period] = key.split("|");
        periodMap[period] = status;
      }
      await api("/api/availability/bulk", {
        method: "POST",
        body: JSON.stringify({
          from: weekStart,
          to: weekEnd,
          periods: periodMap,
        }),
      });
      setEdits({});
      setSaveMsg("Availability saved successfully!");
      void fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data || !periodData) return <Spinner />;

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Availability Calendar</h1>
          <p className="text-sm text-muted">
            Set your availability for {prettyDate(weekStart)} — {prettyDate(weekEnd)}
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
            onClick={() => setWeekStart(startOfWeekISO(todayISO()))}
          >
            Today
          </button>
          <button
            className="p-2 rounded-lg border border-line-strong hover:bg-slate-50"
            onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
          >
            <ChevronRight size={16} />
          </button>
          <Button onClick={() => void setAll("available")} variant="outline" size="sm">All Available</Button>
          <Button onClick={() => void setAll("unavailable")} variant="outline" size="sm">All Unavailable</Button>
          <Button onClick={() => void save()} disabled={!hasEdits || saving} size="sm">
            <Save size={14} /> {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Flash error={error} />
      {saveMsg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">{saveMsg}</div>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[700px]">
          <thead>
            <tr className="bg-subtle">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted sticky left-0 bg-subtle">Period</th>
              {schoolDays.map((date, i) => {
                const isToday = date === todayISO();
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
            {Array.from({ length: periodData.period_count }, (_, p) => {
              const period = p + 1;
              return (
                <tr key={period} className="border-t border-line">
                  <td className="px-3 py-1.5 text-xs font-medium text-muted sticky left-0 bg-surface whitespace-nowrap">
                    {periodData.period_names[period - 1] ?? `Period ${period}`}
                  </td>
                  {schoolDays.map((date, i) => {
                    const { status, locked } = getSlotStatus(date, period);
                    return (
                      <td key={i} className="px-1 py-1 align-top border-t border-line">
                        {locked ? (
                          <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-100 text-slate-400 text-[10px] border border-slate-200">
                            <Lock size={10} />
                            <span>Locked</span>
                          </div>
                        ) : (
                          <div className="flex gap-0.5">
                            {STATUS_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setSlotStatus(date, period, opt.value)}
                                className={`flex-1 px-1.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors ${
                                  status === opt.value
                                    ? opt.color
                                    : "bg-white text-muted border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                {opt.label[0]}
                              </button>
                            ))}
                          </div>
                        )}
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
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 inline-block" /> Available
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Unavailable
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300 inline-block" /> Class
        </span>
        <span className="inline-flex items-center gap-1">
          <Lock size={12} className="text-slate-400" /> Locked (scheduled class or relief)
        </span>
      </div>
    </div>
  );
}
