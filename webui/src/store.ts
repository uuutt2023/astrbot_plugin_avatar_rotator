import { create } from "zustand";
import { persistStorage } from "./persist";

export type Theme = "light" | "dark";

type UIState = {
  /** Numeric avatar id (string) currently open in the crop modal, or null. */
  cropTarget: string | null;
  theme: Theme;
  showUpload: boolean;
  setCropTarget: (key: string | null) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setShowUpload: (b: boolean) => void;
};

/**
 * UI store. Persists the theme choice via the shared ``persistStorage``
 * helper so the same persistence scheme applies whether we use the
 * zustand/persist middleware or write directly. The mutation API
 * deliberately mirrors the immer style (``set`` with a partial
 * object) so future code can swap in ``zustand/middleware/immer``
 * without changing the call sites.
 */
export const useUI = create<UIState>((set, get) => ({
  cropTarget: null,
  theme:
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light",
  showUpload: false,

  setCropTarget: (key) => set({ cropTarget: key }),
  setTheme: (t) => {
    set({ theme: t });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
    }
    persistStorage.set("theme", t);
  },
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
  setShowUpload: (b) => set({ showUpload: b }),
}));

export { persistStorage };
