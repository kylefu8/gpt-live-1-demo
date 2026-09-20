# 发布清单

简体中文 | [English](RELEASE.md)

项目在 GitHub 发布源码，也可以发布自带运行时的 Windows x64 ZIP。当前版本是 `v0.2.0`；后续发布新版本时沿用同一流程。

## 发布前

在干净检出目录中：

1. 运行 `npm ci`。
2. 运行 `npm test`。
3. 运行 `npm run check:release`。
4. 检查 `git status` 和 `git diff --check`。
5. 确认待发布文件中没有 `.env`、设置文件、日志、截图、音频、测试文件和本机路径。
6. 确认 README 语言链接、部署链接、许可证和发布说明描述的是同一版本和行为。

源码和发行包中都不能包含服务 Key、初始化口令、管理员密码、个人地址、本机路径或本地对话数据。

## 构建 Windows ZIP

在项目根目录执行，每次构建都使用新的空输出目录：

```text
npm run build:release -- --out-dir ../releases/gpt-live-1-demo-vX.Y.Z
```

构建脚本会：

- 只复制经过审查的应用白名单、`public` 和 `docs`。
- 下载固定版本的官方 Node.js 24 Windows x64 运行时。
- 使用官方 `SHASUMS256.txt` 和固定 SHA-256 校验下载文件。
- 使用自带运行时安装生产依赖。
- 写入根目录的 `Start.cmd` 启动文件。
- 在输出目录旁生成 `<package-name>-<package-version>-windows-x64.zip`。

发行包必须让 `Start.cmd`、`runtime` 和 `app` 保持在一起。不要单独上传 `app`，也不要把本机 `.env` 或应用数据目录复制进包。为了避免旧包被静默覆盖，构建脚本会拒绝已存在的输出目录或 ZIP。

上传前检查压缩包。假设 `package.json` 的版本为 `0.2.0`，文件名应为 `gpt-live-1-demo-0.2.0-windows-x64.zip`：

```text
tar -tf ../releases/gpt-live-1-demo-0.2.0-windows-x64.zip
```

文件的具体位置取决于你选择的输出目录。列表应包含 `Start.cmd`、`runtime` 和 `app`，不能包含 `.env`、测试、日志或用户数据。

## Windows 冒烟测试

在没有安装 Node.js 的 Windows 机器或干净用户目录中：

1. 解压完整 ZIP。
2. 双击 `Start.cmd`。
3. 确认浏览器打开本机设置页。
4. 填写测试用实时语音服务并运行连接测试。
5. 选择麦克风，确认输入电平和播放测试。
6. 连接、说话、接收语音，检查带时间戳的转写行，测试静音、断开和重新连接。
7. 关闭后重新打开应用，确认设置仍在系统应用数据目录，而不是 ZIP 目录。

请使用可以撤销的测试凭据。不要把真实个人 Key 保存进截图、日志、Issue 或发行资产。

## GitHub Actions 发布

CI 工作流在 push 和 pull request 时运行：使用 Node.js 22 和 24 测试，执行发布扫描，构建 Docker 镜像，启动空配置的本机容器，并检查健康接口和设置页。

Windows 发布工作流在 `v*` 标签或手动触发时运行：安装依赖，运行测试和发布扫描，构建 Windows 包，上传 ZIP 产物，计算 `SHA256SUMS.txt`，并在推送标签时使用 `docs/RELEASE-NOTES.md` 创建带说明的 GitHub Release。

推送标签前：

1. 将 `package.json` 和 `package-lock.json` 更新到目标版本。
2. 如果用户可见行为有变化，更新 `docs/RELEASE-NOTES.md` 和两个 README 版本。
3. 提交并推送源码改动。
4. 创建并推送准确的标签，例如 `v0.2.0`。
5. 检查工作流日志、上传的 ZIP、SHA-256 文件和发布页。

Docker CI 冒烟测试证明空配置的本机容器可以启动并提供健康/设置接口。它不证明某个服务账户可用，不证明已部署主机上的浏览器麦克风权限可用，也不证明 Render 模板已经线上部署。

## Render 说明

`render.yaml` 是包含付费 Starter 服务和持久磁盘的部署模板，不属于 Windows 发行包冒烟测试。维护者如果实际部署，应单独记录结果，并在称为线上服务前验证 HTTPS、设置认证、`/data` 持久化和麦克风访问。

## 版本变更

升级固定的 Node.js 运行时后，同时更新 `scripts/build-release.mjs` 中的版本和固定 SHA-256，再构建并检查新的压缩包。依赖变化时提交更新后的 lockfile。每个版本都要重新进行隐私扫描、测试、Docker 冒烟测试和 Windows 包冒烟测试。
