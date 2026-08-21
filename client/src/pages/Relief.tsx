import { useMemo, useState } from "react";
import { api, type Absence, type ReliefRow, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, CardHeader, Badge, Button, Modal, Spinner, EmptyState, Flash, Select } from "../components/ui";
import { prettyDate, RELIEF_STATUS_STYLE, todayISO, addDaysISO, PERIOD_COLORS } from "../lib/format";
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
  const [assigning, setAssigning] = useState<{ absence: Absence; candidates: Candidate[] } | null>(null);
  const [override, setOverride] = useState(false);
  const [overrideTeacher, setOverrideTeacher] = useState<number>(0);

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

  if (!data || !absences) return <Spinner />;

  async function openAssign(absence: Absence) {
    setError(null);
    setOverride(false);
    setOverrideTeacher(0);
    try {
      const res = await api<{ candidates: Candidate[] }>(`/api/relief/candidates/${absence.id}`);
      setAssigning({ absence, candidates: res.candidates });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load candidates");
    }
  }

  async function assign(absenceId: number, relieverId: number, useOverride: boolean) {
    setError(null);
    try {
      await api("/api/relief/assign", {
        method: "POST",
        body: JSON.stringify({ absence_id: absenceId, reliever_id: relieverId, override: useOverride }),
      });
      setAssigning(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Assignment failed";
      setError(msg);
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
          <div className="p-3">
            {approvedAbsences.length === 0 && <EmptyState message="All approved leaves are covered" />}
            {approvedAbsences.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-fg">{a.teacher_name}</div>
                  <div className="text-xs text-muted">{prettyDate(a.date)} Â· Period {a.period}{a.reason ? ` Â· ${a.reason}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  {assignments
                    .filter((r) => r.absence_id === a.id)
                    .map((r) => (
                      <Badge key={r.id} className={RELIEF_STATUS_STYLE[r.status]}>
                        {r.reliever_name} Â· {r.status}
                      </Badge>
                    ))}
                  <Button size="sm" onClick={() => void openAssign(a)}>Match reliever</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={isAdmin ? "All assignments" : "My assignments"} subtitle="Recommended, assigned and responded" />
        <div className="p-3">
          {assignments.length === 0 && <EmptyState message="No assignments yet" />}
          {assignments.map((r) => (
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
                  {prettyDate(r.date)} Â· Period {r.period} Â· {r.class_name || r.subject || "â€”"}
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

      <Modal open={!!assigning} onClose={() => setAssigning(null)} title="Match a reliever" wide>
        {assigning && (
          <div className="space-y-4">
            <div className="rounded-lg bg-subtle p-3 text-sm">
              <span className="font-medium text-fg">{assigning.absence.teacher_name}</span>
              <span className="text-muted">
                {" "}â€” {prettyDate(assigning.absence.date)}, Period {assigning.absence.period}
                {assigning.absence.reason ? ` (${assigning.absence.reason})` : ""}
              </span>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Recommended (auto-ranked: least workload first)
              </div>
              {assigning.candidates.length === 0 && (
                <EmptyState message="No conflict-free candidates available. Use manual override." />
              )}
              <div className="space-y-2">
                {assigning.candidates.map((c) => (
                  <div key={c.teacher_id} className="rounded-lg border border-line px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg">{c.name}</div>
                        <div className="text-xs text-muted truncate">
                          {[c.department, c.subjects, c.cluster, c.room].filter(Boolean).join(" Â· ") || "â€”"}
                          {" "}Â· workload this week: {c.workload_this_week}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => void assign(assigning.absence.id, c.teacher_id, false)}>
                        Assign
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                      <div className="rounded border border-line bg-subtle px-2 py-1 min-w-0">
                        <div className="font-semibold uppercase tracking-wide text-dim">Before Â· P{assigning.absence.period - 1}</div>
                        <div className="text-muted truncate">
                          {c.schedule_before
                            ? `${c.schedule_before.subject || "â€”"}${c.schedule_before.class_name ? ` (${c.schedule_before.class_name})` : ""}`
                            : "Free"}
                        </div>
                      </div>
                      <div className="rounded border border-brand-300 bg-brand-50 px-2 py-1 min-w-0">
                        <div className="font-semibold uppercase tracking-wide text-brand-700">Relief Â· P{assigning.absence.period}</div>
                        <div className="text-muted truncate">Covering {assigning.absence.teacher_name}</div>
                      </div>
                      <div className="rounded border border-line bg-subtle px-2 py-1 min-w-0">
                        <div className="font-semibold uppercase tracking-wide text-dim">After Â· P{assigning.absence.period + 1}</div>
                        <div className="text-muted truncate">
                          {c.schedule_after
                            ? `${c.schedule_after.subject || "â€”"}${c.schedule_after.class_name ? ` (${c.schedule_after.class_name})` : ""}`
                            : "Free"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
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
                    <option value={0}>Select any teacherâ€¦</option>
                    {(teachers?.teachers ?? [])
                      .filter((t) => t.id !== assigning.absence.teacher_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    variant="secondary"
                    disabled={!overrideTeacher}
                    onClick={() => void assign(assigning.absence.id, overrideTeacher, true)}
                  >
                    Force assign
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}