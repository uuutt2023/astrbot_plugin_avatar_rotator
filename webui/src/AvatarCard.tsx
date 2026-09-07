// Single avatar card. Uses the shared Thumbnail component for two-stage
// LQIP loading, so the grid renders immediately and progressively sharpens.
import { memo } from "react";
import { Button, Popconfirm, App as AntApp } from "antd";
import { ScissorOutlined, DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import type { AvatarItem } from "./api";
import { Thumbnail } from "./Thumbnail";
import { useBridge } from "./bridge";
import { t, fmtBytes } from "./i18n";

export type AvatarCardActions = {
  onCrop: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onClearCrop: (id: string) => Promise<void>;
};

export const AvatarCard = memo(function AvatarCard({
  item,
  actions,
}: {
  item: AvatarItem;
  actions: AvatarCardActions;
}) {
  const ctx = useBridge();
  const { message } = AntApp.useApp();

  const handleClearCrop = async () => {
    try {
      await actions.onClearCrop(item.id);
      message.success(t(ctx, "card.cleared"));
    } catch (e: any) {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || e }));
    }
  };

  const handleDelete = async () => {
    try {
      await actions.onDelete(item.id);
      message.success(t(ctx, "card.deleted"));
    } catch (e: any) {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || e }));
    }
  };

  return (
    <div className="qg-card">
      <div className="qg-card-thumb">
        <Thumbnail
          id={item.id}
          alt={item.name}
          className="qg-card-thumb-inner"
          imgClassName="qg-card-img"
        />
        <div className="qg-card-badges">
          {item.has_crop && (
            <span className="qg-badge qg-badge-crop">{t(ctx, "card.cropBadge")}</span>
          )}
          <span className="qg-badge qg-badge-source">{item.source.toUpperCase()}</span>
        </div>
      </div>
      <div className="qg-card-body">
        <div className="qg-card-name" title={item.name}>
          {item.name}
        </div>
        <div className="qg-card-meta">
          {t(ctx, "card.size", "", {
            w: item.width,
            h: item.height,
            size: fmtBytes(item.size),
          })}
        </div>
        <div className="qg-card-actions">
          <Button
            size="small"
            icon={<ScissorOutlined />}
            onClick={() => actions.onCrop(item.id)}
          >
            {item.has_crop ? t(ctx, "card.recrop") : t(ctx, "card.crop")}
          </Button>
          {item.has_crop && (
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClearCrop}
              aria-label={t(ctx, "card.clearCrop")}
            />
          )}
          <Popconfirm
            title={t(ctx, "card.confirmDelete")}
            okText={t(ctx, "card.delete")}
            cancelText={t(ctx, "card.cancel", "取消")}
            okType="danger"
            onConfirm={handleDelete}
          >
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={t(ctx, "card.delete")} />
          </Popconfirm>
        </div>
      </div>
    </div>
  );
});
