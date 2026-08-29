import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";

export interface Subject {
  code: string;
  name: string;
  description: string;
}

export interface ClassEntry {
  name: string;
  gradeLevel: string;
  cluster: string;
  room: string;
}

interface BrandState {
  systemName: string;
  tagline: string;
  subjects: Subject[];
  departments: string[];
  classes: ClassEntry[];
  clusters: Record<string, string>;
  hasLogo: boolean;
  hasBackground: boolean;
  assetsVersion: number;
}

interface BrandContextValue extends BrandState {
  setBrand: (brand: { systemName: string; tagline: string }) => void;
  setSubjects: (subjects: Subject[]) => void;
  setDepartments: (departments: string[]) => void;
  setClasses: (classes: ClassEntry[]) => void;
  setClusters: (clusters: Record<string, string>) => void;
  refreshAssets: () => void;
}

const DEFAULT_BRAND: BrandState = {
  systemName: "CSHS TRACE",
  tagline: "Teacher Reliever Coordination",
  subjects: [],
  departments: [],
  classes: [],
  clusters: {},
  hasLogo: false,
  hasBackground: false,
  assetsVersion: 0,
};

const BrandContext = createContext<BrandContextValue>({
  ...DEFAULT_BRAND,
  setBrand: () => {},
  setSubjects: () => {},
  setDepartments: () => {},
  setClasses: () => {},
  setClusters: () => {},
  refreshAssets: () => {},
});

export function useBrand() {
  return useContext(BrandContext);
}

function cleanList(list: unknown): string[] {
  return Array.isArray(list) ? list.map(String) : [];
}

function cleanSubjects(list: unknown): Subject[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
    .map((s) => ({
      code: String(s.code ?? "").trim(),
      name: String(s.name ?? "").trim(),
      description: String(s.description ?? "").trim(),
    }))
    .filter((s) => s.code || s.name);
}

function cleanClasses(list: unknown): ClassEntry[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((c): ClassEntry | null => {
      if (c !== null && typeof c === "object") {
        const o = c as Record<string, unknown>;
        const name = String(o.name ?? "").trim();
        if (!name) return null;
        return {
          name,
          gradeLevel: String(o.gradeLevel ?? o.grade_level ?? "").trim(),
          cluster: String(o.cluster ?? "").trim(),
          room: String(o.room ?? "").trim(),
        };
      }
      const name = String(c ?? "").trim();
      return name ? { name, gradeLevel: "", cluster: "", room: "" } : null;
    })
    .filter((c): c is ClassEntry => c !== null)
    .filter((c, i, arr) => c && arr.findIndex((x) => x.name === c.name) === i);
}

export function assetUrl(name: "logo" | "background", version: number): string {
  return `/api/assets/${name}?v=${version}`;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<BrandState>(DEFAULT_BRAND);

  useEffect(() => {
    let alive = true;
    api<{
      system_name: string;
      system_tagline: string;
      subjects?: unknown[];
      departments?: string[];
      classes?: unknown[];
      clusters?: Record<string, string>;
      has_logo?: boolean;
      has_background?: boolean;
    }>("/api/settings/public")
      .then((d) => {
        if (!alive) return;
        setBrandState((b) => ({
          systemName: (d.system_name || "").trim() || DEFAULT_BRAND.systemName,
          tagline: (d.system_tagline || "").trim() || DEFAULT_BRAND.tagline,
          subjects: cleanSubjects(d.subjects),
          departments: cleanList(d.departments),
          classes: cleanClasses(d.classes),
          clusters: d.clusters && typeof d.clusters === "object" ? d.clusters : {},
          hasLogo: !!d.has_logo,
          hasBackground: !!d.has_background,
          assetsVersion: b.assetsVersion,
        }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.title = brand.systemName;
  }, [brand.systemName]);

  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!icon) return;
    if (brand.hasLogo) {
      icon.href = assetUrl("logo", brand.assetsVersion);
      icon.type = "";
    } else {
      icon.href = "/favicon.svg";
    }
  }, [brand.hasLogo, brand.assetsVersion]);

  const refreshAssets = useCallback(() => {
    api<{ has_logo?: boolean; has_background?: boolean }>("/api/settings/public")
      .then((d) =>
        setBrandState((b) => ({
          ...b,
          hasLogo: !!d.has_logo,
          hasBackground: !!d.has_background,
          assetsVersion: b.assetsVersion + 1,
        }))
      )
      .catch(() => setBrandState((b) => ({ ...b, assetsVersion: b.assetsVersion + 1 })));
  }, []);

  const value: BrandContextValue = {
    ...brand,
    setBrand: ({ systemName, tagline }) =>
      setBrandState((b) => ({
        ...b,
        systemName: systemName.trim() || b.systemName,
        tagline: tagline.trim() || b.tagline,
      })),
    setSubjects: (subjects) => setBrandState((b) => ({ ...b, subjects })),
    setDepartments: (departments) => setBrandState((b) => ({ ...b, departments })),
    setClasses: (classes) => setBrandState((b) => ({ ...b, classes })),
    setClusters: (clusters) => setBrandState((b) => ({ ...b, clusters })),
    refreshAssets,
  };

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
