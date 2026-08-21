export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const SCHOOL_DAYS = WEEKDAYS.slice(0, 5);

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function weekdayOf(dateISO: string): number {
  const d = parseISO(dateISO);
  return (d.getDay() + 6) % 7;
}

export function startOfWeekISO(dateISO: string): string {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() - weekdayOf(dateISO));
  return isoDate(d);
}

export function endOfWeekISO(dateISO: string): string {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + (6 - weekdayOf(dateISO)));
  return isoDate(d);
}

export function prettyDate(dateISO: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(parseISO(dateISO));
}

export function prettyDateLong(dateISO: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(parseISO(dateISO));
}

export function todayISO(): string {
  return isoDate(new Date());
}

export const PERIOD_COLORS: Record<string, string> = {
  class: "bg-indigo-100 text-indigo-800 border-indigo-200",
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  unavailable: "bg-rose-50 text-rose-700 border-rose-200",
  absent: "bg-amber-100 text-amber-800 border-amber-300",
  relief: "bg-violet-100 text-violet-800 border-violet-300",
};

export const RELIEF_STATUS_STYLE: Record<string, string> = {
  recommended: "bg-sky-100 text-sky-700",
  assigned: "bg-violet-100 text-violet-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-rose-100 text-rose-700",
  overridden: "bg-orange-100 text-orange-700",
};

export const ABSENCE_STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  declined: "bg-rose-100 text-rose-700",
};

const SUBJECT_CELL_CLASSES = [
  "bg-amber-50 border-amber-200 text-amber-900",
  "bg-emerald-50 border-emerald-200 text-emerald-900",
  "bg-sky-50 border-sky-200 text-sky-900",
  "bg-violet-50 border-violet-200 text-violet-900",
  "bg-rose-50 border-rose-200 text-rose-900",
  "bg-teal-50 border-teal-200 text-teal-900",
  "bg-orange-50 border-orange-200 text-orange-900",
  "bg-lime-50 border-lime-200 text-lime-900",
  "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-900",
  "bg-cyan-50 border-cyan-200 text-cyan-900",
  "bg-indigo-50 border-indigo-200 text-indigo-900",
  "bg-pink-50 border-pink-200 text-pink-900",
];

export function subjectCellClass(subject: string): string {
  const s = subject.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SUBJECT_CELL_CLASSES[h % SUBJECT_CELL_CLASSES.length];
}