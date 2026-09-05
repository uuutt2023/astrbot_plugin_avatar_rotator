import { create } from "zustand";
import { persistStorage } from "./persist";

export type Theme = "light" | "dark";

type UIState = {
  cropTarget: string | null;
  theme: Theme;
  showUpload: boolean;
  setCropTarget: (key: string | null) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setShowUpload: (b: boolean) => void;
};

export const useUI = create<UIState>((set, get) => ({
  cropTarget: null,
  theme: (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark") ? "dark" : "light",
  showUpload: false,

  setCropTarget: (key) => set({ cropTarget: key }),
  setTheme: (t) => {
    set({ theme: t });
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", t);
    persistStorage.set("theme", t);
  },
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
  setShowUpload: (b) => set({ showUpload: b }),
}));

export const persistStorage = {
  get<T = any>(k: string, d: T = null as any): T {
    try { const v = localStorage.getItem("avt:" + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k: string, v: any) { try { localStorage.setItem("avt:" + k, JSON.stringify(v)); } catch {} },
};
