export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function weekdayOf(dateISO: string): number {
  return (new Date(`${dateISO}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

export function endOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (6 - wd));
  return d.toISOString().slice(0, 10);
}

export function isValidDate(dateISO: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateISO) && !isNaN(new Date(`${dateISO}T00:00:00Z`).getTime());
}

export function nowISO(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}