# 更新日志

## 1.3.0 (WebUI 重写)

将 WebUI Page 从 Babel-standalone + 手写组件 + 三个 vendored 库 (react / react-dom / babel) 重构为标准的 esbuild + React 18 + Ant Design 5 SPA:

- 删除四个 vendored 脚本 (`react.production.min.js` 10KB + `react-dom` 129KB + `babel.min.js` 2.7MB + `react-window.iife.js` 85KB, 合计约 2.9MB)
- 替换为单个 esbuild 产物 `assets/app.js` (656KB) + `assets/app.css` (3.7KB),总体积减少约 78%
- 改用 esbuild 0.18 作为构建器,CommonJS 兼容 Node 12+ / Windows 7
- 保留全部功能: 1:1 裁切 (canvas 拖拽 / 滚轮缩放 / Shift+平移) / 立即换头像 / LRU 图片缓存 (80 条上限 8MB) / IntersectionObserver 延迟加载 / 暗色主题 / 浅色主题 / 中英双语
- 把 react-window 改为 `react-window@1.8.10` (官方 CommonJS 包,不需要手动 IIFE 包装)
- 新增 `.astrbot-plugin/i18n/{zh-CN,en-US}.json` 插件级 i18n,bridge `t()` 自动 fallback
- `webui/src/` 保留可读的 React + TypeScript 源码,可在现代机器上 `npm run dev` 用 Vite 5 热开发

API 接口契约 (`/avatars`, `/avatars/upload`, `/avatars/<key:path>/image`, `/avatars/<key:path>/crop`, `/avatars/<key:path>/delete`, `/avatars/<key:path>/stripped`, `/rotate`, `/state`) 与 v1.2.0 完全一致,**不需重启** 现有后端。

## 1.2.0

- 增加 AstrBot WebUI Page:在 AstrBot 侧边栏出现「头像库」入口,可上传图片、查看持久化图库、按 1:1 比例裁切、保存裁切数据并清除。
- 裁切元数据保存到 `crops.json`;每次轮换时按元数据裁切原图后上传,原图本身保持不变。
- 后端新增 9 个 Web API,前缀 `/astrbot_plugin_avatar_rotator/...`,挂在 AstrBot 插件页面 iframe 的 `window.AstrBotPluginPage` 桥上。
- 兼容既有 QQ 指令 `/添加轮换头像` 等流程,WebUI 与 QQ 共享同一图库。
- 修复 WebUI 缩略图与裁切图加载时 `encodeURIComponent` 把路径分隔符 `/` 一起编码导致 404 的问题：拆分 key 后逐段编码，保留真实的 `/`，避免浏览器对 `%2F` 再次编码为 `%252F`；后端将 `avatars/<key>/...` 改为 `avatars/<key:path>/...` 以接收跨斜杠的 key。
- 修复 dashboard iframe 中 `<img>` 走相对路径命中 `/api/plugin/page/content/...` 触发 401 的问题：`/image` 和 `/stripped` 端点在 `?format=data_url` 时返回 `{image: "data:image/jpeg;base64,..."}` 信封，前端改用 `bridge.apiGet` 拿 data URL 后赋给 `img.src`，绕开 cookie/sandbox 限制与 `bridge.apiGet` 不返回二进制的契约。

## 1.2.0 (uuutt2023 fork)

- 将 WebUI Page 重构为 React + Babel standalone JSX 渲染：
 - AvatarCard、CropModal、App 等组件化，`memo` + 稳定 actions bundle，避免无关 card 在兄弟组件更新时重渲染
 - 模块级图片 data URL 缓存：每张头像只下载一次 base64，再次打开裁切模态或局部刷新不会重新走 `bridge.apiGet`
 - 裁切保存走 `setLibrary(prev => prev.map(...))` 的局部更新，不再触发全局 refresh + 重新拉取所有图片，避免了"裁切时 base64 src 刷新一遍"的问题
 - 拖拽裁切改用 `stateRef`（canvas 重绘不走 React state），交互期间无重渲染
 - 删除了之前下错的 htm.js + htm 风格的模板（htm 3.x 不支持 `</TAG>` 闭合语法，强行使用会让整个组件树变成字符碎片），改用 Babel standalone 编译 JSX
 - 引入 `react.production.min.js` (10.5KB) + `react-dom.production.min.js` (129KB) + `babel.min.js` (2.7MB) 作为本地 vendor 资源，由 `PluginPageService` 的 HTML rewriter 自动加上 `asset_token` 鉴权加载
- CropModal 重写为自实现 canvas 缩放/拖动/平移：
 - 滚轮缩放（围绕鼠标位置）、Shift+拖动平移、空白处点击重置裁切框位置
 - 引入"适应窗口"按钮恢复 fit-to-stage 视图
 - 用 ResizeObserver + `requestAnimationFrame` 处理 modal 刚打开时浏览器 layout 未完成导致的 0×0 stage 尺寸
- 删除 `window.confirm`（dashboard iframe 的 `sandbox` 属性不含 `allow-modals`，浏览器拒绝 confirm）；改用自实现的 `confirmDialog` Promise API
- 替换分页为 react-window 虚拟滚动（教程《React 性能优化精讲》第三章方案）：
 - `react-window` 包手工包装为 IIFE，全局挂载 `window.ReactWindow`（react-window 不发布 UMD），配合现有 `<script src>` 加载模式
 - 用 `FixedSizeList` 按行打包，每行 N 张 card 通过 CSS Grid 排版，滚动只渲染可视 + overscan 行（≈ 20–40 张 DOM 节点）
 - 用 ResizeObserver 测量 grid 容器宽高，按列数动态分页
- 删除原分页组件 `Pagination` 与 `buildPageList`，由虚拟滚动取代
- ImageCache 加 LRU 淘汰（`IMAGE_CACHE_MAX_ENTRIES = 80`，单条上限 8 MB），防止长会话下大量 base64 撑爆 iframe 内存
- AvatarCard 接入共享 `IntersectionObserver`：只在卡片进入视口附近（rootMargin 600 px）才发起 `bridge.apiGet` 获取 base64，滚出可视范围即停止监听，避免一次拉取全部图片
- 引入 `react-window.iife.js` (85 KB) 作为虚拟滚动 vendor（从 npm 官方 ESM 手工 IIFE 包装，因为 react-window 不发布 UMD/IIFE）

## 1.1.0

- 增加 AstrBot WebUI 原生多图片上传入口。
- 合并 WebUI 与 QQ 指令上传的头像图库。
- 支持从配置页移除头像后自动退出轮换池。
- 使用持久化现实时间戳安排下次轮换。
- 增加随机和顺序轮换、暂停、恢复、立即更换与状态查询。

## 1.0.0

- 首次发布。
- 支持通过 QQ 指令上传、列出和删除头像。
- 支持通过 NapCat `set_qq_avatar` 接口定时更换 QQ 头像。

