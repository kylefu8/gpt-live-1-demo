# Development / 开发说明

## Project baseline / 项目基线

GPT Live 1 Demo is a small, self-hosted project for developing and validating GPT-Live-1 voice interactions. The public application baseline is **v0.3.1**, under the MIT license.

这是一个围绕 GPT-Live-1 实时语音交互进行开发与验证的开源项目，当前应用基线为 **v0.3.1**，采用 MIT 许可证。保留浏览器配置向导、中英文界面和自行部署能力，优先保证实际使用可靠。

## Start developing / 开始开发

Use Node.js 22 or later. From the repository root, run `npm ci`. Copy `.env.example` to `.env` if no local `.env` exists, then set:

使用 Node.js 22 或更新版本，在仓库根目录运行 `npm ci`。首次开发时将 `.env.example` 复制为 `.env`，已有配置不要覆盖，并设置：

```dotenv
APP_MODE=local
HOST=127.0.0.1
PORT=8788
APP_DATA_DIR=./work/dev-data
```

Run `npm start` to open the browser, or `npm run start:server` to start only the server. Complete the wizard with your own compatible deployment. The development port and private data directory are separate from the installed application's defaults. Run commands from the repository root so the relative data path resolves consistently.

运行 `npm start` 启动并打开浏览器，或用 `npm run start:server` 只启动服务。通过向导填写自己的兼容服务。开发端口与配置目录独立于已安装版本；请始终从仓库根目录启动，保证相对数据路径一致。

Local `.env`, `work/`, dependencies, logs, and credentials are not source deliverables. Use synthetic test data and keep private provider details out of issues, screenshots, and commits.

本机 `.env`、`work/`、依赖、日志和凭据均不作为源码交付。测试使用虚拟数据，不在 Issue、截图或提交中写入私人服务信息。

## Module map / 模块说明

| Files / 文件 | Responsibility / 职责 |
| --- | --- |
| `launcher.mjs`, `server.mjs` | Startup, HTTP endpoints, WebRTC session creation and delegation / 启动、HTTP 接口、会话创建及任务转交 |
| `public/index.html`, `public/setup.html` | Conversation UI, device checks and setup wizard / 对话页、设备测试和配置向导 |
| `public/i18n.js`, `public/locales/`, `ui-messages.mjs` | Chinese/English UI and application messages / 中英文界面及状态文案 |
| `settings-store.mjs`, `config.mjs`, `auth.mjs`, `connections.mjs` | Private settings, validation, authentication and connection probes / 私有配置、校验、鉴权与连通性验证 |
| `backend.mjs` | Reasoning, tool execution and native web search / 推理、工具调用与原生联网搜索 |
| `tools.mjs`, `fast-time.mjs` | Clock, weather, calculation and direct clock answers / 时间、天气、计算及时间问题快捷回答 |
| `delivery.mjs` | Deliver text answers to voice and track acknowledgments / 答案语音回传及确认状态 |
| `tests/`, `*.test.mjs` | Automated regression checks / 自动化回归验证 |
| `scripts/`, `.github/workflows/` | Release checks, portable package and CI / 发布检查、便携包与 CI |

## Working agreements / 开发约定

- Voice and backend providers must be configured by the deployer. Native search reuses the reasoning service's credentials; support depends on the actual deployment and permissions.
- Search defaults to enabled for new configurations. Older saved choices and browser preferences may still disable it. Inspect the effective settings before diagnosing a model limitation.
- Foundry native search uses Bing grounding. Its current documented behavior does not support direct live page fetching; do not claim identical behavior to every ChatGPT feature.
- UI language and conversation language are independent. A UI-language change must not overwrite drafts, clear transcripts, or restart media.

- 语音和推理服务由部署者自行配置；原生搜索复用推理服务凭据，是否可用取决于实际部署和权限。
- 新配置默认开启搜索，但旧配置及浏览器偏好可能仍关闭。排查时先确认实际生效设置，再判断模型是否支持。
- Foundry 原生搜索使用 Bing 检索；当前官方说明不支持直接实时抓取网页，不应宣称与 ChatGPT 的全部能力一致。
- 界面语言与对话语言独立，切换界面语言不得覆盖草稿、清空转写或重启音频。

## Done means verified / 完成标准

```text
npm test
npm run check:release
git diff --check
```

For user-facing changes, also exercise the real browser flow. For provider changes, distinguish deterministic tests from a real account test and inspect returned tool events and sources. Do not record credentials in the evidence.

界面变更还需在真实浏览器操作验证；服务接口变更需区分自动化模拟测试与真实账户验证，检查工具事件和来源证据，并避免在记录中包含凭据。

See [the roadmap](ROADMAP.md) for proposed work and [the release checklist](RELEASE.md) for publishing.

后续候选任务见[路线图](ROADMAP.md)，发布流程见[发布检查](RELEASE.zh-CN.md)。
