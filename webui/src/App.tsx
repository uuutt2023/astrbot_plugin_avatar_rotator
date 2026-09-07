import { useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  ConfigProvider,
  theme as antdTheme,
  Button,
  Space,
  Statistic,
  Tooltip,
  Upload,
  App,
  Alert,
} from "antd";
import {
  ReloadOutlined,
  BulbOutlined,
  BulbFilled,
  ThunderboltOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FixedSizeList } from "react-window";
import { API, type AvatarItem, clearImageCache } from "./api";
import { useBridge } from "./bridge";
import { t } from "./i18n";
import { useUI, persistStorage } from "./store";
import { AvatarCard, type AvatarCardActions } from "./AvatarCard";
import { CropModal } from "./CropModal";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

const CARD_MIN_WIDTH = 180;
const CARD_GAP = 12;
const ROW_HEIGHT = 240; // includes thumb + body + actions

export function AppRoot() {
  return (
    <QueryClientProvider client={qc}>
      <AntApp>
        <Root />
      </AntApp>
    </QueryClientProvider>
  );
}

function Root() {
  const ctx = useBridge();
  const { message } = App.useApp();
  const cropTarget = useUI((s) => s.cropTarget);
  const setCropTarget = useUI((s) => s.setCropTarget);
  const setShowUpload = useUI((s) => s.setShowUpload);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const queryClient = useQueryClient();

  // Apply bridge theme on mount if no local preference
  useEffect(() => {
    const saved = persistStorage.get<"light" | "dark" | null>("theme", null);
    if (saved) {
      setTheme(saved);
    } else if (ctx?.isDark) {
      setTheme("dark");
    }
  }, [ctx, setTheme]);

  // Sync theme to <html data-theme> when it changes (skip first render
  // because the initial state already reflects the persisted choice).
  const isFirstThemeRender = useRef(true);
  useEffect(() => {
    if (isFirstThemeRender.current) {
      isFirstThemeRender.current = false;
      return;
    }
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const listQuery = useQuery({
    queryKey: ["library"],
    queryFn: () => API.list(),
  });

  const rotateMut = useMutation({
    mutationFn: API.rotateNow,
    onSuccess: (res) => {
      const name = res?.name || "";
      message.success(t(ctx, "library.rotateOk", "", { name }));
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (e: any) => {
      message.error(t(ctx, "library.rotateFail", "", { msg: e?.message || String(e) }));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => API.delete(id),
    onSuccess: () => {
      clearImageCache();
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
    onError: (e: any) => {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || String(e) }));
    },
  });

  const clearCropMut = useMutation({
    mutationFn: (id: string) => API.clearCrop(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
    onError: (e: any) => {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || String(e) }));
    },
  });

  const setCropMut = useMutation({
    mutationFn: (args: {
      id: string;
      payload: { x: number; y: number; w: number; h: number; aspect: number };
    }) => API.setCrop(args.id, args.payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
    onError: (e: any) => {
      message.error(t(ctx, "toast.fail", "", { msg: e?.message || String(e) }));
    },
  });

  // Stable actions bundle so AvatarCard memoization survives sibling updates.
  const actions = useMemo<AvatarCardActions>(
    () => ({
      onCrop: (id) => setCropTarget(id),
      onDelete: (id) => deleteMut.mutateAsync(id),
      onClearCrop: (id) => clearCropMut.mutateAsync(id),
    }),
    [deleteMut, clearCropMut, setCropTarget],
  );

  // Virtual list sizing via a ResizeObserver. Keeps the layout
  // responsive without per-component glue code.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridSize, setGridSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!gridRef.current) return;
    const el = gridRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setGridSize({ width: Math.max(320, r.width), height: Math.max(200, r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setGridSize({ width: Math.max(320, r.width), height: Math.max(200, r.height) });
    return () => ro.disconnect();
  }, []);

  const library = listQuery.data?.avatars || [];
  const state = listQuery.data?.state;

  const counts = useMemo(() => {
    const c = { total: library.length, qq: 0, webui: 0, cropped: 0 };
    for (const it of library) {
      if (it.source === "qq") c.qq++;
      else if (it.source === "webui") c.webui++;
      if (it.has_crop) c.cropped++;
    }
    return c;
  }, [library]);

  const cardsPerRow = Math.max(
    1,
    Math.floor((gridSize.width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)),
  );
  const rows: AvatarItem[][] = useMemo(() => {
    const out: AvatarItem[][] = [];
    for (let i = 0; i < library.length; i += cardsPerRow) {
      out.push(library.slice(i, i + cardsPerRow));
    }
    return out;
  }, [library, cardsPerRow]);

  const cropItem = cropTarget
    ? library.find((it) => it.id === cropTarget) || null
    : null;
  const isDark = theme === "dark";
  const locale = ctx?.locale === "en-US" ? enUS : zhCN;

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: "#722ed1", borderRadius: 8 },
      }}
    >
      <div className="qg-app">
        <header className="qg-header">
          <div>
            <h1>{t(ctx, "app.title")}</h1>
            <div className="qg-subtitle">{t(ctx, "app.subtitle")}</div>
          </div>
          <Space>
            <Tooltip title={t(ctx, "library.refresh")}>
              <Button icon={<ReloadOutlined />} onClick={() => listQuery.refetch()} />
            </Tooltip>
            <Tooltip title={t(ctx, "library.rotateNow")}>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={rotateMut.isPending}
                onClick={() => rotateMut.mutate()}
              >
                {t(ctx, "library.rotateNow")}
              </Button>
            </Tooltip>
            <Tooltip title={t(ctx, theme === "dark" ? "theme.light" : "theme.dark")}>
              <Button
                icon={theme === "dark" ? <BulbFilled /> : <BulbOutlined />}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              />
            </Tooltip>
          </Space>
        </header>

        <section className="qg-stats">
          <Statistic title={t(ctx, "library.total")} value={counts.total} />
          <Statistic title={t(ctx, "library.qq")} value={counts.qq} />
          <Statistic title={t(ctx, "library.webui")} value={counts.webui} />
          <Statistic title={t(ctx, "library.cropped")} value={counts.cropped} />
        </section>

        {state?.paused && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={ctx?.locale === "en-US" ? "Rotation is paused" : "自动轮换已暂停"}
          />
        )}
        {state?.last_error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={state.last_error}
          />
        )}

        <section className="qg-upload-card">
          <Upload.Dragger
            multiple
            showUploadList={false}
            accept="image/*"
            beforeUpload={() => false}
            onChange={async ({ fileList }) => {
              if (!fileList.length) return;
              setShowUpload(false);
              let ok = 0;
              let fail = 0;
              for (const f of fileList) {
                const origin = f.originFileObj || f;
                try {
                  await API.upload(origin);
                  ok++;
                } catch {
                  fail++;
                }
              }
              message.success(t(ctx, "upload.done", "", { ok, fail }));
              queryClient.invalidateQueries({ queryKey: ["library"] });
            }}
            style={{ padding: 8 }}
          >
            <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{t(ctx, "upload.drag")}</p>
            <p className="ant-upload-hint" style={{ fontSize: 12, color: "var(--qg-muted)" }}>
              {t(ctx, "upload.hint")}
            </p>
          </Upload.Dragger>
        </section>

        <section ref={gridRef} className="qg-grid-wrap">
          {listQuery.isLoading ? (
            <div className="qg-empty">{t(ctx, "upload.busy", "加载中…", { name: "" })}</div>
          ) : listQuery.isError ? (
            <div className="qg-empty">{t(ctx, "error.loadLibrary")}</div>
          ) : library.length === 0 ? (
            <div className="qg-empty">{t(ctx, "library.empty")}</div>
          ) : (
            <FixedSizeList
              height={gridSize.height}
              itemCount={rows.length}
              itemSize={ROW_HEIGHT}
              width="100%"
              overscanCount={3}
            >
              {({ index, style }) => (
                <div style={{ ...style, padding: `0 2px ${CARD_GAP / 2}px` }}>
                  <div
                    className="qg-row"
                    style={{
                      gridTemplateColumns: `repeat(${cardsPerRow}, minmax(0, 1fr))`,
                      gap: CARD_GAP,
                    }}
                  >
                    {rows[index].map((item) => (
                      <AvatarCard key={item.id} item={item} actions={actions} />
                    ))}
                  </div>
                </div>
              )}
            </FixedSizeList>
          )}
        </section>

        <footer className="qg-footer">{t(ctx, "footer")}</footer>
      </div>

      {cropItem && (
        <CropModal
          item={cropItem}
          onClose={() => setCropTarget(null)}
          onSaved={(id, payload) => setCropMut.mutate({ id, payload })}
        />
      )}
    </ConfigProvider>
  );
}
