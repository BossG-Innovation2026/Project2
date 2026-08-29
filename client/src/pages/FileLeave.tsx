import { useState, useEffect, type FormEvent } from "react";
import { usePolling } from "../hooks/usePolling";
import { api } from "../api";
import { Card, CardHeader, Spinner, Button, Input, Flash } from "../components/ui";
import { todayISO } from "../lib/format";
import { ClipboardList } from "lucide-react";

interface PeriodData {
  period_count: number;
  period_names: string[];
}

export default function FileLeave() {
  const [fileForm, setFileForm] = useState({ date: todayISO(), reason: "" });
  const [selectedPeriods, setSelectedPeriods] = useState<number[]>([1]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { data: periodData, loading } = usePolling<PeriodData>(() => api("/api/periods"), 60000);

  async function submitAbsence(e: FormEvent) {
    e.preventDefault();
    if (selectedPeriods.length === 0) return;
    setFileBusy(true);
    setFileError(null);
    setFileMsg(null);
    try {
      const res = await api<{ ids: number[]; duplicates: number[] }>("/api/absences", {
        method: "POST",
        body: JSON.stringify({ ...fileForm, periods: selectedPeriods }),
      });
      const count = res.ids.length;
      const dupCount = res.duplicates.length;
      let msg = `${count} leave request${count !== 1 ? "s" : ""} submitted — pending admin approval.`;
      if (dupCount > 0) msg += ` (${dupCount} period${dupCount !== 1 ? "s" : ""} already filed)`;
      setFileMsg(msg);
      setFileForm({ date: todayISO(), reason: "" });
      setSelectedPeriods([1]);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setFileBusy(false);
    }
  }

  if (loading || !periodData) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">File a Leave</h1>
        <p className="text-sm text-muted">Submit a leave request for admin approval</p>
      </div>
      <Card>
        <CardHeader
          title="New leave request"
          subtitle="Select the date and periods you need off"
          actions={<ClipboardList className="text-dim" size={20} />}
        />
        <form onSubmit={submitAbsence} className="p-4 space-y-3">
          <Flash error={fileError} />
          {fileMsg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">{fileMsg}</div>}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Date</label>
              <Input type="date" value={fileForm.date} onChange={(e) => setFileForm((f) => ({ ...f, date: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Reason (optional)</label>
              <Input value={fileForm.reason} onChange={(e) => setFileForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Sick leave, seminar" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-2">Period(s)</label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: periodData.period_count }, (_, i) => {
                const period = i + 1;
                const isSelected = selectedPeriods.includes(period);
                const subtitle = periodData.period_names[i] ?? "";
                return (
                  <button
                    key={period}
                    type="button"
                    onClick={() => {
                      setSelectedPeriods((prev) =>
                        prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period]
                      );
                    }}
                    title={subtitle}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      isSelected
                        ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    P{period}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const all = Array.from({ length: periodData.period_count }, (_, i) => i + 1);
                  setSelectedPeriods((prev) => prev.length === all.length ? [] : all);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  selectedPeriods.length === periodData.period_count
                    ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:bg-brand-50"
                }`}
              >
                {selectedPeriods.length === periodData.period_count ? "Clear All" : "Whole Day"}
              </button>
            </div>
            {selectedPeriods.length > 0 && (
              <div className="text-xs text-muted mt-1.5">
                {selectedPeriods.length} period{selectedPeriods.length !== 1 ? "s" : ""} selected
                {selectedPeriods.length < periodData.period_count && (
                  <span> — {periodData.period_count - selectedPeriods.length} remaining</span>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={fileBusy || selectedPeriods.length === 0}>{fileBusy ? "Submitting..." : `Submit${selectedPeriods.length > 1 ? ` (${selectedPeriods.length})` : ""}`}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
