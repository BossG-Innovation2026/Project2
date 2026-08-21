import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth, requireAdmin, getSettings } from "../lib/auth";

export const settingsRoutes = new Hono<AppContext>();

const DEFAULT_SYSTEM_NAME = "CSHS TRACE";
const DEFAULT_TAGLINE = "Teacher Reliever Coordination";

function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseClusterMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const cls = String(k).trim();
      const cluster = String(v ?? "").trim();
      if (cls && cluster) out[cls] = cluster;
    }
    return out;
  } catch {
    return {};
  }
}

function extractClusterMap(value: unknown): { error?: string; map?: Record<string, string> } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "class_clusters must be an object mapping class names to cluster names" };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) return { error: "class_clusters: max 100 entries" };
  const map: Record<string, string> = {};
  const byCluster = new Map<string, number>();
  for (const [clsRaw, v] of entries) {
    const cls = String(clsRaw).trim();
    const cluster = String(v ?? "").trim();
    if (!cls || !cluster) return { error: "class_clusters: class and cluster names are required" };
    if (cls.length > 60 || cluster.length > 60) {
      return { error: "class_clusters: names up to 60 characters" };
    }
    map[cls] = cluster;
    byCluster.set(cluster, (byCluster.get(cluster) ?? 0) + 1);
  }
  for (const [cluster, n] of byCluster) {
    if (n > 4) return { error: `class_clusters: "${cluster}" has ${n} classes — max 4 per cluster` };
  }
  return { map };
}

function extractList(value: unknown, label: string): { error?: string; list?: string[] } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: `${label} must be an array of strings` };
  const list = Array.from(new Set(value.map((x) => String(x).trim()).filter(Boolean)));
  if (list.length > 100 || list.some((x) => x.length > 60)) {
    return { error: `${label}: max 100 items, each up to 60 characters` };
  }
  return { list };
}

settingsRoutes.get("/public", async (c) => {
  const s = await getSettings(c.env.DB);
  const { results: assets } = await c.env.DB.prepare("SELECT name FROM assets").all<{ name: string }>();
  const assetNames = new Set(assets.map((a) => a.name));
  return c.json({
    system_name: (s.system_name || "").trim() || DEFAULT_SYSTEM_NAME,
    system_tagline: (s.system_tagline || "").trim() || DEFAULT_TAGLINE,
    subjects: parseStringList(s.subject_list),
    departments: parseStringList(s.department_list),
    classes: parseStringList(s.class_list),
    clusters: parseClusterMap(s.class_cluster_map),
    has_logo: assetNames.has("logo"),
    has_background: assetNames.has("background"),
  });
});

settingsRoutes.get("/", requireAuth, async (c) => {
  const s = await getSettings(c.env.DB);
  return c.json({
    period_count: parseInt(s.period_count || "8", 10) || 8,
    period_names: JSON.parse(s.period_names || "[]") as string[],
    school_name: s.school_name || "",
    school_year: s.school_year || "",
    system_name: (s.system_name || "").trim() || DEFAULT_SYSTEM_NAME,
    system_tagline: (s.system_tagline || "").trim() || DEFAULT_TAGLINE,
    subjects: parseStringList(s.subject_list),
    departments: parseStringList(s.department_list),
    classes: parseStringList(s.class_list),
    clusters: parseClusterMap(s.class_cluster_map),
  });
});

settingsRoutes.put("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json<{
    period_count?: number;
    period_names?: string[];
    school_name?: string;
    school_year?: string;
    system_name?: string;
    system_tagline?: string;
    subjects?: string[];
    departments?: string[];
    classes?: string[];
    class_clusters?: Record<string, string>;
  }>();
  const subjectCheck = extractList(body.subjects, "subjects");
  if (subjectCheck.error) return c.json({ error: subjectCheck.error }, 400);
  const departmentCheck = extractList(body.departments, "departments");
  if (departmentCheck.error) return c.json({ error: departmentCheck.error }, 400);
  const classCheck = extractList(body.classes, "classes");
  if (classCheck.error) return c.json({ error: classCheck.error }, 400);
  const clusterCheck = extractClusterMap(body.class_clusters);
  if (clusterCheck.error) return c.json({ error: clusterCheck.error }, 400);
  const systemName = typeof body.system_name === "string" ? body.system_name.trim() : undefined;
  if (systemName !== undefined && (!systemName || systemName.length > 60)) {
    return c.json({ error: "System name must be between 1 and 60 characters" }, 400);
  }
  const tagline = typeof body.system_tagline === "string" ? body.system_tagline.trim() : undefined;
  if (tagline !== undefined && (!tagline || tagline.length > 60)) {
    return c.json({ error: "Tagline must be between 1 and 60 characters" }, 400);
  }
  const s = await getSettings(c.env.DB);
  const count = Math.min(24, Math.max(1, Math.round(body.period_count ?? (parseInt(s.period_count, 10) || 8))));
  const names =
    Array.isArray(body.period_names) && body.period_names.length === count
      ? body.period_names
      : Array.from({ length: count }, (_, i) => (s.period_names ? (JSON.parse(s.period_names) as string[])[i] : `Period ${i + 1}`));

  const upserts = [
    ["period_count", String(count)],
    ["period_names", JSON.stringify(names)],
    ["school_name", body.school_name ?? s.school_name ?? ""],
    ["school_year", body.school_year ?? s.school_year ?? ""],
  ];
  if (systemName !== undefined) upserts.push(["system_name", systemName]);
  if (tagline !== undefined) upserts.push(["system_tagline", tagline]);
  if (subjectCheck.list !== undefined) upserts.push(["subject_list", JSON.stringify(subjectCheck.list)]);
  if (departmentCheck.list !== undefined) upserts.push(["department_list", JSON.stringify(departmentCheck.list)]);
  if (classCheck.list !== undefined) upserts.push(["class_list", JSON.stringify(classCheck.list)]);
  if (clusterCheck.map !== undefined) upserts.push(["class_cluster_map", JSON.stringify(clusterCheck.map)]);
  for (const [key, value] of upserts) {
    await c.env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(key, value)
      .run();
  }
  return c.json({ ok: true });
});