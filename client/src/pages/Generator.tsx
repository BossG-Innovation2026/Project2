import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Teacher } from "../api";
import { useBrand } from "../context/BrandContext";
import { Badge, Button, Card, CardHeader, EmptyState, Flash, Modal, Select, Spinner } from "../components/ui";
import { SCHOOL_DAYS, subjectCellClass } from "../lib/format";
import { generateTimetable, parseSubjectList } from "../lib/generator";
import type { GenerateResult } from "../lib/generator";

interface SettingsPayload {
  period_count: number;
}

const SUBJECT_DEFAULTS: Record<string, number> = {
  "gen-math": 5,
  "gen-sci": 5,
  "history": 5,
  "life-skills": 5,
  "language": 5,
};

function defaultSessions(subject: string): number {
  const key = subject.trim().toLowerCase();
  return SUBJECT_DEFAULTS[key] ?? 0;
}

export default function Generator() {
  const { classes, subjects, clusters } = useBrand();
  const classNames = useMemo(() => classes.map((c) => c.name).filter(Boolean), [classes]);
  const subjectNames = useMemo(() => subjects.map((s) => s.name || s.code).filter(Boolean), [subjects]);
  const [bracketSelector, setBracketSelector] = useState("");
  const [teacherOverrides, setTeacherOverrides] = useState<Record<string, Record<string, number>>>({});
  const bracketNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of classes) if (c.cluster) set.add(c.cluster);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [classes]);
  const filteredClassNames = useMemo(
    () => bracketSelector ? classNames.filter((n) => classes.find((c) => c.name === n)?.cluster === bracketSelector) : classNames,
    [classNames, bracketSelector, classes]
  );
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [periodCount, setPeriodCount] = useState(8);
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({});
  const [phase, setPhase] = useState<"setup" | "preview">("setup");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [viewClass, setViewClass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ wd: number; period: number } | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    api<{ teachers: Teacher[] }>("/api/teachers")
      .then((d) => setTeachers(d.teachers ?? []))
      .catch(() => {});
    api<SettingsPayload>("/api/settings")
      .then((d) => setPeriodCount(d.period_count ?? 8))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMatrix((m) => {
      const next: Record<string, Record<string, number>> = {};
      for (const cls of classNames) {
        next[cls] = { ...m[cls] };
        for (const s of subjectNames) if (next[cls][s] === undefined) next[cls][s] = defaultSessions(s);
      }
      return next;
    });
    setViewClass((v) => (classNames.includes(v) ? v : v || classNames[0] || ""));
  }, [classNames, subjectNames]);

  useEffect(() => {
    setTeacherOverrides((prev) => {
      const next: Record<string, Record<string, number>> = {};
      for (const bracket of bracketNames) {
        next[bracket] = { ...(prev[bracket] ?? {}) };
        for (const s of subjectNames) if (next[bracket][s] === undefined) next[bracket][s] = 0;
      }
      return next;
    });
  }, [bracketNames, subjectNames]);

  const specialistCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of subjectNames) {
      const key = s.toLowerCase();
      map.set(
        s,
        teachers.filter((t) => t.active === 1 && parseSubjectList(t.subjects ?? "").includes(key)).length
      );
    }
    return map;
  }, [subjectNames, teachers]);

  const totals = useMemo(() => {
    let sessions = 0;
    for (const cls of filteredClassNames) {
      for (const s of subjectNames) sessions += matrix[cls]?.[s] ?? 0;
    }
    return sessions;
  }, [filteredClassNames, subjectNames, matrix]);

  const weeklyCapacity = periodCount * 5;

  const overCapacity = useMemo(() => {
    return filteredClassNames
      .map((cls) => ({
        cls,
        n: subjectNames.reduce((a, s) => a + (matrix[cls]?.[s] ?? 0), 0),
      }))
      .filter((x) => x.n > weeklyCapacity);
  }, [filteredClassNames, subjectNames, matrix, weeklyCapacity]);

  const overFive = useMemo(() => {
    const found: { cls: string; subject: string; n: number }[] = [];
    for (const cls of filteredClassNames) {
      for (const s of subjectNames) {
        const v = matrix[cls]?.[s] ?? 0;
        if (v > 5) found.push({ cls, subject: s, n: v });
      }
    }
    return found;
  }, [filteredClassNames, subjectNames, matrix]);

  function setCell(cls: string, subj: string, val: number) {
    setMatrix((m) => ({
      ...m,
      [cls]: { ...(m[cls] ?? {}), [subj]: Math.max(0, Math.min(20, val || 0)) },
    }));
  }

  async function simulate() {
    setError(null);
    if (totals === 0) {
      setError("Enter at least one session in the curriculum matrix.");
      return;
    }
    setBusy(true);
    try {
      let list = teachers;
      if (list.length === 0) list = (await api<{ teachers: Teacher[] }>("/api/teachers")).teachers ?? [];
      const overrides: Record<string, number> = {};
      if (bracketSelector && teacherOverrides[bracketSelector]) {
        for (const [subj, tid] of Object.entries(teacherOverrides[bracketSelector])) {
          if (tid > 0) overrides[subj] = tid;
        }
      }
      const res = generateTimetable({
        classes: filteredClassNames,
        clusters,
        curriculum: matrix,
        teachers: list,
        periodCount,
        teacherOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      });
      setResult(res);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ ok: boolean; replaced: number }>("/api/schedules/replace-all", {
        method: "POST",
        body: JSON.stringify({ entries: result.entries }),
      });
      setApplied(result.entries.length);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const previewEntries = useMemo(() => {
    if (!result || !viewClass) return [];
    return result.entries.filter((e) => e.class_name === viewClass);
  }, [result, viewClass]);

  function handleDrop(wd: number, period: number) {
    setHoverKey(null);
    if (!drag || !result) {
      setDrag(null);
      return;
    }
    const { wd: swd, period: sp } = drag;
    setDrag(null);
    if (swd === wd && sp === period) return;
    const src = result.entries.find((e) => e.class_name === viewClass && e.weekday === swd && e.period === sp);
    if (!src) return;
    const tName = (id: number) => teacherById.get(id)?.name ?? `#${id}`;
    const dst = result.entries.find((e) => e.class_name === viewClass && e.weekday === wd && e.period === period);

    if (dst) {
      const clashA = result.entries.some(
        (x) => x !== src && x !== dst && x.teacher_id === src.teacher_id && x.weekday === wd && x.period === period
      );
      const clashB = result.entries.some(
        (x) => x !== src && x !== dst && x.teacher_id === dst.teacher_id && x.weekday === swd && x.period === sp
      );
      if (clashA || clashB) {
        setDropError(clashA ? `${tName(src.teacher_id)} is already booked ${SCHOOL_DAYS[wd]} P${period}` : `${tName(dst.teacher_id)} is already booked ${SCHOOL_DAYS[swd]} P${sp}`);
        return;
      }
      setResult({
        ...result,
        entries: result.entries.map((e) =>
          e === src ? { ...src, weekday: wd, period } : e === dst ? { ...dst, weekday: swd, period: sp } : e
        ),
      });
      setDropError(null);
      return;
    }

    const clash = result.entries.some((x) => x !== src && x.teacher_id === src.teacher_id && x.weekday === wd && x.period === period);
    if (clash) {
      setDropError(`${tName(src.teacher_id)} is already booked ${SCHOOL_DAYS[wd]} P${period}`);
      return;
    }
    const occ = new Map<number, number[]>();
    for (const e of result.entries) {
      if (e.class_name !== viewClass || e === src) continue;
      if (!occ.has(e.weekday)) occ.set(e.weekday, []);
      occ.get(e.weekday)!.push(e.period);
    }
    if (!occ.has(wd)) occ.set(wd, []);
    occ.get(wd)!.push(period);
    for (const [, ps] of occ) {
      ps.sort((a, b) => a - b);
      for (let i = 0; i < ps.length; i++) {
        if (ps[i] !== i + 1) {
          setDropError("Move rejected — periods must stay compressed with no gaps");
          return;
        }
      }
    }
    setResult({ ...result, entries: result.entries.map((e) => (e === src ? { ...src, weekday: wd, period } : e)) });
    setDropError(null);
  }

  const previewSubjects = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.entries.map((e) => e.subject))].sort((a, b) => a.localeCompare(b));
  }, [result]);

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);

  if (applied !== null) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Schedule Generator</h1>
          <p className="text-sm text-muted mt-1">Simulate a full timetable, then confirm to apply it.</p>
        </div>
        <Card className="p-10 text-center">
          <div className="text-4xl mb-3">âœ“</div>
          <h2 className="text-lg font-semibold text-fg">Timetable applied</h2>
          <p className="text-sm text-muted mt-1">
            {applied} schedule entries were written to Class Schedules.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link to="/schedules"><Button>Open Class Schedules</Button></Link>
            <Button
              variant="secondary"
              onClick={() => {
                setApplied(null);
                setResult(null);
                setPhase("setup");
              }}
            >
              Generate another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Schedule Generator</h1>
        <p className="text-sm text-muted mt-1">
          Simulate a full timetable, review it class by class, then confirm to replace Class Schedules.
        </p>
      </div>

      <Flash error={error} />

      {phase === "setup" ? (
        <Card>
          <CardHeader
            title="Curriculum matrix"
            subtitle={`Sessions per week for each class × subject · ${totals} total session${totals === 1 ? "" : "s"} entered`}
          />
          {classNames.length === 0 || subjectNames.length === 0 ? (
            <EmptyState message="Add classes and subjects in Settings first." />
          ) : (
            <>
            {bracketNames.length > 0 && (
              <div className="px-4 pt-3 flex items-center gap-3">
                <label className="text-sm font-medium text-muted">Bracket:</label>
                <Select value={bracketSelector} onChange={(e) => setBracketSelector(e.target.value)} className="w-48">
                  <option value="">All classes</option>
                  {bracketNames.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
                {bracketSelector && (
                  <span className="text-xs text-dim">{filteredClassNames.length} class{filteredClassNames.length === 1 ? "" : "es"}</span>
                )}
              </div>
            )}
            <div className="overflow-x-auto p-4 pt-0">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-3 font-medium text-muted sticky left-0 bg-surface">Class</th>
                    {subjectNames.map((s) => (
                      <th key={s} className="px-2 py-2 font-medium text-muted min-w-24">
                        <div>{s}</div>
                        <div className="text-[10px] font-normal text-dim">
                          {(specialistCount.get(s) ?? 0) > 0
                            ? `${specialistCount.get(s)} specialist${specialistCount.get(s) === 1 ? "" : "s"}`
                            : "no specialist"}
                        </div>
                      </th>
                    ))}
                  </tr>
                  {bracketSelector && (
                    <tr>
                      <th className="text-left py-1 pr-3 text-xs text-dim sticky left-0 bg-surface">Teacher</th>
                      {subjectNames.map((s) => (
                        <th key={s} className="px-1 py-1">
                          <Select
                            value={teacherOverrides[bracketSelector]?.[s] ?? 0}
                            onChange={(e) => setTeacherOverrides((prev) => ({
                              ...prev,
                              [bracketSelector]: { ...(prev[bracketSelector] ?? {}), [s]: Number(e.target.value) },
                            }))}
                            className="w-full text-[11px] py-0.5 px-1"
                          >
                            <option value={0}>Auto</option>
                            {teachers.filter((t) => t.active === 1 && parseSubjectList(t.subjects ?? "").includes(s.toLowerCase())).map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </Select>
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {filteredClassNames.map((cls) => (
                    <tr key={cls} className="border-t border-line">
                      <td className="py-2 pr-3 font-medium text-fg whitespace-nowrap sticky left-0 bg-surface">
                        {cls}
                        {clusters[cls] && (
                          <Badge className="ml-2 bg-hov text-fg border-line">{clusters[cls]}</Badge>
                        )}
                      </td>
                      {subjectNames.map((s) => (
                        <td key={s} className="px-1 py-1.5">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={matrix[cls]?.[s] ?? 0}
                            onChange={(e) => setCell(cls, s, Number(e.target.value))}
                            className={`w-full rounded-md border px-2 py-1.5 text-center ${
                              (matrix[cls]?.[s] ?? 0) > 0 && (specialistCount.get(s) ?? 0) === 0
                                ? "border-red-300 bg-red-50 text-red-700"
                                : "border-line focus:border-brand-400"
                            }`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-dim mt-3">
                Red cells have no teacher who specializes in that subject — add specializations in Teachers, or those sessions will be left unplaced.
              </p>
              {overFive.length > 0 && (
                <p className="text-xs font-medium text-amber-600 mt-2">
                  Values above 5 are capped at 5 — a subject cannot meet twice in one day ({overFive.length} cell{overFive.length === 1 ? "" : "s"} affected).
                </p>
              )}
              {overCapacity.length > 0 && (
                <div className="mt-2 space-y-1">
                  {overCapacity.map(({ cls, n }) => (
                    <p key={cls} className="text-xs font-medium text-red-500">
                      {cls}: {n} sessions but only {weeklyCapacity} weekly slots ({periodCount} periods × 5 days) — some will be left unplaced.
                    </p>
                  ))}
                </div>
              )}
            </div>
            </>
          )}
          <div className="flex justify-end gap-3 px-4 pb-4">
            <Button disabled={busy || totals === 0} onClick={() => simulate()}>
              {busy ? <Spinner label="Simulating..." /> : "Simulate timetable"}
            </Button>
          </div>
        </Card>
      ) : (
        result && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4">
                <div className="text-2xl font-bold text-emerald-600">{result.entries.length}</div>
                <div className="text-xs text-muted">sessions placed</div>
              </Card>
              <Card className="p-4">
                <div className="text-2xl font-bold text-red-500">{result.unplaced.reduce((a, u) => a + u.sessions, 0)}</div>
                <div className="text-xs text-muted">sessions unplaced</div>
              </Card>
              <Card className="p-4">
                <div className="text-2xl font-bold text-fg">{new Set(result.entries.map((e) => e.teacher_id)).size}</div>
                <div className="text-xs text-muted">teachers used</div>
              </Card>
            </div>

            {result.unplaced.length > 0 && (
              <Card>
                <CardHeader title="Unplaced sessions" subtitle="These could not fit under the hard rules — adjust loads or specializations and regenerate." />
                <ul className="divide-y divide-line">
                  {result.unplaced.map((u) => (
                    <li key={`${u.class_name}|${u.subject}`} className="px-4 py-2.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-fg">{u.class_name} · {u.subject}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-dim">×{u.sessions}</span>
                        <Badge className="bg-red-50 text-red-600 border-red-200">{u.reason}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

              <Card>
                <CardHeader
                  title="Simulated timetable"
                  subtitle="Simulation only — drag cells to move or swap. Nothing is saved until you confirm."
                  actions={
                    <Select value={viewClass} onChange={(e) => setViewClass(e.target.value)} className="w-44">
                      {classNames.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                  }
                />
                {previewSubjects.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-4 pb-1">
                    {previewSubjects.map((s) => (
                      <span key={s} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${subjectCellClass(s)}`}>
                        <span className="h-2 w-2 rounded-full bg-current opacity-60" />
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {dropError && (
                  <p className="px-4 pb-1 text-xs font-medium text-red-500">{dropError}</p>
                )}
                <div className="overflow-x-auto p-4 pt-0">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-surface z-10 w-16"></th>
                        {SCHOOL_DAYS.map((d) => (
                          <th key={d} className="py-2 px-1 text-muted font-medium">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: periodCount }, (_, i) => i + 1).map((p) => (
                        <tr key={p}>
                          <td className="sticky left-0 bg-surface z-10 font-medium text-muted py-1 pr-2 text-right align-middle">P{p}</td>
                          {SCHOOL_DAYS.map((_, wd) => {
                            const cell = previewEntries.find((e) => e.weekday === wd && e.period === p);
                            const key = `${wd}|${p}`;
                            const hovered = hoverKey === key && drag !== null;
                            return (
                              <td
                                key={wd}
                                className="p-0.5 align-top"
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setHoverKey(key);
                                }}
                                onDragLeave={() => setHoverKey((h) => (h === key ? null : h))}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  handleDrop(wd, p);
                                }}
                              >
                                {cell ? (
                                  <div
                                    draggable
                                    onDragStart={() => {
                                      setDrag({ wd, period: p });
                                      setDropError(null);
                                    }}
                                    onDragEnd={() => {
                                      setDrag(null);
                                      setHoverKey(null);
                                    }}
                                    className={`rounded-md border px-1.5 py-1 cursor-grab active:cursor-grabbing ${subjectCellClass(cell.subject)} ${
                                      hovered ? "ring-2 ring-brand-400 ring-offset-1" : ""
                                    }`}
                                  >
                                    <div className="font-medium truncate">{teacherById.get(cell.teacher_id)?.name ?? `#${cell.teacher_id}`}</div>
                                    <div className="truncate opacity-75">{cell.subject}</div>
                                  </div>
                                ) : (
                                  <div className={`rounded-md border border-dashed border-line h-full min-h-10 ${hovered ? "ring-2 ring-brand-400" : ""}`} />
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

            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={() => setPhase("setup")}>Back to matrix</Button>
              <Button disabled={result.entries.length === 0} onClick={() => setConfirmOpen(true)}>
                Confirm &amp; apply to Class Schedules
              </Button>
            </div>
          </>
        )
      )}

      {confirmOpen && (
        <Modal open onClose={() => setConfirmOpen(false)} title="Apply simulated timetable?">
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This will <strong className="text-red-600">replace the entire Class Schedules</strong> with the{" "}
              {result?.entries.length} simulated entries. The current timetable will be permanently overwritten.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button disabled={busy} onClick={apply}>
                {busy ? <Spinner label="Applying..." /> : "Yes, replace everything"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
