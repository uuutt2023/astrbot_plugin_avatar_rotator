// API client + image cache with two-stage (LQIP) loading support.
//
// We request two sizes per avatar:
//   - thumbnail (192px): tiny, ~3-8KB. Used as a CSS-blurred preview
//     so cards have something to show almost immediately.
//   - full (1024px or original): used for the crop modal and the
//     preview/detail view.
//
// Both sizes share the same data-URL cache, keyed by `${key}@${size}`.
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

export const THUMB_SIZE = 192;     // LQIP for grid cards
export const FULL_SIZE = 1024;    // sharp version, used for preview
export const ORIGINAL_SIZE = 0;    // sentinel for "no size param, send original"

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

// ---- image cache --------------------------------------------------------

const IMAGE_CACHE_MAX_ENTRIES = 80;
const IMAGE_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;

// key format: `${avatarKey}@${sizePx|0}` where sizePx=0 means original
type CacheKey = string;

const cache = new Map<CacheKey, string>();
let cacheVersion = 0;
const cacheSubscribers = new Set<() => void>();

function notify() {
  cacheVersion++;
  for (const cb of cacheSubscribers) {
    try { cb(); } catch {}
  }
}

export function getCacheVersion(): number {
  return cacheVersion;
}

export function subscribeImageCache(cb: () => void): () => void {
  cacheSubscribers.add(cb);
  return () => {
    cacheSubscribers.delete(cb);
  };
}

function buildCacheKey(key: string, size: number): CacheKey {
  return `${key}@${size}`;
}

export function getCachedImage(key: string, size: number): string | null {
  return cache.get(buildCacheKey(key, size)) || null;
}

export function clearImageCache() {
  cache.clear();
  notify();
}

/**
 * Load an image at the requested size. `size = 0` asks for the original
 * (no `?size=` param). Smaller sizes serve a Pillow-resized JPEG from
 * the backend, which is much smaller on the wire and renders faster.
 *
 * Concurrent requests for the same key+size dedupe: the second caller
 * attaches to the first promise instead of issuing a duplicate fetch.
 */
const inflight = new Map<CacheKey, Promise<string | null>>();

export function loadImage(key: string, size: number = THUMB_SIZE): Promise<string | null> {
  const cacheKey = buildCacheKey(key, size);
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey)!);
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const params: Record<string, any> = { format: "data_url" };
      if (size > 0) params.size = size;
      const data = await apiGet<{ image: string; filename?: string; content_type?: string; size?: number }>(
        `avatars/${encodeKey(key)}/image`,
        params,
      );
      if (!data || !data.image) return null;
      if (data.image.length > IMAGE_CACHE_MAX_ENTRY_BYTES) {
        // don't keep oversized entries
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
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
}

export async function loadStripped(key: string, size: number = FULL_SIZE): Promise<string | null> {
  try {
    const params: Record<string, any> = { format: "data_url" };
    if (size > 0) params.size = size;
    const data = await apiGet<{ image: string }>(
      `avatars/${encodeKey(key)}/stripped`,
      params,
    );
    return data?.image || null;
  } catch {
    return null;
  }
}

/**
 * Drop a thumbnail from the cache if the avatar was deleted. The full
 * cache entry is dropped on delete via clearImageCache(); this is just a
 * safety net for any local-only caches the upper layers may build.
 */
export function dropImageCache(key: string) {
  let dirty = false;
  for (const ck of Array.from(cache.keys())) {
    if (ck.startsWith(key + "@")) {
      cache.delete(ck);
      dirty = true;
    }
  }
  if (dirty) notify();
}
