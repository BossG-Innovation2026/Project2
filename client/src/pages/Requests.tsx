import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Absence, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, Badge, Button, Input, Select, Modal, Spinner, EmptyState, Flash } from "../components/ui";
import { prettyDate, ABSENCE_STATUS_STYLE, todayISO, addDaysISO } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { CheckCircle2, XCircle, Plus, UserPlus, ShieldAlert } from "lucide-react";

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
  schedule_before: { period: number; subject: string; class_name: string } | null;
  schedule_after: { period: number; subject: string; class_name: string } | null;
}

export default function Requests() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [matches, setMatches] = useState<Record<number, Candidate[]>>({});
  const [loadedIds, setLoadedIds] = useState<Set<number>>(new Set());
  const [candErrors, setCandErrors] = useState<Record<number, string>>({});
  const inFlight = useRef<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<{ absence: Absence; candidate: Candidate } | null>(null);
  const [assigning, setAssigning] = useState(false);

  const { data } = usePolling<{ absences: Absence[] }>(
    () => api(`/api/absences${statusFilter ? `?status=${statusFilter}` : ""}${isAdmin ? "" : "&mine=1"}`),
    15000,
    [statusFilter, refreshKey]
  );

  const { data: teachers } = usePolling<{ teachers: Teacher[] }>(
    () => api("/api/teachers"),
    60000,
    [isAdmin]
  );

  const absences = useMemo(() => {
    if (!data) return [];
    return isAdmin ? data.absences : data.absences.filter((a) => a.teacher_id === user?.id);
  }, [data, isAdmin, user]);

  async function review(id: number, status: "approved" | "declined") {
    setError(null);
    try {
      await api(`/api/absences/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  }

  async function loadCandidates(absenceId: number) {
    if (inFlight.current.has(absenceId)) return;
    inFlight.current.add(absenceId);
    setCandErrors((e) => { delete e[absenceId]; return { ...e }; });
    const timeout = new Promise<{ candidates: Candidate[] }>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), 15000)
    );
    try {
      const d = await Promise.race<{ candidates: Candidate[] }>([
        api<{ candidates: Candidate[] }>(`/api/relief/candidates/${absenceId}`),
        timeout,
      ]);
      setMatches((m) => ({ ...m, [absenceId]: d.candidates ?? [] }));
      setLoadedIds((s) => { s.add(absenceId); return new Set(s); });
    } catch (err) {
      setCandErrors((e) => ({ ...e, [absenceId]: err instanceof Error ? err.message : "Failed to load" }));
    } finally {
      inFlight.current.delete(absenceId);
    }
  }

  async function executeAssign(absenceId: number, relieverId: number) {
    setAssigning(true);
    setError(null);
    try {
      await api("/api/relief/assign", {
        method: "POST",
        body: JSON.stringify({ absence_id: absenceId, reliever_id: relieverId }),
      });
      setConfirm(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Leave Requests</h1>
          <p className="text-sm text-muted">{isAdmin ? "Review and approve teacher leaves" : "Your leave requests"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
          </Select>
          <Button onClick={() => setModalOpen(true)}>
            <Plus size={15} /> New request
          </Button>
        </div>
      </div>

      <Flash error={error} />

      <Card>
        <div className="overflow-x-auto">
          {absences.length === 0 ? (
            <EmptyState message="No leaves match this filter" />
          ) : (
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-subtle text-left text-xs font-semibold text-muted">
                  {isAdmin && <th className="px-4 py-2.5">Teacher</th>}
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Period</th>
                  <th className="px-4 py-2.5">Reason</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Reliever</th>
                  {isAdmin && <th className="px-4 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.id} className="border-t border-line hover:bg-slate-50/60">
                    {isAdmin && <td className="px-4 py-2.5 font-medium text-fg whitespace-nowrap">{a.teacher_name}</td>}
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{prettyDate(a.date)}</td>
                    <td className="px-4 py-2.5 text-muted">P{a.period}</td>
                    <td className="px-4 py-2.5 text-muted max-w-[220px] truncate">{a.reason || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge className={ABSENCE_STATUS_STYLE[a.status]}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap align-top min-w-[160px]">
                      {a.status === "approved" ? (
                        a.reliever_names ? (
                          <span className="text-fg font-medium">{a.reliever_names}</span>
                        ) : (
                          <div className="space-y-1.5">
                            {candErrors[a.id] ? (
                              <button
                                type="button"
                                onClick={() => void loadCandidates(a.id)}
                                className="text-xs text-rose-600 hover:underline"
                              >
                                Failed to load — retry
                              </button>
                            ) : !loadedIds.has(a.id) ? (
                              inFlight.current.has(a.id) ? (
                                <span className="text-xs text-dim">Loading…</span>
                              ) : (
                                <Button variant="secondary" size="sm" onClick={() => void loadCandidates(a.id)}>
                                  <UserPlus size={14} /> Load reliever
                                </Button>
                              )
                            ) : (matches[a.id] ?? []).length === 0 ? (
                              <span className="text-xs text-dim">No available relievers</span>
                            ) : (
                              <div className="space-y-1">
                                {(matches[a.id] ?? []).map((c) => (
                                  <button
                                    key={c.teacher_id}
                                    type="button"
                                    onClick={() => setConfirm({ absence: a, candidate: c })}
                                    className="block text-xs text-fg hover:text-brand-600 truncate text-left"
                                  >
                                    {c.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        {a.status === "pending" ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Button variant="success" size="sm" onClick={() => void review(a.id, "approved")}>
                              <CheckCircle2 size={14} /> Approve
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => void review(a.id, "declined")}>
                              <XCircle size={14} /> Decline
                            </Button>
                          </span>
                        ) : (
                          <span className="text-xs text-dim">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <NewRequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          setRefreshKey((k) => k + 1);
        }}
        teachers={teachers?.teachers ?? []}
        isAdmin={isAdmin}
      />

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
                <div>Workload this week: <span className="text-fg">{confirm.candidate.workload_this_week}</span></div>
                <div>Total relief periods: <span className="text-fg">{confirm.candidate.total_relief_periods}</span></div>
              </div>
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

function NewRequestModal({
  open,
  onClose,
  onCreated,
  teachers,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  teachers: Teacher[];
  isAdmin: boolean;
}) {
  const [teacherId, setTeacherId] = useState<number>(0);
  const [date, setDate] = useState(todayISO());
  const [period, setPeriod] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/absences", {
        method: "POST",
        body: JSON.stringify({
          teacher_id: isAdmin && teacherId ? teacherId : undefined,
          date,
          period,
          reason,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New leave request">
      <form onSubmit={submit} className="space-y-4">
        <Flash error={error} />
        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Teacher</label>
            <Select value={teacherId} onChange={(e) => setTeacherId(Number(e.target.value))} required>
              <option value={0}>Select teacher...</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Date</label>
            <Input type="date" value={date} min={todayISO()} max={addDaysISO(todayISO(), 60)} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Period</label>
            <Input type="number" min={1} max={24} value={period} onChange={(e) => setPeriod(Number(e.target.value))} required />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Reason</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Medical appointment" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit request"}</Button>
        </div>
      </form>
    </Modal>
  );
}