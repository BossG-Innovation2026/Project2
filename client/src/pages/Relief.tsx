import { useEffect, useMemo, useState } from "react";
import { api, type Absence, type ReliefRow, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Badge, Button, Modal, Spinner, EmptyState, Flash, Select } from "../components/ui";
import { prettyDate, RELIEF_STATUS_STYLE, todayISO, addDaysISO } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { CheckCircle2, XCircle, ShieldAlert, RefreshCw } from "lucide-react";

interface AdjacentClass {
  period: number;
  subject: string;
  class_name: string;
}

interface Candidate {
  teacher_id: number;
  name: string;
  email: string;
  department: string;
  subjects: string;
  cluster: string;
  room: string;
  workload_this_week: number;
  total_relief_periods: number;
  score: number;
  schedule_before: AdjacentClass | null;
  schedule_after: AdjacentClass | null;
}

export default function Relief() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ absence: Absence; candidate: Candidate } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [override, setOverride] = useState(false);
  const [overrideTeacher, setOverrideTeacher] = useState<number>(0);
  const [matches, setMatches] = useState<Record<number, Candidate[]>>({});

  const { data } = usePolling<{ assignments: ReliefRow[] }>(
    () => api(`/api/relief${isAdmin ? "" : "?mine=1"}`),
    10000,
    [refreshKey, isAdmin]
  );
  const { data: teachers } = usePolling<{ teachers: Teacher[] }>(
    () => api("/api/teachers"),
    60000
  );
  const { data: absences } = usePolling<{ absences: Absence[] }>(
    () => api("/api/absences?status=approved&from=" + todayISO() + "&to=" + addDaysISO(todayISO(), 60)),
    30000,
    [refreshKey]
  );

  const assignments = useMemo(() => data?.assignments ?? [], [data]);
  const approvedAbsences = useMemo(() => {
    const uncovered = (absences?.absences ?? []).filter((a) => {
      const hasActive = assignments.some(
        (r) => r.absence_id === a.id && ["assigned", "accepted", "overridden"].includes(r.status)
      );
      return !hasActive;
    });
    return uncovered;
  }, [absences, assignments]);

  useEffect(() => {
    if (!isAdmin || approvedAbsences.length === 0) return;
    let alive = true;
    for (const a of approvedAbsences) {
      api<{ candidates: Candidate[] }>(`/api/relief/candidates/${a.id}`)
        .then((d) => { if (alive) setMatches((m) => ({ ...m, [a.id]: d.candidates ?? [] })); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [approvedAbsences, isAdmin, refreshKey]);

  async function confirmAssign(absence: Absence, candidate: Candidate) {
    setConfirm({ absence, candidate });
  }

  async function executeAssign(absenceId: number, relieverId: number) {
    setAssigning(true);
    setError(null);
    try {
      await api("/api/relief/assign", {
        method: "POST",
        body: JSON.stringify({ absence_id: absenceId, reliever_id: relieverId, override: override && relieverId > 0 }),
      });
      setConfirm(null);
      setOverride(false);
      setOverrideTeacher(0);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  async function respond(id: number, status: "accepted" | "declined") {
    setError(null);
    try {
      await api(`/api/relief/${id}/respond`, { method: "PUT", body: JSON.stringify({ status }) });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to respond");
    }
  }

  if (!data || !absences) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Reliever Finder</h1>
          <p className="text-sm text-muted">
            {isAdmin ? "Assign relievers to approved leaves" : "Your relief assignments and invitations"}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <Flash error={error} />

      {isAdmin && (
        <Card>
          <CardHeader title="Needs a reliever" subtitle="Approved leaves without a confirmed reliever (next 60 days)" />
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {approvedAbsences.length === 0 && <div className="col-span-full"><EmptyState message="All approved leaves are covered" /></div>}
            {approvedAbsences.map((a) => {
              const cands = matches[a.id] ?? [];
              return (
                <div key={a.id} className="rounded-lg border border-line bg-surface overflow-hidden">
                  <div className="px-3 py-2 bg-subtle border-b border-line">
                    <div className="text-xs font-semibold text-fg truncate">{a.teacher_name}</div>
                    <div className="text-[11px] text-muted truncate">{prettyDate(a.date)} · P{a.period}</div>
                    {a.reason && <div className="text-[10px] text-dim truncate">{a.reason}</div>}
                  </div>

                  <div className="px-3 py-2">
                    {cands.length === 0 ? (
                      <div className="text-[11px] text-dim">Loading…</div>
                    ) : (
                      <>
                        <div className="text-[10px] font-semibold text-dim uppercase tracking-wide mb-1.5">Recommended</div>
                        <div className="space-y-1">
                          {cands.map((c) => (
                            <button
                              key={c.teacher_id}
                              type="button"
                              onClick={() => confirmAssign(a, c)}
                              className="w-full text-left text-xs text-fg hover:text-brand-600 truncate"
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={isAdmin ? "All assignments" : "My assignments"} subtitle="Recommended, assigned and responded" />
        <div className="p-3">
          {assignments.filter((r) => r.status !== "recommended").length === 0 && <EmptyState message="No assignments yet" />}
          {assignments.filter((r) => r.status !== "recommended").map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-50 last:border-0">
              <div>
                <div className="text-sm font-medium text-fg">
                  {r.reliever_name} covers {r.absent_teacher_name}
                  {r.is_override === 1 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-orange-600 text-xs">
                      <ShieldAlert size={12} /> override
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {prettyDate(r.date)} · Period {r.period} · {r.class_name || r.subject || "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={RELIEF_STATUS_STYLE[r.status]}>{r.status}</Badge>
                {!isAdmin && r.reliever_id === user?.id && ["assigned", "recommended", "overridden"].includes(r.status) && (
                  <>
                    <Button variant="success" size="sm" onClick={() => void respond(r.id, "accepted")}>
                      <CheckCircle2 size={14} /> Accept
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void respond(r.id, "declined")}>
                      <XCircle size={14} /> Decline
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={`Assign reliever to ${confirm.absence.teacher_name}`}>
          <div className="space-y-4">
            <div className="rounded-lg bg-subtle p-3 text-sm">
              <span className="font-medium text-fg">{confirm.candidate.name}</span>
              <span className="text-muted">
                {" "}— {prettyDate(confirm.absence.date)}, Period {confirm.absence.period}
                {confirm.absence.reason ? ` (${confirm.absence.reason})` : ""}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <div className="rounded border border-line bg-subtle px-2 py-1 min-w-0">
                <div className="font-semibold uppercase tracking-wide text-dim">Before · P{confirm.absence.period - 1}</div>
                <div className="text-muted truncate">
                  {confirm.candidate.schedule_before
                    ? `${confirm.candidate.schedule_before.subject || "—"}${confirm.candidate.schedule_before.class_name ? ` (${confirm.candidate.schedule_before.class_name})` : ""}`
                    : "Free"}
                </div>
              </div>
              <div className="rounded border border-brand-300 bg-brand-50 px-2 py-1 min-w-0">
                <div className="font-semibold uppercase tracking-wide text-brand-700">Relief · P{confirm.absence.period}</div>
                <div className="text-muted truncate">Covering {confirm.absence.teacher_name}</div>
              </div>
              <div className="rounded border border-line bg-subtle px-2 py-1 min-w-0">
                <div className="font-semibold uppercase tracking-wide text-dim">After · P{confirm.absence.period + 1}</div>
                <div className="text-muted truncate">
                  {confirm.candidate.schedule_after
                    ? `${confirm.candidate.schedule_after.subject || "—"}${confirm.candidate.schedule_after.class_name ? ` (${confirm.candidate.schedule_after.class_name})` : ""}`
                    : "Free"}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-line px-4 py-3">
              <div className="text-xs text-muted space-y-1">
                <div>Department: <span className="text-fg">{confirm.candidate.department || "—"}</span></div>
                <div>Subjects: <span className="text-fg">{confirm.candidate.subjects || "—"}</span></div>
                <div>Cluster: <span className="text-fg">{confirm.candidate.cluster || "—"}</span></div>
                <div>Room: <span className="text-fg">{confirm.candidate.room || "—"}</span></div>
                <div>Workload this week: <span className="text-fg">{confirm.candidate.workload_this_week}</span></div>
                <div>Total relief periods: <span className="text-fg">{confirm.candidate.total_relief_periods}</span></div>
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="override"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="rounded border-line-strong"
                />
                <label htmlFor="override" className="text-sm text-fg inline-flex items-center gap-1">
                  <ShieldAlert size={14} className="text-orange-500" /> Manual override (bypasses conflict checks)
                </label>
              </div>
              {override && (
                <div className="flex items-center gap-2">
                  <Select value={overrideTeacher} onChange={(e) => setOverrideTeacher(Number(e.target.value))} className="flex-1">
                    <option value={0}>Select any teacher...</option>
                    {(teachers?.teachers ?? [])
                      .filter((t) => t.id !== confirm.absence.teacher_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </Select>
                  <Button
                    variant="secondary"
                    disabled={!overrideTeacher}
                    onClick={() => void executeAssign(confirm.absence.id, overrideTeacher)}
                  >
                    Force assign
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button disabled={assigning} onClick={() => void executeAssign(confirm.absence.id, confirm.candidate.teacher_id)}>
                {assigning ? "Assigning..." : "Confirm assignment"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}