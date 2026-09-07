// Tiny localStorage wrapper. Keys are namespaced under "avt:" so
// they don't collide with other plugin pages on the same origin.
// Failures (quota, privacy mode) are swallowed silently — the UI
// should still work even when persistence is unavailable.
export const persistStorage = {
  get<T = any>(k: string, d: T = null as any): T {
    try {
      const v = localStorage.getItem("avt:" + k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: any): void {
    try {
      localStorage.setItem("avt:" + k, JSON.stringify(v));
    } catch {
      /* ignore quota / privacy mode errors */
    }
  },
  remove(k: string): void {
    try {
      localStorage.removeItem("avt:" + k);
    } catch {
      /* ignore */
    }
  },
};
