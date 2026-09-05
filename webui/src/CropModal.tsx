// 1:1 crop modal. Renders the source avatar onto a canvas, lets the user
// drag a square crop selection, then POSTs the rectangle in source
// coordinates. The image data URL is reused from api.loadImage() so
// opening the modal on a card that has already been rendered is free.
//
// Interaction model (mirrors the original implementation):
//   - drag on canvas: move the crop rectangle
//   - click outside the rectangle (no drag): drop a fresh square
//     centered on the click point
//   - wheel: zoom in/out around cursor
//   - Shift+drag (or any drag from outside the rect): pan
//
// All canvas state lives in a ref so drag/wheel/zoom never triggers a
// React re-render. Only `ready` and `failed` drive actual render.
import React, { useEffect, useRef, useState } from "react";
import { Modal, Button, Space, App as AntApp } from "antd";
import { ZoomInOutlined, ZoomOutOutlined, ReloadOutlined, CheckOutlined } from "@ant-design/icons";
import type { AvatarItem } from "./api";
import { API, loadImage } from "./api";
import { useBridge } from "./bridge";
import { t } from "./i18n";

type CanvasState = {
  image: HTMLImageElement | null;
  stageW: number;
  stageH: number;
  dispW: number;
  dispH: number;
  scale: number; // dispW / srcW
  panX: number;
  panY: number;
  zoom: number; // user multiplier; 1.0 = fit-to-stage
  rect: { x: number; y: number; size: number } | null;
  dragging: null | { kind: "rect" | "pan"; startX: number; startY: number; origX: number; origY: number; origPanX: number; origPanY: number };
  draw: () => void;
};

export function CropModal({
  item,
  onClose,
  onSaved,
}: {
  item: AvatarItem;
  onClose: () => void;
  onSaved: (key: string, crop: { x: number; y: number; w: number; h: number; aspect: number }) => void;
}) {
  const ctx = useBridge();
  const { message } = AntApp.useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<CanvasState>({
    image: null,
    stageW: 600,
    stageH: 400,
    dispW: 0,
    dispH: 0,
    scale: 1,
    panX: 0,
    panY: 0,
    zoom: 1,
    rect: null,
    dragging: null,
    draw: () => {},
  });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const c = canvas.getContext("2d");
    if (!c) return;
    const s = stateRef.current;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      s.stageW = Math.max(200, Math.round(rect.width));
      s.stageH = Math.max(200, Math.round(rect.height));
    };
    const sizeCanvas = () => {
      canvas.width = s.stageW;
      canvas.height = s.stageH;
      canvas.style.width = s.stageW + "px";
      canvas.style.height = s.stageH + "px";
    };
    measure();
    sizeCanvas();

    // layout: compute fit-to-stage zoom and place the crop rect
    const layout = () => {
      if (!s.image) return;
      const iw = s.image.naturalWidth;
      const ih = s.image.naturalHeight;
      const fitScale = Math.min(s.stageW / iw, s.stageH / ih);
      // start at fitScale * 1.2 for a comfortable crop experience
      s.zoom = 1.2;
      s.scale = fitScale * s.zoom;
      s.dispW = iw * s.scale;
      s.dispH = ih * s.scale;
      s.panX = (s.stageW - s.dispW) / 2;
      s.panY = (s.stageH - s.dispH) / 2;
      // place crop rect
      if (item.crop && item.crop.src_w === iw && item.crop.src_h === ih) {
        s.rect = {
          x: s.panX + item.crop.x * s.scale,
          y: s.panY + item.crop.y * s.scale,
          size: Math.min(item.crop.w, item.crop.h) * s.scale,
        };
      } else {
        const size = Math.min(s.dispW, s.dispH) * 0.6;
        s.rect = {
          x: s.panX + (s.dispW - size) / 2,
          y: s.panY + (s.dispH - size) / 2,
          size,
        };
      }
    };

    const draw = () => {
      if (!s.image) return;
      c.clearRect(0, 0, s.stageW, s.stageH);
      c.fillStyle = "#222";
      c.fillRect(0, 0, s.stageW, s.stageH);
      c.drawImage(s.image, s.panX, s.panY, s.dispW, s.dispH);
      if (s.rect) {
        // dim outside crop
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(0, 0, s.stageW, s.rect.y);
        c.fillRect(0, s.rect.y + s.rect.size, s.stageW, s.stageH - s.rect.y - s.rect.size);
        c.fillRect(0, s.rect.y, s.rect.x, s.rect.size);
        c.fillRect(s.rect.x + s.rect.size, s.rect.y, s.stageW - s.rect.x - s.rect.size, s.rect.size);
        // bright crop square
        c.strokeStyle = "#22d3ee";
        c.lineWidth = 2;
        c.strokeRect(s.rect.x, s.rect.y, s.rect.size, s.rect.size);
      }
    };
    s.draw = draw;

    // load image via cache (AvatarCard already fetched it)
    loadImage(item.key, 2048).then((url) => {
      if (!url) { setFailed(true); return; }
      const img = new Image();
      img.onload = () => {
        s.image = img;
        layout();
        draw();
        setReady(true);
      };
      img.onerror = () => setFailed(true);
      img.src = url;
    });

    const fitToStage = () => {
      if (!s.image) return;
      const iw = s.image.naturalWidth;
      const ih = s.image.naturalHeight;
      s.zoom = 1.0;
      s.scale = Math.min(s.stageW / iw, s.stageH / ih);
      s.dispW = iw * s.scale;
      s.dispH = ih * s.scale;
      s.panX = (s.stageW - s.dispW) / 2;
      s.panY = (s.stageH - s.dispH) / 2;
      const size = Math.min(s.dispW, s.dispH) * 0.6;
      if (s.rect) {
        // re-center the existing crop on the new image position
        const cx = s.rect.x + s.rect.size / 2;
        const cy = s.rect.y + s.rect.size / 2;
        s.rect = { x: cx - size / 2, y: cy - size / 2, size };
        // clamp
        s.rect.x = Math.max(s.panX, Math.min(s.rect.x, s.panX + s.dispW - size));
        s.rect.y = Math.max(s.panY, Math.min(s.rect.y, s.panY + s.dispH - size));
      }
      draw();
    };

    // resize handling
    const onResize = () => { measure(); sizeCanvas(); layout(); draw(); };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => {
      const prevW = s.stageW, prevH = s.stageH;
      measure();
      if (prevW !== s.stageW || prevH !== s.stageH) { sizeCanvas(); layout(); draw(); }
    });
    ro.observe(stage);
    // re-measure on next frame (flex centering may not be done yet)
    const raf = requestAnimationFrame(() => { measure(); sizeCanvas(); if (s.image) { layout(); draw(); } });

    // event handlers
    const toCanvasXY = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!s.rect || !ready) return;
      const { x, y } = toCanvasXY(e);
      // Click inside the crop rect -> drag the rect.
      if (x >= s.rect.x && x <= s.rect.x + s.rect.size && y >= s.rect.y && y <= s.rect.y + s.rect.size) {
        s.dragging = {
          kind: "rect",
          startX: x, startY: y,
          origX: s.rect.x, origY: s.rect.y,
          origPanX: s.panX, origPanY: s.panY,
        };
      } else {
        // Outside: Shift = pan, otherwise drop a fresh square at click point
        if (e.shiftKey) {
          s.dragging = {
            kind: "pan", startX: x, startY: y,
            origX: 0, origY: 0,
            origPanX: s.panX, origPanY: s.panY,
          };
        } else {
          const size = s.rect.size;
          s.rect = {
            x: Math.max(s.panX, Math.min(x - size / 2, s.panX + s.dispW - size)),
            y: Math.max(s.panY, Math.min(y - size / 2, s.panY + s.dispH - size)),
            size,
          };
          draw();
        }
      }
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!s.dragging) return;
      const { x, y } = toCanvasXY(e);
      const dx = x - s.dragging.startX;
      const dy = y - s.dragging.startY;
      if (s.dragging.kind === "rect" && s.rect) {
        s.rect.x = Math.max(s.panX, Math.min(s.dragging.origX + dx, s.panX + s.dispW - s.rect.size));
        s.rect.y = Math.max(s.panY, Math.min(s.dragging.origY + dy, s.panY + s.dispH - s.rect.size));
      } else if (s.dragging.kind === "pan") {
        s.panX = s.dragging.origPanX + dx;
        s.panY = s.dragging.origPanY + dy;
        // re-clamp the rect along with the image
        if (s.rect) {
          s.rect.x = Math.max(s.panX, Math.min(s.rect.x, s.panX + s.dispW - s.rect.size));
          s.rect.y = Math.max(s.panY, Math.min(s.rect.y, s.panY + s.dispH - s.rect.size));
        }
      }
      draw();
    };
    const onMouseUp = () => { s.dragging = null; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!s.image) return;
      const { x, y } = toCanvasXY(e);
      // zoom factor
      const delta = -Math.sign(e.deltaY) * 0.12;
      const nextZoom = Math.max(0.2, Math.min(5, s.zoom * (1 + delta)));
      if (nextZoom === s.zoom) return;
      // anchor zoom around cursor: keep the source pixel under cursor at the same canvas pixel
      const srcX = (x - s.panX) / s.scale;
      const srcY = (y - s.panY) / s.scale;
      s.zoom = nextZoom;
      const fitScale = Math.min(s.stageW / s.image.naturalWidth, s.stageH / s.image.naturalHeight);
      s.scale = fitScale * s.zoom;
      s.dispW = s.image.naturalWidth * s.scale;
      s.dispH = s.image.naturalHeight * s.scale;
      s.panX = x - srcX * s.scale;
      s.panY = y - srcY * s.scale;
      // clamp
      s.panX = Math.min(s.panX, 0);
      s.panY = Math.min(s.panY, 0);
      s.panX = Math.max(s.panX, s.stageW - s.dispW);
      s.panY = Math.max(s.panY, s.stageH - s.dispH);
      draw();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key, ready]);

  // expose handlers for buttons
  const fit = () => {
    const s = stateRef.current;
    if (!s.image) return;
    const iw = s.image.naturalWidth, ih = s.image.naturalHeight;
    s.zoom = 1.0;
    s.scale = Math.min(s.stageW / iw, s.stageH / ih);
    s.dispW = iw * s.scale; s.dispH = ih * s.scale;
    s.panX = (s.stageW - s.dispW) / 2;
    s.panY = (s.stageH - s.dispH) / 2;
    const size = Math.min(s.dispW, s.dispH) * 0.6;
    if (s.rect) {
      const cx = s.rect.x + s.rect.size / 2, cy = s.rect.y + s.rect.size / 2;
      s.rect = { x: cx - size / 2, y: cy - size / 2, size };
      s.rect.x = Math.max(s.panX, Math.min(s.rect.x, s.panX + s.dispW - size));
      s.rect.y = Math.max(s.panY, Math.min(s.rect.y, s.panY + s.dispH - size));
    }
    s.draw();
  };

  const zoomBy = (factor: number) => {
    const s = stateRef.current;
    if (!s.image) return;
    const nextZoom = Math.max(0.2, Math.min(5, s.zoom * factor));
    if (nextZoom === s.zoom) return;
    const cx = s.stageW / 2, cy = s.stageH / 2;
    const srcX = (cx - s.panX) / s.scale;
    const srcY = (cy - s.panY) / s.scale;
    s.zoom = nextZoom;
    const fitScale = Math.min(s.stageW / s.image.naturalWidth, s.stageH / s.image.naturalHeight);
    s.scale = fitScale * s.zoom;
    s.dispW = s.image.naturalWidth * s.scale;
    s.dispH = s.image.naturalHeight * s.scale;
    s.panX = cx - srcX * s.scale;
    s.panY = cy - srcY * s.scale;
    s.panX = Math.min(s.panX, 0);
    s.panY = Math.min(s.panY, 0);
    s.panX = Math.max(s.panX, s.stageW - s.dispW);
    s.panY = Math.max(s.panY, s.stageH - s.dispH);
    s.draw();
  };

  const reset = () => {
    const s = stateRef.current;
    if (!s.image) return;
    const iw = s.image.naturalWidth, ih = s.image.naturalHeight;
    s.zoom = 1.2;
    s.scale = Math.min(s.stageW / iw, s.stageH / ih) * s.zoom;
    s.dispW = iw * s.scale; s.dispH = ih * s.scale;
    s.panX = (s.stageW - s.dispW) / 2;
    s.panY = (s.stageH - s.dispH) / 2;
    const size = Math.min(s.dispW, s.dispH) * 0.6;
    s.rect = { x: s.panX + (s.dispW - size) / 2, y: s.panY + (s.dispH - size) / 2, size };
    s.draw();
  };

  const save = async () => {
    const s = stateRef.current;
    if (!s.rect || !s.image) return;
    setSaving(true);
    try {
      const x = Math.round((s.rect.x - s.panX) / s.scale);
      const y = Math.round((s.rect.y - s.panY) / s.scale);
      const w = Math.round(s.rect.size / s.scale);
      const h = w;
      await API.setCrop(item.key, { x, y, w, h, aspect: 1.0 });
      message.success(t(ctx, "crop.saved"));
      onSaved(item.key, { x, y, w, h, aspect: 1.0 });
      onClose();
    } catch (e: any) {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      width="min(720px, 95vw)"
      title={`${t(ctx, "crop.title")} - ${item.name}`}
      destroyOnClose
      footer={null}
    >
      <div className="qg-crop-stage-wrap">
        <div ref={stageRef} className="qg-crop-stage">
          <canvas ref={canvasRef} className="qg-crop-canvas" />
          {!ready && !failed && (
            <div className="qg-crop-placeholder">{t(ctx, "crop.placeholder")}</div>
          )}
          {failed && <div className="qg-crop-placeholder qg-crop-failed">{t(ctx, "crop.failed")}</div>}
        </div>
        <div className="qg-crop-hint">{t(ctx, "crop.hint")}</div>
      </div>
      <div className="qg-crop-actions">
        <Space>
          <Button icon={<ZoomInOutlined />} onClick={() => zoomBy(1.2)} title={t(ctx, "crop.zoomIn")} />
          <Button icon={<ZoomOutOutlined />} onClick={() => zoomBy(1 / 1.2)} title={t(ctx, "crop.zoomOut")} />
          <Button icon={<ReloadOutlined />} onClick={reset}>{t(ctx, "crop.reset")}</Button>
          <Button onClick={fit}>{t(ctx, "crop.fit")}</Button>
        </Space>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={save}>
            {t(ctx, "crop.save")}
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
