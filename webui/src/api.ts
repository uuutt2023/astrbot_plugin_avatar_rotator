// API client + image cache with two-stage (LQIP) loading.
//
// Each avatar has a stable numeric ``id`` (1-based index into the
// server's deterministic sorted library list) returned by /avatars.
// The WebUI always references avatars by id instead of the full
// multi-segment key — this keeps URLs clean, avoids the dashboard's
// repeated percent-encoding turning Chinese filenames into
// "%25E4%25B8..." soup, and aligns the bridge round-trip with the
// route handler's <id> path parameter.
import { apiGet, apiPost, uploadFile } from "./bridge";

export type AvatarItem = {
  /** 1-based numeric id, stable per server-side sorted library list. */
  id: string;
  /** Full relative path under plugin data dir. Kept for display only. */
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

export type UploadResp = {
  id: string;
  key: string;
  name: string;
  size: number;
};

export type RotateResp = {
  rotated: string;
  name: string;
};

export type ImageData = {
  image: string;
  filename?: string;
  content_type?: string;
  size?: number;
};

export const THUMB_SIZE = 192;     // LQIP for grid cards
export const FULL_SIZE = 1024;    // sharp version, used for preview
export const ORIGINAL_SIZE = 0;    // sentinel for "no size param, send original"

export const API = {
  list: () => apiGet<LibraryResp>("avatars"),
  state: () => apiGet<StateResp>("state"),
  upload: (file: File) => uploadFile("avatars/upload", file) as Promise<UploadResp>,
  delete: (id: string) => apiPost<{ deleted: boolean }>(`avatars/${id}/delete`, {}),
  setCrop: (id: string, payload: { x: number; y: number; w: number; h: number; aspect: number }) =>
    apiPost<{ crop?: any; cleared?: boolean }>(`avatars/${id}/crop`, payload),
  clearCrop: (id: string) =>
    apiPost<{ cleared: boolean }>(`avatars/${id}/crop`, {}),
  rotateNow: () => apiPost<RotateResp>("rotate", {}),
};

// ---- image cache --------------------------------------------------------

const IMAGE_CACHE_MAX_ENTRIES = 80;
const IMAGE_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;

// key format: `${avatarId}@${sizePx|0}` where sizePx=0 means original
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

function buildCacheKey(id: string, size: number): CacheKey {
  return `${id}@${size}`;
}

export function getCachedImage(id: string, size: number): string | null {
  return cache.get(buildCacheKey(id, size)) || null;
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
 * Concurrent requests for the same id+size dedupe: the second caller
 * attaches to the first promise instead of issuing a duplicate fetch.
 */
const inflight = new Map<CacheKey, Promise<string | null>>();

export function loadImage(id: string, size: number = THUMB_SIZE): Promise<string | null> {
  const cacheKey = buildCacheKey(id, size);
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey)!);
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const params: Record<string, any> = { format: "data_url" };
      if (size > 0) params.size = size;
      const data = await apiGet<{ image: string; filename?: string; content_type?: string; size?: number }>(
        `avatars/${id}/image`,
        params,
      );
      if (!data || !data.image) return null;
      if (data.image.length > IMAGE_CACHE_MAX_ENTRY_BYTES) {
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

export async function loadStripped(id: string, size: number = FULL_SIZE): Promise<string | null> {
  try {
    const params: Record<string, any> = { format: "data_url" };
    if (size > 0) params.size = size;
    const data = await apiGet<{ image: string }>(
      `avatars/${id}/stripped`,
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
export function dropImageCache(id: string) {
  let dirty = false;
  for (const ck of Array.from(cache.keys())) {
    if (ck.startsWith(id + "@")) {
      cache.delete(ck);
      dirty = true;
    }
  }
  if (dirty) notify();
}
