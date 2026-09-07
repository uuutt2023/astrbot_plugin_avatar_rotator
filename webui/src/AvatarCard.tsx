// Single avatar card. Uses the shared Thumbnail component for two-stage
// LQIP loading, so the grid renders immediately and progressively sharpens.
import React, { memo } from "react";
import { Button, Popconfirm, App as AntApp } from "antd";
import { ScissorOutlined, DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import type { AvatarItem } from "./api";
import { API } from "./api";
import { Thumbnail } from "./Thumbnail";
import { useBridge } from "./bridge";
import { t, fmtBytes } from "./i18n";

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
  const { message } = AntApp.useApp();

  return (
    <div className="qg-card">
      <div className="qg-card-thumb">
        <Thumbnail
          src={item.key}
          alt={item.name}
          className="qg-card-thumb-inner"
          imgClassName="qg-card-img"
        />
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
          <Button
            size="small"
            icon={<ScissorOutlined />}
            onClick={() => actions.onCrop(item.key)}
          >
            {item.has_crop ? t(ctx, "card.recrop") : t(ctx, "card.crop")}
          </Button>
          {item.has_crop && (
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
