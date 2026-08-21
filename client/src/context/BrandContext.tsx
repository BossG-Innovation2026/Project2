import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";

interface BrandState {
  systemName: string;
  tagline: string;
  subjects: string[];
  departments: string[];
  classes: string[];
  clusters: Record<string, string>;
  hasLogo: boolean;
  hasBackground: boolean;
  assetsVersion: number;
}

interface BrandContextValue extends BrandState {
  setBrand: (brand: { systemName: string; tagline: string }) => void;
  setSubjects: (subjects: string[]) => void;
  setDepartments: (departments: string[]) => void;
  setClasses: (classes: string[]) => void;
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
      subjects?: string[];
      departments?: string[];
      classes?: string[];
      clusters?: Record<string, string>;
      has_logo?: boolean;
      has_background?: boolean;
    }>("/api/settings/public")
      .then((d) => {
        if (!alive) return;
        setBrandState((b) => ({
          systemName: (d.system_name || "").trim() || DEFAULT_BRAND.systemName,
          tagline: (d.system_tagline || "").trim() || DEFAULT_BRAND.tagline,
          subjects: cleanList(d.subjects),
          departments: cleanList(d.departments),
          classes: cleanList(d.classes),
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
