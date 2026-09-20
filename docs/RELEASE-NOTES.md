# Release notes / 发布说明

## v0.3.1 / 简化为原生自动搜索

- Use only the existing reasoning service’s native web search, automatically when needed. New configurations enable it by default; existing saved choices are preserved.
- Remove the separate search provider and extra key fields. Keep source links and optional diagnostics under advanced preferences.
- 只使用现有推理服务的原生搜索，按需自动调用；新配置默认开启，升级保留已有选择。
- 移除额外搜索服务和 Key 配置，仅保留来源及高级偏好中的可选诊断。

## v0.3.0 / 可配置联网搜索

- Add independent Tavily search alongside backend-hosted search, with server-only credentials.
- Add real search probes requiring source evidence; successful chat is no longer treated as proof of search capability.
- Expose search setup and diagnostics in both languages and apply saved wizard preferences after redirect.
- 新增 Tavily 独立搜索，可与后端内置搜索切换，密钥只保存在服务端。
- 新增返回实际来源的搜索测试，区分问答连通性与搜索能力。
- 配置向导和对话页提供中英文搜索配置与测试，修复旧浏览器偏好覆盖向导设置。

## v0.2.1 / 作者与项目链接

- Add author credit and a GitHub repository link to the conversation and setup pages, in both interface languages. The link opens in a new tab.
- 主界面和配置向导底部新增作者及 GitHub 项目链接，支持中英文，点击后在新标签页打开。

## v0.2.0 / 中英文版

### English

- Add an English / Simplified Chinese interface language switch.
- Detect the browser locale on first use, while keeping the interface language separate from the assistant's conversation language.
- Apply an interface language change without a page reload and without clearing the current setup, password form, or authenticated session.
- Keep the existing service configuration, voice choices, transcript timestamps, and backend behavior unchanged.
- Publish matching English and Chinese documentation for setup, deployment, and release work.

### 简体中文

- 增加 English / 简体中文界面语言切换。
- 首次使用时根据浏览器语言自动选择界面语言，同时让界面语言与助手的对话语言保持独立。
- 切换界面语言时不刷新页面，也不清空当前配置、密码表单或已登录会话。
- 保持现有服务配置、音色选择、转写时间戳和后端行为不变。
- 为设置、部署和发布流程提供对应的中英文文档。

## v0.1.0 / 首次公开版本

### English

- Windows x64 ZIP with an official Node.js 24 runtime; extract the complete package and double-click `Start.cmd`.
- Browser setup wizard for the live voice service, optional reasoning backend, microphone selection, input-level test, and playback test.
- Voice selection, conversation language, timezone, default city, search option, reasoning effort, output budget, and session limit.
- Timestamped, sentence-separated transcript lines with audio playback, mute, reconnect, and session cleanup.
- Standalone current time/date answers without a reasoning-backend call; other tools require the optional backend.
- Docker self-hosting and a Render deployment template. The Render template uses a paid Starter service and persistent disk; it is not a claim of a live hosted deployment.
- Remote mode with an initial setup token and administrator password.
- Settings kept in the deployer's private application-data directory. API keys are stored as plain text in the settings file for server use; protect that directory and its backups.

Users must provide their own compatible live voice deployment and API keys. Voice sessions and optional backend calls are billed by the services selected by the deployer.

### 简体中文

- Windows x64 ZIP 已包含官方 Node.js 24 运行时；完整解压后双击 `Start.cmd` 即可启动。
- 浏览器配置向导支持实时语音服务、可选推理后端、麦克风选择、输入电平测试和播放测试。
- 支持音色、对话语言、时区、默认城市、联网搜索、推理强度、输出预算和会话时长设置。
- 实时转写按句带时间戳并换行，支持语音播放、静音、重新连接和会话清理。
- 独立的当前时间/日期问题无需调用推理后端；其他工具需要可选后端。
- 支持 Docker 自行部署和 Render 部署模板。Render 模板使用付费 Starter 服务和持久磁盘；这不代表已有线上托管服务。
- 服务器模式使用初始化口令和管理员密码保护。
- 设置保存在部署者的私有应用数据目录中。为了让服务能够使用，API Key 会以明文保存在设置文件中；请保护该目录及其备份。

用户需要自行准备兼容的实时语音部署和 API Key。语音会话及可选后端调用的费用由部署者选择的服务承担。
