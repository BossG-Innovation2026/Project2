import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type ScheduleRow, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useBrand } from "../context/BrandContext";
import { Card, CardHeader, Button, Input, Modal, Select, Spinner, EmptyState, Flash } from "../components/ui";
import { SCHOOL_DAYS, WEEKDAYS } from "../lib/format";
import { Trash2, Plus, Lock, LockOpen } from "lucide-react";

interface ScheduleData {
  schedules: ScheduleRow[];
  period_count: number;
}

export default function Schedules() {
  const [viewMode, setViewMode] = useState<"class" | "teacher">("class");
  const [locked, setLocked] = useState(true);
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ weekday: number; period: number; existing: ScheduleRow | null } | null>(null);
  const [freeModal, setFreeModal] = useState(false);
  const { classes: configuredClasses } = useBrand();

  const { data } = usePolling<ScheduleData>(
    () =>
      api(
        `/api/schedules${viewMode === "teacher" && teacherFilter ? `?teacher_id=${teacherFilter}` : ""}`
      ),
    15000,
    [viewMode, teacherFilter, refreshKey]
  );
  const { data: teachers } = usePolling<{ teachers: Teacher[] }>(() => api("/api/teachers"), 60000);

  const classOptions = useMemo(
    () => [...new Set(configuredClasses.map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [configuredClasses]
  );

  useEffect(() => {
    if (!classFilter && classOptions.length > 0) setClassFilter(classOptions[0]);
  }, [classFilter, classOptions]);

  const byWeekday = useMemo(() => {
    const map = new Map<number, ScheduleRow[]>();
    for (const s of data?.schedules ?? []) {
      if (!map.has(s.weekday)) map.set(s.weekday, []);
      map.get(s.weekday)!.push(s);
    }
    return map;
  }, [data]);

  const byCell = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const s of data?.schedules ?? []) {
      if (s.class_name !== classFilter) continue;
      map.set(`${s.weekday}-${s.period}`, s);
    }
    return map;
  }, [data, classFilter]);

  function handleCellClick(wd: number, p: number, existing: ScheduleRow | null) {
    if (locked) return;
    setSlot({ weekday: wd, period: p, existing });
  }

  function requestDelete(id: number) {
    deleteEntry(id);
  }

  async function deleteEntry(id: number) {
    try {
      await api(`/api/schedules/${id}`, { method: "DELETE" });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function removeTeacherEntry(id: number) {
    if (!confirm("Remove this class from the schedule?")) return;
    await deleteEntry(id);
  }

  if (!data || !teachers) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Class Schedules</h1>
          <p className="text-sm text-muted">Weekly recurring classes — used for conflict detection</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("class")}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                viewMode === "class" ? "bg-brand-600 text-white" : "text-muted hover:text-fg"
              }`}
            >
              By class
            </button>
            <button
              type="button"
              onClick={() => setViewMode("teacher")}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                viewMode === "teacher" ? "bg-brand-600 text-white" : "text-muted hover:text-fg"
              }`}
            >
              By teacher
            </button>
          </div>
          {viewMode === "class" ? (
            <>
              <button
                type="button"
                onClick={() => setLocked((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  locked
                    ? "border-line bg-surface text-muted hover:text-fg"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                {locked ? <Lock size={14} /> : <LockOpen size={14} />}
                {locked ? "Locked" : "Unlocked"}
              </button>
              <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="w-56">
                {classOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </>
          ) : (
            <>
              <Select value={teacherFilter} onChange={(e) => setTeacherFilter(Number(e.target.value))} className="w-48">
                <option value={0}>All teachers</option>
                {teachers.teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
              <Button onClick={() => setFreeModal(true)}>
                <Plus size={15} /> Add class
              </Button>
            </>
          )}
        </div>
      </div>

      <Flash error={error} />

      {viewMode === "class" &&
        (classOptions.length === 0 ? (
          <Card>
            <EmptyState message="No classes yet — define classes in Settings first." />
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={`${classFilter} · weekly timetable`}
              subtitle={
                locked
                  ? "Locked — click Unlock to edit the timetable"
                  : `Periods 1\u2013${data.period_count} · click a slot to assign or edit`
              }
            />
            <div className="p-5 overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[720px]">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-semibold uppercase tracking-wide text-dim pb-2 pr-3 w-16">Period</th>
                    {SCHOOL_DAYS.map((d) => (
                      <th key={d} className="text-left text-xs font-semibold uppercase tracking-wide text-dim pb-2 px-1.5">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: data.period_count }, (_, i) => i + 1).map((p) => (
                    <tr key={p}>
                      <td className="py-1 pr-3 text-xs font-medium text-muted whitespace-nowrap">P{p}</td>
                      {SCHOOL_DAYS.map((d, wd) => {
                        const cell = byCell.get(`${wd}-${p}`);
                        return (
                          <td key={d} className="px-1.5 py-1.5 align-top">
                            {cell ? (
                              locked ? (
                                <div className="rounded-lg border border-line bg-subtle/60 px-2.5 py-1.5">
                                  <div className="text-xs font-semibold text-fg truncate">{cell.teacher_name}</div>
                                  <div className="text-[11px] text-dim truncate">{cell.subject || "—"}</div>
                                </div>
                              ) : (
                                <div
                                  className="group relative rounded-lg border border-line bg-subtle/60 px-2.5 py-1.5 cursor-pointer hover:border-brand-400 transition-colors"
                                  onClick={() => handleCellClick(wd, p, cell)}
                                >
                                  <div className="text-xs font-semibold text-fg pr-4 truncate">{cell.teacher_name}</div>
                                  <div className="text-[11px] text-dim truncate">{cell.subject || "—"}</div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requestDelete(cell.id);
                                    }}
                                    aria-label="Remove entry"
                                    className="absolute top-1 right-1 text-dim hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )
                            ) : locked ? (
                              <div className="rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[11px] text-dim">—</div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleCellClick(wd, p, null)}
                                className="w-full rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[11px] text-dim hover:border-brand-400 hover:bg-slate-50 hover:text-brand-600 transition-colors"
                              >
                                + Assign
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

      {viewMode === "teacher" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {SCHOOL_DAYS.map((day, wd) => {
            const rows = byWeekday.get(wd) ?? [];
            return (
              <Card key={wd}>
                <CardHeader title={day} subtitle={`${rows.length} class${rows.length === 1 ? "" : "es"}`} />
                <div className="p-2">
                  {rows.length === 0 && <EmptyState message="No classes" />}
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50 group">
                      <div>
                        <div className="text-xs font-medium text-fg">
                          P{r.period} · {r.subject || "—"}
                        </div>
                        <div className="text-[11px] text-dim">{r.teacher_name}{r.class_name ? ` · ${r.class_name}` : ""}</div>
                      </div>
                      <button
                        onClick={() => void removeTeacherEntry(r.id)}
                        className="text-dim hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {slot && (
        <SlotModal
          slot={{ weekday: slot.weekday, period: slot.period }}
          existing={slot.existing}
          fixedClass={classFilter}
          teachers={teachers.teachers}
          schedules={data.schedules}
          periodCount={data.period_count}
          onClose={() => setSlot(null)}
          onSaved={() => {
            setSlot(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {freeModal && (
        <SlotModal
          slot={null}
          existing={null}
          fixedClass=""
          teachers={teachers.teachers}
          schedules={data.schedules}
          periodCount={data.period_count}
          onClose={() => setFreeModal(false)}
          onSaved={() => {
            setFreeModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function SlotModal({
  slot,
  existing,
  fixedClass,
  teachers,
  schedules,
  periodCount,
  onClose,
  onSaved,
}: {
  slot: { weekday: number; period: number } | null;
  existing: ScheduleRow | null;
  fixedClass: string;
  teachers: Teacher[];
  schedules: ScheduleRow[];
  periodCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const selectable = !slot;
  const [weekday, setWeekday] = useState(slot ? slot.weekday : 0);
  const [period, setPeriod] = useState(slot ? slot.period : 1);
  const [className, setClassName] = useState(fixedClass || "");
  const [teacherId, setTeacherId] = useState<number>(existing?.teacher_id ?? 0);
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { subjects: subjectObjects, classes: configuredClasses } = useBrand();
  const classOptions = useMemo(
    () => [...new Set(configuredClasses.map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [configuredClasses]
  );
  const subjectOptions = useMemo(() => subjectObjects.map((s) => s.name || s.code).filter(Boolean), [subjectObjects]);

  const activeTeachers = useMemo(() => teachers.filter((t) => !!t.active), [teachers]);

  const teacherOptions = useMemo(() => {
    const busy = new Set<number>();
    const load = new Map<number, number>();
    for (const s of schedules) {
      if (existing && s.id === existing.id) continue;
      load.set(s.teacher_id, (load.get(s.teacher_id) ?? 0) + 1);
      if (s.weekday === weekday && s.period === period) busy.add(s.teacher_id);
    }
    const avail = activeTeachers.filter(
      (t) => !busy.has(t.id) && (t.max_weekly_load <= 0 || (load.get(t.id) ?? 0) < t.max_weekly_load)
    );
    if (existing && !avail.some((t) => t.id === existing.teacher_id)) {
      const cur = activeTeachers.find((t) => t.id === existing.teacher_id);
      if (cur) avail.push(cur);
    }
    return avail;
  }, [schedules, weekday, period, existing, activeTeachers]);

  useEffect(() => {
    if (teacherId && !teacherOptions.some((t) => t.id === teacherId)) setTeacherId(0);
  }, [teacherOptions, teacherId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void doSave();
  }

  async function doSave() {
    setBusy(true);
    setError(null);
    try {
      if (isEdit && existing) {
        await api(`/api/schedules/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify({ teacher_id: teacherId, subject }),
        });
      } else {
        await api("/api/schedules", {
          method: "POST",
          body: JSON.stringify({ teacher_id: teacherId, weekday, period, subject, class_name: className }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/schedules/${existing.id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const contextClass = fixedClass || existing?.class_name || "";

  return (
    <>
      <Modal open onClose={onClose} title={isEdit ? "Edit time slot" : "Assign to time slot"}>
        <form onSubmit={submit} className="space-y-4">
          <Flash error={error} />
          {selectable ? (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Day</label>
                <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {SCHOOL_DAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Period</label>
                <Select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                  {Array.from({ length: periodCount }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Period {i + 1}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Class</label>
                {classOptions.length > 0 ? (
                  <Select value={className} onChange={(e) => setClassName(e.target.value)}>
                    <option value="">Select class...</option>
                    {classOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                ) : (
                  <Input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="7-A" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle border border-line px-3 py-2 text-sm text-muted">
              <span className="font-medium text-fg">{WEEKDAYS[weekday]}</span>
              <span className="text-dim">·</span>
              <span>Period {period}</span>
              {contextClass && (
                <>
                  <span className="text-dim">·</span>
                  <span className="font-medium text-fg">{contextClass}</span>
                </>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Teacher</label>
            <Select value={teacherId} onChange={(e) => setTeacherId(Number(e.target.value))} required>
              <option value={0}>
                {teacherOptions.length > 0 ? "Select teacher..." : "No teachers available"}
              </option>
              {teacherOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-dim">
              {teacherOptions.length} of {activeTeachers.length} teachers available — those already teaching at this
              time or at their weekly load cap are hidden.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Subject</label>
            {subjectOptions.length > 0 ? (
              <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Select subject...</option>
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            ) : (
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Algebra" />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            {isEdit ? (
              <button
                type="button"
                onClick={() => void doRemove()}
                disabled={busy}
                className="rounded-lg border border-rose-200 bg-surface px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors"
              >
                Remove
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !teacherId || teacherOptions.length === 0}>
                {busy ? "Saving..." : isEdit ? "Save changes" : "Assign"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
