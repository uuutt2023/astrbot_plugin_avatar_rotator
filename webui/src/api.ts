// API client + image cache. All binary image responses come back from the
// backend as `{image: "data:<mime>;base64,..."}` envelopes (see main.py
// `_wants_data_url()` / `_maybe_image_response()`). We cache the data URLs
// here so reopening the crop modal on a visible avatar costs no network.
import { apiGet, apiPost, uploadFile } from "./bridge";

export type AvatarItem = {
  key: string;
  name: string;
  size: number;
  width: number;
  height: number;
  source: "qq" | "webui";
  crop: { x: number; y: number; w: number; h: number; aspect?: number; src_w?: number; src_h?: number } | null;
  has_crop: boolean;
};

export type LibraryResp = {
  avatars: AvatarItem[];
  selection_mode: string;
  state: {
    last_avatar: string;
    last_changed_at: number;
    next_run_at: number;
    paused: boolean;
    last_error: string;
  };
};

export type StateResp = {
  paused: boolean;
  enabled: boolean;
  selection_mode: string;
  interval_seconds: number;
  last_avatar: string;
  last_changed_at: number;
  next_run_at: number;
  last_error: string;
  avatar_count: number;
  crop_count: number;
};

export const API = {
  list: () => apiGet<LibraryResp>("avatars"),
  state: () => apiGet<StateResp>("state"),
  upload: (file: File) => uploadFile("avatars/upload", file),
  delete: (key: string) => apiPost<{ deleted: boolean }>(`avatars/${encodeKey(key)}/delete`, {}),
  setCrop: (key: string, payload: { x: number; y: number; w: number; h: number; aspect: number }) =>
    apiPost<{ crop?: any; cleared?: boolean }>(`avatars/${encodeKey(key)}/crop`, payload),
  clearCrop: (key: string) =>
    apiPost<{ cleared: boolean }>(`avatars/${encodeKey(key)}/crop`, {}),
  rotateNow: () => apiPost<{ rotated: string }>("rotate", {}),
};

/**
 * Avatar keys are stored as relative paths under the plugin data dir
 * (e.g. "avatars/20250101_xxx.jpg"). The backend route uses
 * `<key:path>` to receive multi-segment keys. The dashboard normalizes
 * the endpoint by URL-encoding each segment individually (see
 * `normalizePluginEndpoint` in dashboard server), so we MUST keep the
 * "/" separators as real path delimiters and let the server encode
 * each segment. Encoding "/" to "%2F" causes the dashboard to re-encode
 * it to "%252F", which breaks the route.
 */
export function encodeKey(key: string): string {
  return String(key || "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

const IMAGE_CACHE_MAX_ENTRIES = 80;
const IMAGE_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const cache = new Map<string, string>();
let cacheSubscribers: Array<() => void> = [];

function notify() {
  for (const cb of cacheSubscribers) {
    try { cb(); } catch {}
  }
}

export function subscribeImageCache(cb: () => void): () => void {
  cacheSubscribers.push(cb);
  return () => {
    cacheSubscribers = cacheSubscribers.filter((c) => c !== cb);
  };
}

export function getCachedImage(key: string, size: number = 1024): string | null {
  return cache.get(`${key}@${size}`) || null;
}

export function clearImageCache() {
  cache.clear();
  notify();
}

export async function loadImage(key: string, size: number = 1024): Promise<string | null> {
  const cacheKey = `${key}@${size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  try {
    const data = await apiGet<{ image: string; filename: string; content_type: string; size: number }>(
      `avatars/${encodeKey(key)}/image`,
      { format: "data_url" },
    );
    if (!data || !data.image) return null;
    if (data.image.length > IMAGE_CACHE_MAX_ENTRY_BYTES) {
      // too big to keep around
      return data.image;
    }
    while (cache.size >= IMAGE_CACHE_MAX_ENTRIES) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
      else break;
    }
    cache.set(cacheKey, data.image);
    notify();
    return data.image;
  } catch {
    return null;
  }
}

export async function loadStripped(key: string): Promise<string | null> {
  try {
    const data = await apiGet<{ image: string }>(
      `avatars/${encodeKey(key)}/stripped`,
      { format: "data_url" },
    );
    return data?.image || null;
  } catch {
    return null;
  }
}
