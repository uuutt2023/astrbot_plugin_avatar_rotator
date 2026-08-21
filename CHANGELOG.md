# 更新日志

## 1.2.0

- 增加 AstrBot WebUI Page:在 AstrBot 侧边栏出现「头像库」入口,可上传图片、查看持久化图库、按 1:1 比例裁切、保存裁切数据并清除。
- 裁切元数据保存到 `crops.json`;每次轮换时按元数据裁切原图后上传,原图本身保持不变。
- 后端新增 9 个 Web API,前缀 `/astrbot_plugin_avatar_rotator/...`,挂在 AstrBot 插件页面 iframe 的 `window.AstrBotPluginPage` 桥上。
- 兼容既有 QQ 指令 `/添加轮换头像` 等流程,WebUI 与 QQ 共享同一图库。

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

