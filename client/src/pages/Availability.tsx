import { Fragment, useMemo, useState } from "react";
import { api, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, Badge, Select, Spinner, Flash, Button } from "../components/ui";
import { addDaysISO, todayISO, PERIOD_COLORS, prettyDate, weekdayOf } from "../lib/format";
import { useAuth } from "../context/AuthContext";

interface AvailabilityData {
  period_count: number;
  period_names: string[];
  availability: { teacher_id: number; date: string; period: number; status: string }[];
  schedules?: { teacher_id: number; weekday: number; period: number }[];
  relief?: { teacher_id: number; date: string; period: number }[];
}

export default function Availability() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [selectedTeacher, setSelectedTeacher] = useState<number>(0);
  const [startOffset, setStartOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const teacherId = isAdmin && selectedTeacher ? selectedTeacher : user?.id ?? 0;
  const from = addDaysISO(todayISO(), startOffset);
  const to = addDaysISO(todayISO(), startOffset + 6);

  const { data, loading } = usePolling<AvailabilityData>(
    () =>
      api<AvailabilityData>(`/api/availability?teacher_id=${teacherId}&from=${from}&to=${to}`).then((d) => ({
        period_count: d.period_count ?? 8,
        period_names: d.period_names ?? [],
        availability: d.availability ?? [],
        schedules: d.schedules ?? [],
        relief: d.relief ?? [],
      })),
    10000,
    [teacherId, from]
  );

  const { data: teachers } = usePolling<{ teachers: Teacher[] }>(() => api("/api/teachers"), 60000, [isAdmin]);

  const statusMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of data?.availability ?? []) map.set(`${a.date}|${a.period}`, a.status);
    return map;
  }, [data]);

  const classSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.schedules ?? []) set.add(`${s.weekday}|${s.period}`);
    return set;
  }, [data]);

  const reliefSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.relief ?? []) set.add(`${r.date}|${r.period}`);
    return set;
  }, [data]);

  const periodNames = data?.period_names ?? Array.from({ length: data?.period_count ?? 8 }, (_, i) => `Period ${i + 1}`);

  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(from, i)).filter((d) => weekdayOf(d) < 5);

  async function setStatus(date: string, period: number, status: string) {
    setError(null);
    setSaving(`${date}|${period}`);
    try {
      await api("/api/availability", {
        method: "POST",
        body: JSON.stringify({ teacher_id: teacherId, date, period, status }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  }

  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Availability</h1>
          <p className="text-sm text-muted">Mark your periods as available or unavailable for the coming week</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setStartOffset((o) => o - 7)}>â€¹ Previous week</Button>
          <Button variant="secondary" size="sm" onClick={() => setStartOffset((o) => o + 7)}>Next week â€º</Button>
          {isAdmin && (
            <Select value={selectedTeacher} onChange={(e) => setSelectedTeacher(Number(e.target.value))} className="w-48">
              <option value={0}>My availability</option>
              {(teachers?.teachers ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <Flash error={error} />

      <Card className="overflow-x-auto">
        <div className="grid min-w-[820px]" style={{ gridTemplateColumns: `120px repeat(${days.length}, 1fr)` }}>
          <div className="bg-subtle px-3 py-2 text-xs font-semibold text-muted">Period</div>
          {days.map((d) => (
            <div key={d} className="bg-subtle px-3 py-2 text-xs text-center">
              <div className="font-semibold text-muted">{prettyDate(d)}</div>
              <div className="text-dim font-normal">{d === todayISO() ? "Today" : ""}</div>
            </div>
          ))}
          {Array.from({ length: data.period_count }, (_, p) => {
            const period = p + 1;
            return (
              <Fragment key={`row-${period}`}>
                <div className="px-3 py-2 text-xs font-medium text-muted border-t border-line flex items-center">
                  {periodNames[period - 1] ?? `Period ${period}`}
                </div>
                {days.map((d) => {
                  const isClass = classSet.has(`${weekdayOf(d)}|${period}`);
                  const isRelief = reliefSet.has(`${d}|${period}`);
                  return (
                    <div key={`${d}-${period}`} className="border-t border-line p-1.5">
                      {isClass ? (
                        <div
                          className={`w-full text-xs rounded-md border px-1.5 py-1.5 text-center font-medium ${PERIOD_COLORS.class}`}
                          title="Scheduled class â€” locked"
                        >
                          Class
                        </div>
                      ) : isRelief ? (
                        <div
                          className={`w-full text-xs rounded-md border px-1.5 py-1.5 text-center font-medium ${PERIOD_COLORS.relief}`}
                          title="Relief assignment â€” locked"
                        >
                          Relief
                        </div>
                      ) : (
                        (() => {
                          const status = statusMap.get(`${d}|${period}`) ?? "available";
                          return (
                            <select
                              value={status}
                              onChange={(e) => void setStatus(d, period, e.target.value)}
                              disabled={saving === `${d}|${period}`}
                              className={`w-full text-xs rounded-md border px-1.5 py-1.5 cursor-pointer ${PERIOD_COLORS[status]}`}
                            >
                              <option value="available">Available</option>
                              <option value="unavailable">Unavailable</option>
                            </select>
                          );
                        })()
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </Card>

      <div className="text-xs text-muted flex flex-wrap gap-3 items-center">
        <Badge className={PERIOD_COLORS.available}>Available â€” may be matched for relief</Badge>
        <Badge className={PERIOD_COLORS.unavailable}>Unavailable â€” excluded from matching</Badge>
        <Badge className={PERIOD_COLORS.class}>Class â€” scheduled (auto-locked)</Badge>
        <Badge className={PERIOD_COLORS.relief}>Relief â€” covering a leave (auto-locked)</Badge>
      </div>
    </div>
  );
}