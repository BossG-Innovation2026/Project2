import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../api";
import { assetUrl, useBrand } from "../context/BrandContext";
import { Card, CardHeader, Button, Input, Spinner, Flash, EmptyState } from "../components/ui";
import { X, Upload, Trash2 } from "lucide-react";

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
  subjects: string[];
  departments: string[];
  classes: string[];
  clusters?: Record<string, string>;
}

function ListEditorCard({
  title,
  subtitle,
  items,
  onItemsChange,
  onSave,
  emptyHint,
  addPlaceholder,
}: {
  title: string;
  subtitle?: string;
  items: string[];
  onItemsChange: (items: string[]) => void;
  onSave: () => Promise<void>;
  emptyHint: string;
  addPlaceholder: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError("That entry is already in the list.");
      return;
    }
    if (items.length >= 100) {
      setError("Maximum of 100 entries.");
      return;
    }
    setError(null);
    onItemsChange([...items, v]);
    setDraft("");
    setSaved(false);
  }

  function remove(v: string) {
    onItemsChange(items.filter((x) => x !== v));
    setSaved(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <form onSubmit={submit} className="p-5 space-y-4">
        <Flash error={error} />
        {saved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Saved.</div>}
        <div className="flex flex-wrap gap-2">
          {items.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-hov border border-line px-3 py-1 text-sm text-fg">
              {s}
              <button type="button" onClick={() => remove(s)} className="text-dim hover:text-rose-600" aria-label={`Remove ${s}`}>
                <X size={13} />
              </button>
            </span>
          ))}
          {items.length === 0 && <span className="text-sm text-dim">{emptyHint}</span>}
        </div>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={addPlaceholder}
            maxLength={60}
          />
          <Button type="button" variant="secondary" onClick={add}>Add</Button>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Savingâ€¦" : "Save"}</Button>
        </div>
      </form>
    </Card>
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
  const [subjectList, setSubjectList] = useState<string[]>([]);
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [clusterMap, setClusterMap] = useState<Record<string, string>>({});
  const [clusterBusy, setClusterBusy] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterSaved, setClusterSaved] = useState(false);
  const [tab, setTab] = useState<"branding" | "lists" | "school">("branding");
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
      setClusterMap(d.clusters ?? {});
    });
  }, []);

  async function saveSubjects() {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ subjects: subjectList }) });
    setSubjects(subjectList);
  }

  async function saveDepartments() {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ departments: departmentList }) });
    setDepartments(departmentList);
  }

  async function saveClasses() {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ classes: classList }) });
    setClasses(classList);
  }

  const clusterCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of Object.values(clusterMap)) {
      const name = c.trim();
      if (name) m.set(name, (m.get(name) ?? 0) + 1);
    }
    return m;
  }, [clusterMap]);
  const overLimitClusters = [...clusterCounts].filter(([, n]) => n > 4);

  async function saveClusters() {
    setClusterBusy(true);
    setClusterError(null);
    setClusterSaved(false);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ class_clusters: clusterMap }) });
      setClusters(clusterMap);
      setClusterSaved(true);
    } catch (err) {
      setClusterError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setClusterBusy(false);
    }
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
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-fg">Settings</h1>
        <p className="text-sm text-muted">Branding, pickers, school information and period configuration</p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {([
          ["branding", "Branding"],
          ["lists", "Lists & Clusters"],
          ["school", "School"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 pb-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
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
          <div className="grid grid-cols-2 gap-3">
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
            <Button type="submit" disabled={brandBusy}>{brandBusy ? "Savingâ€¦" : "Save branding"}</Button>
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

      {tab === "lists" && (
      <>
      <ListEditorCard
        title="Subjects"
        subtitle="Populates the specialization and class schedule subject pickers"
        items={subjectList}
        onItemsChange={setSubjectList}
        onSave={saveSubjects}
        emptyHint="No subjects defined yet â€” specialization and schedule fields will stay free-text until you add some."
        addPlaceholder="Add a subject (e.g. Mathematics)"
      />

      <ListEditorCard
        title="Departments"
        subtitle="Populates the department picker in the Teachers form"
        items={departmentList}
        onItemsChange={setDepartmentList}
        onSave={saveDepartments}
        emptyHint="No departments defined yet â€” the Teachers form will use its built-in defaults until you add some."
        addPlaceholder="Add a department (e.g. Science)"
      />

      <ListEditorCard
        title="Classes"
        subtitle="Populates the class picker in the Class Schedules form"
        items={classList}
        onItemsChange={setClassList}
        onSave={saveClasses}
        emptyHint="No classes defined yet â€” the schedule form will stay free-text until you add some."
        addPlaceholder="Add a class (e.g. 7-A)"
      />

      <Card>
        <CardHeader
          title="Class Clusters"
          subtitle="Classes in the same cluster share one teacher per subject in the Schedule Generator â€” max 4 classes per cluster"
        />
        <div className="px-5 pb-5 space-y-3">
          {classList.length === 0 ? (
            <EmptyState message="Add classes first, then group them into clusters." />
          ) : (
            <>
              {classList.map((cls) => (
                <div key={cls} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-fg w-40 shrink-0 truncate">{cls}</span>
                  <Input
                    value={clusterMap[cls] ?? ""}
                    onChange={(e) =>
                      setClusterMap((m) => {
                        const next = { ...m };
                        const v = e.target.value.trim();
                        if (v) next[cls] = v;
                        else delete next[cls];
                        return next;
                      })
                    }
                    list="cluster-names"
                    placeholder="Unclustered"
                  />
                </div>
              ))}
              <datalist id="cluster-names">
                {[...clusterCounts.keys()].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {overLimitClusters.map(([c, n]) => (
                <p key={c} className="text-xs font-medium text-red-500">
                  &quot;{c}&quot; has {n} classes â€” max 4 per cluster.
                </p>
              ))}
              <Flash error={clusterError} />
              {clusterSaved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Clusters saved.</div>}
              <p className="text-xs text-dim">Leave a class blank to keep it unclustered (it schedules independently).</p>
              <div className="flex justify-end">
                <Button disabled={clusterBusy || overLimitClusters.length > 0} onClick={saveClusters}>
                  {clusterBusy ? "Savingâ€¦" : "Save clusters"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
      </>
      )}

      {tab === "school" && (
      <Card>
        <CardHeader title="School information" />
        <form onSubmit={submit} className="p-5 space-y-4">
          <Flash error={error} />
          {saved && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">Settings saved.</div>}
          <div className="grid grid-cols-2 gap-3">
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
            <Button type="submit" disabled={busy}>{busy ? "Savingâ€¦" : "Save settings"}</Button>
          </div>
        </form>
      </Card>
      )}
    </div>
  );
}
