export const persistStorage = {
  get<T = any>(k: string, d: T = null as any): T {
    try { const v = localStorage.getItem("avt:" + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k: string, v: any) { try { localStorage.setItem("avt:" + k, JSON.stringify(v)); } catch {} },
};
