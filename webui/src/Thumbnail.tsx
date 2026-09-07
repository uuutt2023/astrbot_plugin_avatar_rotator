// Thumbnail image component with two-stage loading.
//
// 1. On mount (or when scrolled into view) request the small thumbnail
//    (192px). Once it loads, display it with a CSS blur to "fill" the
//    card immediately.
// 2. As soon as the thumbnail is in place, request the full-size
//    (1024px) variant. When it loads, fade the sharp image on top of
//    the blurred preview with a CSS opacity transition.
//
// The technique is identical to the LQIP (Low Quality Image Placeholder)
// pattern documented in the React/Next.js community. The blur+opacity
// swap is GPU-composited by the browser, so it animates smoothly even
// on slow connections.
//
// We also wire in a shared IntersectionObserver (one per page) so that
// off-screen cards do not start any network work — only when the card
// enters a generous viewport (rootMargin 600px) does the load begin.
import React, { useEffect, useState } from "react";
import { loadImage, THUMB_SIZE, FULL_SIZE, subscribeImageCache, getCacheVersion } from "./api";

let sharedObserver: IntersectionObserver | null = null;
const observedElements = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined") return null;
  if (typeof IntersectionObserver === "undefined") return null;
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = observedElements.get(entry.target);
          if (cb) cb();
        }
      }
    },
    { rootMargin: "600px 0px" },
  );
  return sharedObserver;
}

function observeElement(el: Element, cb: () => void): () => void {
  const obs = getObserver();
  if (!obs) { cb(); return () => {}; }
  observedElements.set(el, cb);
  obs.observe(el);
  return () => {
    observedElements.delete(el);
    obs.unobserve(el);
  };
}

export type ThumbnailProps = {
  /** Avatar key (path under plugin data dir). */
  src: string;
  /** Alt text. */
  alt?: string;
  /**
   * If set, only request the given size in pixels and don't auto-upgrade.
   * Used by the crop modal which needs the original (0) and the
   * preview thumbnail (192). 0 means "ask for original, no ?size=".
   */
  fixedSize?: number;
  /** Optional CSS class for the outer container. */
  className?: string;
  /** Optional CSS class for the img elements. */
  imgClassName?: string;
};

export function Thumbnail({ src, alt = "", fixedSize, className, imgClassName }: ThumbnailProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => loadImage(src, THUMB_SIZE).then((u) => u) as any);
  const [fullUrl, setFullUrl] = useState<string | null>(
    fixedSize === undefined ? loadImage(src, FULL_SIZE).then((u) => u) as any : null,
  );
  // Bump on cache invalidation (e.g. after a delete) so cards that
  // are still mounted re-fetch. The state values are read inside
  // the effect that subscribes to the cache.
  const [, force] = useState(0);
  useEffect(() => subscribeImageCache(() => force((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement("div");
    // offscreen probe element so we can use a single shared observer
    document.body.appendChild(el);
    const cleanup = observeElement(el, () => {
      if (cancelled) return;
      loadImage(src, THUMB_SIZE).then((u) => { if (!cancelled) setThumbUrl(u); });
      if (fixedSize === undefined) {
        loadImage(src, FULL_SIZE).then((u) => { if (!cancelled) setFullUrl(u); });
      }
    });
    // kick a load immediately in case the observer doesn't fire (very
    // tall viewports, or when cards render above the fold)
    loadImage(src, THUMB_SIZE).then((u) => { if (!cancelled) setThumbUrl(u); });
    if (fixedSize === undefined) {
      loadImage(src, FULL_SIZE).then((u) => { if (!cancelled) setFullUrl(u); });
    }
    return () => {
      cancelled = true;
      cleanup();
      el.remove();
    };
  }, [src, fixedSize]);

  // If `fixedSize` is provided, the caller wants a single image only.
  if (fixedSize !== undefined) {
    return (
      <div className={className}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={alt}
            className={imgClassName}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className={`${imgClassName ?? ""} qg-img-skel`} />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* blurred LQIP — always rendered when present to avoid layout shift */}
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt=""
          aria-hidden
          className={`${imgClassName ?? ""} qg-img-preview`}
          draggable={false}
        />
      )}
      {/* sharp image — fades in on top of the preview */}
      {fullUrl && (
        <img
          src={fullUrl}
          alt={alt}
          className={`${imgClassName ?? ""} qg-img-sharp`}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      {!thumbUrl && !fullUrl && (
        <div className={`${imgClassName ?? ""} qg-img-skel`} />
      )}
    </div>
  );
}
