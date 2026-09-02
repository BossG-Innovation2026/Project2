import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api, type Teacher } from "../api";
import { assetUrl, useBrand, type ClassEntry, type Subject } from "../context/BrandContext";
import { Card, CardHeader, Button, Input, Spinner, Flash, EmptyState, Modal, Badge } from "../components/ui";
import { Upload, Trash2, Plus, Pencil, Eye, EyeOff } from "lucide-react";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function AssetUploadRow({
  name,
  label,
  hint,
  current,
  version,
  previewClass,
}: {
  name: "logo" | "background";
  label: string;
  hint: string;
  current: boolean;
  version: number;
  previewClass: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { refreshAssets } = useBrand();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSaved(false);
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Only PNG, JPEG, WebP or SVG images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/api/assets/${name}`, { method: "PUT", body: fd });
      refreshAssets();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${label.toLowerCase()}?`)) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/assets/${name}`, { method: "DELETE" });
      refreshAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium text-fg">{label}</div>
          <div className="text-xs text-dim mt-0.5">{hint}</div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={onFile} />
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} /> {current ? "Replace" : "Upload"}
          </Button>
          {current && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-surface px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
      </div>
      {error && <Flash error={error} />}
      {saved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Saved.</div>}
      {current ? (
        <img src={assetUrl(name, version)} alt={label} className={previewClass} />
      ) : (
        <div className={`flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-dim ${previewClass}`}>
          No image uploaded yet
        </div>
      )}
    </div>
  );
}

interface SettingsData {
  period_count: number;
  period_names: string[];
  school_name: string;
  school_year: string;
  system_name: string;
  system_tagline: string;
  subjects: Subject[];
  departments: string[];
  classes: ClassEntry[];
  clusters?: Record<string, string>;
}

function SubjectTableEditor({
  subjects,
  onSubjectsChange,
  onSave,
}: {
  subjects: Subject[];
  onSubjectsChange: (subjects: Subject[]) => void;
  onSave: (list?: Subject[]) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<{ index: number; subject: Subject } | null>(null);
  const [creating, setCreating] = useState(false);

  async function remove(index: number) {
    if (!confirm("Delete this subject?")) return;
    const next = subjects.filter((_, i) => i !== index);
    onSubjectsChange(next);
    setSaved(false);
    try {
      await onSave(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <>
      <Card className="overflow-x-auto">
        <CardHeader
          title="Subjects"
          subtitle="Define subject codes, names and descriptions for the curriculum"
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add subject
            </Button>
          }
        />
        <Flash error={error} />
        {saved && <div className="mx-5 mt-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Subjects saved.</div>}
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-muted">
              <th className="px-5 py-2.5">Code</th>
              <th className="px-5 py-2.5">Subject Name</th>
              <th className="px-5 py-2.5">Description</th>
              <th className="px-5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s, i) => (
              <tr key={i} className="border-t border-line/50 hover:bg-hov/50">
                <td className="px-5 py-2.5 font-medium text-fg">{s.code || "�"}</td>
                <td className="px-5 py-2.5 text-muted">{s.name || "�"}</td>
                <td className="px-5 py-2.5 text-muted max-w-64 truncate">{s.description || "�"}</td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ index: i, subject: { ...s } })}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void remove(i)}>
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {subjects.length === 0 && <div className="px-5 pb-5"><EmptyState message="No subjects defined yet � add the first one" /></div>}
      </Card>

      {(creating || editing) && (
        <SubjectEditModal
          subject={editing?.subject ?? null}
          subjects={subjects}
          editingIndex={editing?.index ?? null}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(s) => {
            setCreating(false);
            setEditing(null);
            if (editing) {
              const next = [...subjects];
              next[editing.index] = s;
              onSubjectsChange(next);
            } else {
              onSubjectsChange([...subjects, s]);
            }
            setSaved(true);
          }}
          onSave={onSave}
        />
      )}
    </>
  );
}

function SubjectEditModal({
  subject,
  subjects,
  editingIndex,
  onClose,
  onSaved,
  onSave,
}: {
  subject: Subject | null;
  subjects: Subject[];
  editingIndex: number | null;
  onClose: () => void;
  onSaved: (s: Subject) => void;
  onSave: (list?: Subject[]) => Promise<void>;
}) {
  const isEdit = subject !== null;
  const [form, setForm] = useState<Subject>(subject ?? { code: "", name: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code && !name) {
      setError("Subject code or name is required.");
      return;
    }
    const final = { ...form, code, name };
    setBusy(true);
    setError(null);
    try {
      let next: Subject[];
      if (isEdit && editingIndex !== null) {
        next = [...subjects];
        next[editingIndex] = final;
      } else {
        next = [...subjects, final];
      }
      await onSave(next);
      onSaved(final);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit subject" : "Add subject"}>
      <form onSubmit={submit} className="space-y-4">
        <Flash error={error} />
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Subject Code</label>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. MATH1" maxLength={20} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Subject Name</label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Algebra" maxLength={60} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Description</label>
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Introduction to algebraic expressions" maxLength={200} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ClassTableEditor({
  classes,
  onClassesChange,
  onSave,
}: {
  classes: ClassEntry[];
  onClassesChange: (classes: ClassEntry[]) => void;
  onSave: (classes: ClassEntry[]) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<{ index: number; entry: ClassEntry } | null>(null);
  const [creating, setCreating] = useState(false);

  async function remove(index: number) {
    if (!confirm("Delete this class?")) return;
    const next = classes.filter((_, i) => i !== index);
    onClassesChange(next);
    setSaved(false);
    try {
      await onSave(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <>
      <Card className="overflow-x-auto">
        <CardHeader
          title="Classes"
          subtitle="Class name, grade level, bracket/cluster grouping and room number"
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add class
            </Button>
          }
        />
        <Flash error={error} />
        {saved && <div className="mx-5 mt-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Classes saved.</div>}
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-muted">
              <th className="px-5 py-2.5">Class Name</th>
              <th className="px-5 py-2.5">Grade Level</th>
              <th className="px-5 py-2.5">Bracket/Cluster</th>
              <th className="px-5 py-2.5">Room Number</th>
              <th className="px-5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c, i) => (
              <tr key={c.name} className="border-t border-line/50 hover:bg-hov/50">
                <td className="px-5 py-2.5 font-medium text-fg">{c.name || "�"}</td>
                <td className="px-5 py-2.5 text-muted">{c.gradeLevel || "�"}</td>
                <td className="px-5 py-2.5 text-muted">
                  {c.cluster ? <Badge className="bg-hov text-fg border-line">{c.cluster}</Badge> : "�"}
                </td>
                <td className="px-5 py-2.5 text-muted">{c.room || "�"}</td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ index: i, entry: { ...c } })}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void remove(i)}>
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {classes.length === 0 && <div className="px-5 pb-5"><EmptyState message="No classes defined yet � add the first one" /></div>}
      </Card>

      {(creating || editing) && (
        <ClassEditModal
          entry={editing?.entry ?? null}
          existingNames={classes.map((c) => c.name)}
          editingIndex={editing?.index ?? null}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(e) => {
            setCreating(false);
            setEditing(null);
            if (editing) {
              const next = [...classes];
              next[editing.index] = e;
              onClassesChange(next);
            } else {
              onClassesChange([...classes, e]);
            }
            setSaved(true);
          }}
          onSave={async (entry) => {
            if (editing) {
              const next = [...classes];
              next[editing.index] = entry;
              await onSave(next);
            } else {
              await onSave([...classes, entry]);
            }
          }}
        />
      )}
    </>
  );
}

function ClassEditModal({
  entry,
  existingNames,
  editingIndex,
  onClose,
  onSaved,
  onSave,
}: {
  entry: ClassEntry | null;
  existingNames: string[];
  editingIndex: number | null;
  onClose: () => void;
  onSaved: (e: ClassEntry) => void;
  onSave: (entry: ClassEntry) => Promise<void>;
}) {
  const isEdit = entry !== null;
  const [form, setForm] = useState<ClassEntry>(entry ?? { name: "", gradeLevel: "", cluster: "", room: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Class name is required.");
      return;
    }
    const clash = existingNames.some((n, i) => n.toLowerCase() === name.toLowerCase() && i !== editingIndex);
    if (clash) {
      setError("That class name is already in use.");
      return;
    }
    const final = { ...form, name };
    setBusy(true);
    setError(null);
    try {
      await onSave(final);
      onSaved(final);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit class" : "Add class"}>
      <form onSubmit={submit} className="space-y-4">
        <Flash error={error} />
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Class Name</label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. 7-A" maxLength={60} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Grade Level</label>
          <Input value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))} placeholder="e.g. 7" maxLength={60} />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Bracket/Cluster</label>
          <Input value={form.cluster} onChange={(e) => setForm((f) => ({ ...f, cluster: e.target.value }))} placeholder="e.g. Alpha" maxLength={60} />
          <p className="text-xs text-dim mt-1">Classes in the same cluster share one teacher per subject � max 4 per cluster.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Room Number</label>
          <Input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="e.g. Rm 204" maxLength={60} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface TeacherData {
  id: number;
  name: string;
  email: string;
  subjects: string;
  password?: string;
  initial_password?: string;
  active: number;
}

function TeacherTableEditor() {
  const [teachers, setTeachers] = useState<TeacherData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<TeacherData | null>(null);
  const [creating, setCreating] = useState(false);
  const { subjects: subjectObjects } = useBrand();
  const subjectOptions = useMemo(() => subjectObjects.map((s) => s.name || s.code).filter(Boolean), [subjectObjects]);

  useEffect(() => {
    api<{ teachers: Teacher[] }>("/api/teachers")
      .then((d) => {
        setTeachers((d.teachers ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          email: t.email,
          subjects: t.subjects ?? "",
          active: t.active,
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function remove(t: TeacherData) {
    if (!confirm(`Delete ${t.name}? This removes their schedules and profile.`)) return;
    try {
      await api(`/api/teachers/${t.id}`, { method: "DELETE" });
      setTeachers((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <Card className="overflow-x-auto">
        <CardHeader
          title="Teachers"
          subtitle="Manage teacher accounts, email and subject assignments"
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add teacher
            </Button>
          }
        />
        <Flash error={error} />
        {saved && <div className="mx-5 mt-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Teacher saved.</div>}
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-muted">
              <th className="px-5 py-2.5">Name</th>
              <th className="px-5 py-2.5">Email Address</th>
              <th className="px-5 py-2.5">Subject Taught</th>
              <th className="px-5 py-2.5">Password</th>
              <th className="px-5 py-2.5">Status</th>
              <th className="px-5 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-line/50 hover:bg-hov/50">
                <td className="px-5 py-2.5 font-medium text-fg">{t.name}</td>
                <td className="px-5 py-2.5 text-muted">{t.email}</td>
                <td className="px-5 py-2.5 text-muted max-w-52 truncate">{t.subjects || "�"}</td>
                <td className="px-5 py-2.5 text-muted font-mono text-xs">{t.initial_password || "��������"}</td>
                <td className="px-5 py-2.5">
                  <Badge className={t.active === 1 ? "bg-emerald-100 text-emerald-700" : "bg-hov text-muted"}>
                    {t.active === 1 ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
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
        {teachers.length === 0 && <div className="px-5 pb-5"><EmptyState message="No teachers yet � add the first one" /></div>}
      </Card>

      {(creating || editing) && (
        <TeacherEditModal
          teacher={editing}
          subjectOptions={subjectOptions}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(t, initialPw) => {
            setCreating(false);
            setEditing(null);
            if (t) {
              setTeachers((prev) => {
                const idx = prev.findIndex((x) => x.id === t.id);
                const withPw = { ...t, initial_password: initialPw || t.initial_password };
                if (idx >= 0) { const next = [...prev]; next[idx] = withPw; return next; }
                return [...prev, withPw];
              });
            }
            setSaved(true);
          }}
        />
      )}
    </>
  );
}

function TeacherEditModal({
  teacher,
  subjectOptions,
  onClose,
  onSaved,
}: {
  teacher: TeacherData | null;
  subjectOptions: string[];
  onClose: () => void;
  onSaved: (t: TeacherData | null, initialPw?: string) => void;
}) {
  const isEdit = !!teacher?.id;
  const [form, setForm] = useState<TeacherData>(teacher ?? { id: 0, name: "", email: "", subjects: "", password: "", active: 1 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const selectedSubjects = useMemo(
    () => new Set((form.subjects || "").split(",").map((s) => s.trim()).filter(Boolean)),
    [form.subjects]
  );

  function toggleSubject(s: string) {
    const next = new Set(selectedSubjects);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setForm((f) => ({ ...f, subjects: Array.from(next).join(", ") }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form, active: form.active === 1 };
      const pw = payload.password as string | undefined;
      if (!payload.password) delete payload.password;
      if (isEdit) {
        await api(`/api/teachers/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
        onSaved({ ...form }, pw || undefined);
      } else {
        const result = await api<{ id: number }>("/api/teachers", { method: "POST", body: JSON.stringify(payload) });
        onSaved({ ...form, id: result.id }, pw);
      }
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
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Full name</label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Email address</label>
          <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">Subject taught</label>
          {subjectOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {subjectOptions.map((s) => (
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
            <Input value={form.subjects} onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))} placeholder="e.g. Algebra, Geometry" />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1">{isEdit ? "New password (leave blank to keep)" : "Password"}</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={form.password ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              minLength={isEdit ? undefined : 8}
              required={!isEdit}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-fg"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={form.active === 1} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked ? 1 : 0 }))} className="rounded border-line-strong" />
            Account active
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandBusy, setBrandBusy] = useState(false);
  const [subjectList, setSubjectList] = useState<Subject[]>([]);
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [classList, setClassList] = useState<ClassEntry[]>([]);
  const [tab, setTab] = useState<"classes" | "teachers" | "school" | "branding">("classes");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const { setBrand, setSubjects, setDepartments, setClasses, setClusters, hasLogo, hasBackground, assetsVersion } = useBrand();

  useEffect(() => {
    api<SettingsData>("/api/settings").then((d) => {
      setData(d);
      setNames(d.period_names);
      setSchoolName(d.school_name);
      setSchoolYear(d.school_year);
      setBrandName(d.system_name);
      setBrandTagline(d.system_tagline);
      setSubjectList(d.subjects ?? []);
      setDepartmentList(d.departments ?? []);
      setClassList(d.classes ?? []);
    });
  }, []);

  async function saveSubjects(list?: Subject[]) {
    const toSave = list ?? subjectList;
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ subjects: toSave }) });
    setSubjects(toSave);
  }

  async function saveDepartments() {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ departments: departmentList }) });
    setDepartments(departmentList);
  }

  async function saveClasses(updated: ClassEntry[]) {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ classes: updated }) });
    setClasses(updated);
    const derived: Record<string, string> = {};
    for (const c of updated) if (c.cluster) derived[c.name] = c.cluster;
    setClusters(derived);
  }

  async function submitBrand(e: FormEvent) {
    e.preventDefault();
    setBrandBusy(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ system_name: brandName, system_tagline: brandTagline }),
      });
      setBrand({ systemName: brandName.trim(), tagline: brandTagline.trim() });
      setBrandSaved(true);
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBrandBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          period_count: data.period_count,
          period_names: names,
          school_name: schoolName,
          school_year: schoolYear,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4 w-full">
      <div>
        <h1 className="text-xl font-bold text-fg">Settings</h1>
        <p className="text-sm text-muted">Manage branding, classes, teachers, school info and periods</p>
      </div>

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {([
          ["classes", "Classes & Brackets"],
          ["teachers", "Teachers & Subjects"],
          ["school", "School & Academic Year"],
          ["branding", "Branding"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 pb-2 text-sm font-medium -mb-px border-b-2 transition-colors whitespace-nowrap ${
              tab === key ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "branding" && (
      <Card>
        <CardHeader title="Branding" />
        <form onSubmit={submitBrand} className="p-5 space-y-4">
          <Flash error={brandError} />
          {brandSaved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Branding saved. The sidebar and page title update instantly.</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">System name</label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={60} placeholder="CSHS TRACE" />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Tagline</label>
              <Input value={brandTagline} onChange={(e) => setBrandTagline(e.target.value)} maxLength={60} placeholder="Teacher Reliever Coordination" />
            </div>
          </div>
          <p className="text-xs text-dim">Shown on the login page, sidebar, and browser tab.</p>
          <div className="flex justify-end">
            <Button type="submit" disabled={brandBusy}>{brandBusy ? "Saving..." : "Save branding"}</Button>
          </div>
        </form>
        <div className="px-5 pb-5 space-y-4 border-t border-line pt-4">
          <AssetUploadRow
            name="logo"
            label="Logo"
            hint="Appears in the sidebar, login page, and browser tab. PNG/JPEG/WebP/SVG up to 2 MB."
            current={hasLogo}
            version={assetsVersion}
            previewClass="h-16 w-16 object-contain rounded-lg bg-subtle border border-line p-1.5"
          />
          <AssetUploadRow
            name="background"
            label="Login background"
            hint="Shown behind the login card with a dark overlay. PNG/JPEG/WebP/SVG up to 2 MB."
            current={hasBackground}
            version={assetsVersion}
            previewClass="h-28 w-full object-cover rounded-lg"
          />
        </div>
      </Card>
      )}

      {tab === "classes" && (
      <ClassTableEditor
        classes={classList}
        onClassesChange={setClassList}
        onSave={saveClasses}
      />
      )}

      {tab === "teachers" && (
      <>
      <SubjectTableEditor
        subjects={subjectList}
        onSubjectsChange={setSubjectList}
        onSave={saveSubjects}
      />

      <TeacherTableEditor />
      </>
      )}

      {tab === "school" && (
      <Card>
        <CardHeader title="School information" />
        <form onSubmit={submit} className="p-5 space-y-4">
          <Flash error={error} />
          {saved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Settings saved.</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">School name</label>
              <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">School year</label>
              <Input value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} placeholder="2026-2027" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">
              Periods per day ({data.period_count})
            </label>
            <input
              type="range"
              min={1}
              max={12}
              value={data.period_count}
              onChange={(e) => {
                const count = Number(e.target.value);
                setData({ ...data, period_count: count });
                setNames((n) =>
                  Array.from({ length: count }, (_, i) => n[i] ?? `Period ${i + 1}`)
                );
              }}
              className="w-full accent-brand-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-2">Period names</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {names.map((n, i) => (
                <Input key={i} value={n} onChange={(e) => setNames((ns) => ns.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save settings"}</Button>
          </div>
        </form>
      </Card>
      )}
    </div>
  );
}