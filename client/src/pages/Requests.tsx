import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Absence, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { Card, Badge, Button, Input, Select, Modal, Spinner, EmptyState, Flash } from "../components/ui";
import { prettyDate, ABSENCE_STATUS_STYLE, todayISO, addDaysISO } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { CheckCircle2, XCircle, Plus, UserPlus } from "lucide-react";

export default function Requests() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {a.status === "approved" ? (
                        a.reliever_names ? (
                          <span className="text-fg font-medium">{a.reliever_names}</span>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => navigate("/relief")}>
                            <UserPlus size={14} /> Load reliever
                          </Button>
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