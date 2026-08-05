# GitHub 与 AstrBot 插件市场发布说明

## 已配置的发布身份

`metadata.yaml` 已经配置为：

```yaml
author: qyd0321
repo: https://github.com/qyd0321/astrbot_plugin_avatar_rotator
```

作者标识一旦进入市场就不建议再修改，因为 AstrBot 使用
`author/name` 作为插件身份。`repo` 必须是公开的 GitHub HTTPS 仓库地址，
不能填写 Release、Issue、单个文件或私有仓库地址。

## 推荐仓库名称

`astrbot_plugin_avatar_rotator`

仓库根目录应直接包含：

- `main.py`
- `metadata.yaml`
- `_conf_schema.json`
- `requirements.txt`
- `README.md`
- `LICENSE`

不要上传运行时的 `data/`、头像图库、配置文件、日志、`__pycache__` 或 API
密钥。

## 使用 Git 推送

在本目录打开 PowerShell，然后执行：

```powershell
git init
git add .
git commit -m "Initial release v1.1.0"
git branch -M main
git remote add origin https://github.com/qyd0321/astrbot_plugin_avatar_rotator.git
git push -u origin main
```

执行前需要先在 GitHub 创建一个同名的空公开仓库。创建时不要额外勾选
README、`.gitignore` 或 LICENSE，避免和本地文件冲突。

## 发布到 AstrBot 插件市场

1. 确认 GitHub 仓库为 Public，直接打开仓库可以看到 `metadata.yaml`。
2. 注册并登录 AstrBot Cloud：<https://cloud.astrbot.app/>。
3. 进入插件发布页面，填写插件名称、作者、版本与 GitHub 仓库地址。
4. 提交后等待自动检查与人工审核。

市场信息必须和 `metadata.yaml` 完全一致：

- 名称：`astrbot_plugin_avatar_rotator`
- 版本：`1.1.0`
- 作者：`qyd0321`
- 平台：`aiocqhttp`
- AstrBot 版本：`>=4.20,<5`
