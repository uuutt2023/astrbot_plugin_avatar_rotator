// Single avatar card. Renders the image lazily (only when the card enters
// the viewport) via a shared IntersectionObserver instance, then reuses
// the cached data URL on subsequent re-renders.
import React, { memo, useEffect, useRef, useState } from "react";
import { Button, Popconfirm, Space, Tooltip, App as AntApp } from "antd";
import { ScissorOutlined, DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import type { AvatarItem } from "./api";
import { loadImage } from "./api";
import { useBridge } from "./bridge";
import { t, fmtBytes } from "./i18n";

let sharedObserver: IntersectionObserver | null = null;
const observedCards = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined") return null;
  if (typeof IntersectionObserver === "undefined") return null;
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = observedCards.get(entry.target);
          if (cb) cb();
        }
      }
    },
    { rootMargin: "600px 0px" },
  );
  return sharedObserver;
}

function observe(el: Element, cb: () => void) {
  const obs = getObserver();
  if (!obs) { cb(); return () => {}; }
  observedCards.set(el, cb);
  obs.observe(el);
  return () => {
    observedCards.delete(el);
    obs.unobserve(el);
  };
}

export type AvatarCardActions = {
  onCrop: (key: string) => void;
  onDelete: (key: string) => Promise<void>;
  onClearCrop: (key: string) => Promise<void>;
};

export const AvatarCard = memo(function AvatarCard({
  item,
  actions,
}: {
  item: AvatarItem;
  actions: AvatarCardActions;
}) {
  const ctx = useBridge();
  const ref = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (loading) return;
      setLoading(true);
      loadImage(item.key).then((u) => {
        setUrl(u);
        setLoading(false);
      });
    };
    return observe(el, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key]);

  return (
    <div ref={ref} className="qg-card">
      <div className="qg-card-thumb">
        {url ? (
          <img src={url} alt={item.name} loading="lazy" />
        ) : (
          <div className="qg-card-thumb-skel">{loading ? "…" : ""}</div>
        )}
        <div className="qg-card-badges">
          {item.has_crop && <span className="qg-badge qg-badge-crop">{t(ctx, "card.cropBadge")}</span>}
          <span className="qg-badge qg-badge-source">{item.source.toUpperCase()}</span>
        </div>
      </div>
      <div className="qg-card-body">
        <div className="qg-card-name" title={item.name}>{item.name}</div>
        <div className="qg-card-meta">
          {t(ctx, "card.size", "", { w: item.width, h: item.height, size: fmtBytes(item.size) })}
        </div>
        <div className="qg-card-actions">
          <Tooltip title={t(ctx, "card.crop")}>
            <Button
              size="small"
              icon={<ScissorOutlined />}
              onClick={() => actions.onCrop(item.key)}
            >
              {item.has_crop ? t(ctx, "card.recrop") : t(ctx, "card.crop")}
            </Button>
          </Tooltip>
          {item.has_crop && (
            <Tooltip title={t(ctx, "card.clearCrop")}>
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={async () => {
                  try {
                    await actions.onClearCrop(item.key);
                    message.success(t(ctx, "card.cleared"));
                  } catch (e: any) {
                    message.error(t(ctx, "toast.fail", "", { msg: e?.message || e }));
                  }
                }}
              />
            </Tooltip>
          )}
          <Popconfirm
            title={t(ctx, "card.confirmDelete")}
            okText={t(ctx, "card.delete")}
            cancelText="取消"
            okType="danger"
            onConfirm={async () => {
              try {
                await actions.onDelete(item.key);
                message.success(t(ctx, "card.deleted"));
              } catch (e: any) {
                message.error(t(ctx, "toast.fail", "", { msg: e?.message || e }));
              }
            }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      </div>
    </div>
  );
});
