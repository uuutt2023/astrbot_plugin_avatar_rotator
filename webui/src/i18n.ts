// Central i18n dict. Plugin-level i18n files (zh-CN.json / en-US.json in
// .astrbot-plugin/i18n/) take precedence via bridge.t(); this dict is the
// fallback used when bridge.t returns the key unchanged.
import type { BridgeContext } from "./bridge";
import { tFromCtx } from "./bridge";

export type Locale = "zh-CN" | "en-US";
export const LOCALES: Locale[] = ["zh-CN", "en-US"];

const DICT: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "app.title": "头像库管理",
    "app.subtitle": "上传 / 查看 / 裁切 QQ 头像轮换图库",
    "upload.title": "上传头像",
    "upload.drag": "点击或拖拽图片到这里上传（支持多张）",
    "upload.hint": "支持 JPG / JPEG / PNG / WebP / BMP。",
    "upload.busy": "上传中: {name}",
    "upload.done": "本次上传 {ok} 张, 失败 {fail} 张",
    "library.total": "图库数量",
    "library.qq": "QQ 上传",
    "library.webui": "WebUI 上传",
    "library.cropped": "已裁切",
    "library.refresh": "刷新",
    "library.rotateNow": "立即换头像",
    "library.rotating": "更换中…",
    "library.rotateOk": "已更换为 {name}",
    "library.rotateFail": "更换失败: {msg}",
    "library.empty": "图库为空，请在左侧上传或使用 /添加轮换头像 指令。",
    "card.crop": "裁切",
    "card.recrop": "改裁切",
    "card.clearCrop": "清除裁切",
    "card.cleared": "裁切已清除",
    "card.delete": "删除",
    "card.confirmDelete": "确定删除这张头像？图库将立即从轮换池移除。",
    "card.deleted": "已删除",
    "card.size": "{w}×{h} · {size}",
    "card.cropBadge": "已裁切",
    "crop.title": "1:1 裁切",
    "crop.fit": "适应窗口",
    "crop.reset": "重置位置",
    "crop.zoomIn": "放大",
    "crop.zoomOut": "缩小",
    "crop.save": "保存裁切",
    "crop.saving": "保存中…",
    "crop.saved": "裁切已保存",
    "crop.hint": "拖动方形框选裁切区域，滚轮缩放，Shift+拖动平移",
    "crop.placeholder": "原图加载中…",
    "crop.failed": "原图加载失败",
    "toast.ok": "操作成功",
    "toast.fail": "操作失败: {msg}",
    "error.loadLibrary": "加载图库失败",
    "footer": "QQ 头像自动轮换 · AstrBot WebUI",
    "theme.light": "浅色",
    "theme.dark": "深色",
  },
  "en-US": {
    "app.title": "Avatar Library",
    "app.subtitle": "Upload / view / crop your QQ avatar rotation library",
    "upload.title": "Upload avatars",
    "upload.drag": "Click or drag images here (multiple supported)",
    "upload.hint": "Supports JPG / JPEG / PNG / WebP / BMP.",
    "upload.busy": "Uploading: {name}",
    "upload.done": "Uploaded {ok}, failed {fail}",
    "library.total": "Library",
    "library.qq": "QQ uploads",
    "library.webui": "WebUI uploads",
    "library.cropped": "Cropped",
    "library.refresh": "Refresh",
    "library.rotateNow": "Rotate now",
    "library.rotating": "Rotating…",
    "library.rotateOk": "Rotated to {name}",
    "library.rotateFail": "Rotation failed: {msg}",
    "library.empty": "Library is empty. Upload here or use /添加轮换头像 in QQ.",
    "card.crop": "Crop",
    "card.recrop": "Re-crop",
    "card.clearCrop": "Clear crop",
    "card.cleared": "Crop cleared",
    "card.delete": "Delete",
    "card.confirmDelete": "Delete this avatar? It will be removed from the rotation pool immediately.",
    "card.deleted": "Deleted",
    "card.size": "{w}×{h} · {size}",
    "card.cropBadge": "Cropped",
    "crop.title": "1:1 crop",
    "crop.fit": "Fit",
    "crop.reset": "Reset",
    "crop.zoomIn": "Zoom in",
    "crop.zoomOut": "Zoom out",
    "crop.save": "Save crop",
    "crop.saving": "Saving…",
    "crop.saved": "Crop saved",
    "crop.hint": "Drag the square to position. Wheel to zoom, Shift+drag to pan.",
    "crop.placeholder": "Loading original…",
    "crop.failed": "Failed to load original",
    "toast.ok": "Done",
    "toast.fail": "Failed: {msg}",
    "error.loadLibrary": "Failed to load library",
    "footer": "QQ Avatar Rotator · AstrBot WebUI",
    "theme.light": "Light",
    "theme.dark": "Dark",
  },
};

export function t(ctx: BridgeContext | null, key: string, fallback = "", vars: Record<string, any> = {}): string {
  const fromPlugin = tFromCtx(ctx, `pages.avatar.${key}`) || tFromCtx(ctx, key);
  const base = fromPlugin || DICT[ctx?.locale as Locale]?.[key] || DICT["zh-CN"][key] || fallback || key;
  return base.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
