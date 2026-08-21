import type { Teacher } from "../api";

export interface GenEntry {
  teacher_id: number;
  weekday: number;
  period: number;
  subject: string;
  class_name: string;
}

export interface Unplaced {
  class_name: string;
  subject: string;
  sessions: number;
  reason: string;
}

export interface GenerateResult {
  entries: GenEntry[];
  unplaced: Unplaced[];
}

export function parseSubjectList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fixed-period timetable generator.
 *
 * - Each subject in a class owns ONE period and keeps it on every meeting day
 *   (e.g. General Mathematics at P1 Monday-Friday), so timetables are
 *   compressed from P1 upward with no intra-day gaps by construction.
 * - Classes sharing a cluster share ONE teacher per subject; that teacher's
 *   slots are staggered across the cluster's classes.
 * - Subjects meet front-loaded days: 2 sessions -> Mon+Tue, 3 -> Mon-Wed, etc.
 * - Sessions are capped at 5 (a subject cannot meet twice in one day).
 */
export function generateTimetable(opts: {
  classes: string[];
  clusters: Record<string, string>;
  curriculum: Record<string, Record<string, number>>;
  teachers: Teacher[];
  periodCount: number;
}): GenerateResult {
  const { classes, clusters, curriculum, teachers, periodCount } = opts;
  const active = teachers.filter((t) => t.active === 1);

  const specialistPool = new Map<string, Teacher[]>();
  const specialistsOf = (subject: string): Teacher[] => {
    const key = subject.toLowerCase();
    if (!specialistPool.has(key)) {
      specialistPool.set(
        key,
        active.filter((t) => parseSubjectList(t.subjects ?? "").includes(key))
      );
    }
    return specialistPool.get(key)!;
  };

  const capOf = (t: Teacher) => (t.max_weekly_load > 0 ? t.max_weekly_load : Infinity);

  // Group classes into clusters (unclustered classes are singletons).
  const groups = new Map<string, string[]>();
  for (const cls of classes) {
    const key = clusters[cls] || `__solo__:${cls}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cls);
  }

  const entries: GenEntry[] = [];
  const unplaced: Unplaced[] = [];
  const busyTeacher = new Set<string>(); // `${teacherId}|${weekday}|${period}`
  const teacherLoad = new Map<number, number>();

  for (const memberClasses of groups.values()) {
    // Collect subject demand across the whole cluster.
    const demand = new Map<string, Map<string, number>>(); // subject -> class -> sessions
    for (const cls of memberClasses) {
      for (const [subject, raw] of Object.entries(curriculum[cls] ?? {})) {
        const n = Math.min(5, Math.max(0, Math.floor(raw || 0)));
        if (n < 1) continue;
        if (!demand.has(subject)) demand.set(subject, new Map());
        demand.get(subject)!.set(cls, n);
      }
    }

    // Bind one teacher per (cluster, subject).
    const bound = new Map<string, Teacher>(); // subject(lowercased) -> teacher
    for (const [subject, perClass] of demand) {
      const eligible = specialistsOf(subject);
      if (eligible.length === 0) {
        for (const [cls, n] of perClass) {
          unplaced.push({ class_name: cls, subject, sessions: n, reason: `No teacher specializes in ${subject}` });
        }
        continue;
      }
      const total = [...perClass.values()].reduce((a, b) => a + b, 0);
      const ranked = [...eligible].sort((a, b) => (teacherLoad.get(a.id) ?? 0) - (teacherLoad.get(b.id) ?? 0) || a.id - b.id);
      const chosen = ranked.find((t) => (teacherLoad.get(t.id) ?? 0) + total <= capOf(t));
      if (!chosen) {
        for (const [cls, n] of perClass) {
          unplaced.push({
            class_name: cls,
            subject,
            sessions: n,
            reason: `Needs ${total} sessions/week across the cluster but no specialist has that much capacity left`,
          });
        }
        continue;
      }
      bound.set(subject.toLowerCase(), chosen);
    }

    // Assign periods per class: scarcest subjects first, smallest period wins.
    for (const cls of memberClasses) {
      const usedPeriods = new Set<number>();
      const classSubjects = [...demand.keys()].sort((a, b) => {
        const da = specialistsOf(a).length - specialistsOf(b).length;
        if (da !== 0) return da;
        const na = [...demand.get(a)!.values()].reduce((x, y) => x + y, 0);
        const nb = [...demand.get(b)!.values()].reduce((x, y) => x + y, 0);
        if (na !== nb) return nb - na;
        return a.localeCompare(b);
      });

      for (const subject of classSubjects) {
        const n = demand.get(subject)!.get(cls);
        if (!n) continue; // this class does not take the subject
        const teacher = bound.get(subject.toLowerCase())!;
        const days = Array.from({ length: n }, (_, i) => i); // front-loaded

        let placed = false;
        for (let p = 1; p <= periodCount && !placed; p++) {
          if (usedPeriods.has(p)) continue;
          const free = days.every((wd) => !busyTeacher.has(`${teacher.id}|${wd}|${p}`));
          if (!free) continue;
          usedPeriods.add(p);
          placed = true;
          for (const wd of days) {
            busyTeacher.add(`${teacher.id}|${wd}|${p}`);
            entries.push({ teacher_id: teacher.id, weekday: wd, period: p, subject, class_name: cls });
          }
          teacherLoad.set(teacher.id, (teacherLoad.get(teacher.id) ?? 0) + n);
        }

        if (!placed) {
          unplaced.push({
            class_name: cls,
            subject,
            sessions: n,
            reason: "No feasible period — shared teacher is busy or the class periods are full",
          });
        }
      }
    }
  }

  // Compaction pass: re-seat each class's subjects contiguously from P1,
  // preserving relative order, so no vacant period sits between sessions.
  const byClass = new Map<string, GenEntry[]>();
  for (const e of entries) {
    if (!byClass.has(e.class_name)) byClass.set(e.class_name, []);
    byClass.get(e.class_name)!.push(e);
  }
  for (const cls of classes) {
    const list = byClass.get(cls) ?? [];
    if (list.length === 0) continue;
    const subjMap = new Map<string, { teacherId: number; days: number[]; period: number; items: GenEntry[] }>();
    for (const e of list) {
      let s = subjMap.get(e.subject);
      if (!s) {
        s = { teacherId: e.teacher_id, days: [], period: e.period, items: [] };
        subjMap.set(e.subject, s);
      }
      s.days.push(e.weekday);
      s.items.push(e);
    }
    const subjects = [...subjMap.values()].sort((a, b) => a.period - b.period);
    for (const s of subjects) {
      for (const wd of s.days) busyTeacher.delete(`${s.teacherId}|${wd}|${s.period}`);
    }
    let lastP = 0;
    for (const s of subjects) {
      let target = -1;
      for (let p = lastP + 1; p <= periodCount; p++) {
        if (s.days.every((wd) => !busyTeacher.has(`${s.teacherId}|${wd}|${p}`))) {
          target = p;
          break;
        }
      }
      if (target === -1) target = s.period;
      for (const wd of s.days) {
        busyTeacher.add(`${s.teacherId}|${wd}|${target}`);
        const item = s.items.find((i) => i.weekday === wd)!;
        item.period = target;
      }
      s.period = target;
      lastP = target;
    }
  }

  return { entries, unplaced };
}
