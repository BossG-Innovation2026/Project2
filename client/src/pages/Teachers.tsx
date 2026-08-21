import { useMemo, useState, type FormEvent } from "react";
import { api, type Teacher } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useBrand } from "../context/BrandContext";
import { Card, CardHeader, Badge, Button, Input, Modal, Spinner, EmptyState, Flash, Select } from "../components/ui";
import { Plus, Pencil, Trash2 } from "lucide-react";

const EMPTY = {
  id: 0,
  name: "",
  email: "",
  password: "",
  department: "",
  subjects: "",
  cluster: "",
  room: "",
  max_weekly_load: 20,
  notes: "",
  active: 1,
};

export default function Teachers() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Teacher & { password?: string }) | null>(null);
  const [creating, setCreating] = useState(false);

  const { data } = usePolling<{ teachers: Teacher[] }>(
    () => api("/api/teachers"),
    15000,
    [refreshKey]
  );

  const teachers = useMemo(() => data?.teachers ?? [], [data]);
  const active = teachers.filter((t) => t.active === 1).length;

  async function remove(t: Teacher) {
    if (!confirm(`Delete ${t.name}? This removes their schedules and profile.`)) return;
    try {
      await api(`/api/teachers/${t.id}`, { method: "DELETE" });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Teachers</h1>
          <p className="text-sm text-muted">{teachers.length} teachers Â· {active} active</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> Add teacher
        </Button>
      </div>

      <Flash error={error} />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead>
            <tr className="bg-subtle text-left text-xs font-semibold text-muted">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Department</th>
              <th className="px-4 py-2.5">Specialization</th>
              <th className="px-4 py-2.5">Cluster</th>
              <th className="px-4 py-2.5">Room</th>
              <th className="px-4 py-2.5">Max load</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-line hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-fg">{t.name}</div>
                  <div className="text-xs text-dim">{t.email}</div>
                </td>
                <td className="px-4 py-2.5 text-muted">{t.department || "â€”"}</td>
                <td className="px-4 py-2.5 text-muted max-w-52 truncate">{t.subjects || "â€”"}</td>
                <td className="px-4 py-2.5 text-muted">{t.cluster || "â€”"}</td>
                <td className="px-4 py-2.5 text-muted">{t.room || "â€”"}</td>
                <td className="px-4 py-2.5 text-muted">{t.max_weekly_load}</td>
                <td className="px-4 py-2.5">
                  <Badge className={t.active === 1 ? "bg-emerald-100 text-emerald-700" : "bg-hov text-muted"}>
                    {t.active === 1 ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...t, password: "" })}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void remove(t)}>
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {teachers.length === 0 && <EmptyState message="No teachers yet â€” add the first one" />}
      </Card>

      {(creating || editing) && (
        <TeacherModal
          teacher={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function TeacherModal({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: (Teacher & { password?: string }) | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!teacher?.id;
  const { subjects: subjectOptions, departments: userDepartments } = useBrand();
  const departmentOptions =
    userDepartments.length > 0
      ? userDepartments
      : ["English", "Mathematics", "Science", "Social Studies", "Filipino", "MAPEH", "TLE", "Values Education"];
  const [form, setForm] = useState<Teacher & { password?: string }>(teacher ?? { ...EMPTY, email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customSubjects] = useState<string[]>(() => {
    const cur = (teacher?.subjects ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return cur.filter((s) => !(subjectOptions ?? []).includes(s));
  });

  const allOptions = useMemo(
    () => [...new Set([...(subjectOptions ?? []), ...customSubjects])],
    [subjectOptions, customSubjects]
  );
  const selectedSubjects = useMemo(
    () => new Set((form.subjects || "").split(",").map((s) => s.trim()).filter(Boolean)),
    [form.subjects]
  );

  function toggleSubject(s: string) {
    const next = new Set(selectedSubjects);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    set("subjects", Array.from(next).join(", "));
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { ...form, active: form.active === 1 };
      if (!payload.password) delete payload.password;
      if (isEdit) {
        await api(`/api/teachers/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/api/teachers", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${teacher?.name}` : "Add teacher"}>
      <form onSubmit={submit} className="space-y-4">
        <Flash error={error} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Full name</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Email</label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Department</label>
            <Select value={form.department} onChange={(e) => set("department", e.target.value)}>
              <option value="">â€”</option>
              {departmentOptions.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Max weekly load (periods)</label>
            <Input type="number" min={1} max={60} value={form.max_weekly_load} onChange={(e) => set("max_weekly_load", Number(e.target.value))} />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-fg mb-1">Specialization</label>
            {allOptions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allOptions.map((s) => (
                  <label
                    key={s}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm cursor-pointer transition-colors ${
                      selectedSubjects.has(s)
                        ? "bg-brand-600 border-brand-600 text-white"
                        : "bg-subtle border-line text-muted hover:border-brand-400"
                    }`}
                  >
                    <input type="checkbox" checked={selectedSubjects.has(s)} onChange={() => toggleSubject(s)} className="rounded border-line-strong" />
                    {s}
                  </label>
                ))}
              </div>
            ) : (
              <Input value={form.subjects} onChange={(e) => set("subjects", e.target.value)} placeholder="e.g. Algebra, Geometry" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Cluster</label>
            <Input value={form.cluster ?? ""} onChange={(e) => set("cluster", e.target.value)} placeholder="e.g. Cluster A" />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Room assignment</label>
            <Input value={form.room ?? ""} onChange={(e) => set("room", e.target.value)} placeholder="e.g. Rm 102" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-fg mb-1">{isEdit ? "New password (leave blank to keep)" : "Initial password"}</label>
            <Input type="password" value={form.password ?? ""} onChange={(e) => set("password", e.target.value)} minLength={isEdit ? undefined : 8} required={!isEdit} />
          </div>
          {isEdit && (
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={form.active === 1} onChange={(e) => set("active", e.target.checked ? 1 : 0)} className="rounded border-line-strong" />
                Account active
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Savingâ€¦" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}