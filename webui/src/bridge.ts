// Bridge wrapper. CRITICAL: the dashboard unwraps the backend envelope
// (see dashboard/src/views/PluginPagePage.vue line 389:
//   sendBridgeResponse(requestId, true, response.data?.data ?? response.data)
// so apiGet/apiPost resolve with the data field directly, NOT {status,...}.
// Errors come through as Promise rejections.
import { useEffect, useState } from "react";

export type BridgeContext = {
  pluginName: string;
  displayName: string;
  pageName: string;
  pageTitle: string;
  locale: string;
  isDark: boolean;
  i18n: Record<string, any>;
};

declare global {
  interface Window {
    AstrBotPluginPage?: {
      ready(): Promise<BridgeContext>;
      getContext(): BridgeContext | null;
      getLocale(): string;
      getI18n(): Record<string, any>;
      t(key: string, fallback?: string): string;
      onContext(handler: (ctx: BridgeContext) => void): () => void;
      apiGet(endpoint: string, params?: Record<string, any>): Promise<any>;
      apiPost(endpoint: string, body?: Record<string, any>): Promise<any>;
      upload(endpoint: string, file: File): Promise<any>;
      download(endpoint: string, params?: any, filename?: string): Promise<any>;
    };
  }
}

let bridgeReady: Promise<BridgeContext> | null = null;

export function getBridge() {
  if (typeof window === "undefined") return null;
  return window.AstrBotPluginPage || null;
}

export function useBridge() {
  const [ctx, setCtx] = useState<BridgeContext | null>(null);
  useEffect(() => {
    const b = getBridge();
    if (!b) return;
    if (!bridgeReady) bridgeReady = b.ready();
    bridgeReady.then(setCtx);
    const off = b.onContext((c) => setCtx(c));
    return () => off();
  }, []);
  return ctx;
}

export function tFromCtx(ctx: BridgeContext | null, key: string, fallback: string = ""): string {
  if (!ctx) return fallback;
  const bridge = getBridge();
  if (bridge) return bridge.t(key, fallback);
  const cur = ctx.locale;
  const locales = [cur, "zh-CN", "en-US"].filter(Boolean);
  const get = (obj: any, k: string) =>
    k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), o);
  for (const loc of locales) {
    const v = get(ctx.i18n?.[loc], key);
    if (typeof v === "string") return v;
  }
  return fallback;
}

export async function apiGet<T = any>(endpoint: string, params?: Record<string, any>): Promise<T> {
  const b = getBridge();
  if (!b) throw new Error("Bridge not available - this page must be opened via AstrBot dashboard");
  return (await b.apiGet(endpoint, params)) as T;
}

export async function apiPost<T = any>(endpoint: string, body?: Record<string, any>): Promise<T> {
  const b = getBridge();
  if (!b) throw new Error("Bridge not available");
  return (await b.apiPost(endpoint, body)) as T;
}

export async function uploadFile(endpoint: string, file: File): Promise<any> {
  const b = getBridge();
  if (!b) throw new Error("Bridge not available");
  return b.upload(endpoint, file);
}
