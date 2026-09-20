# 部署说明

简体中文 | [English](DEPLOYMENT.md)

根据使用场景选择部署方式：

- Windows 普通用户：下载发行 ZIP，运行 `Start.cmd`。
- 开发者：直接运行 Node.js 服务。
- 本机容器：使用 `compose.yml`。
- 共享服务器：使用 `compose.remote.yml`，放在 HTTPS 反向代理后面。
- Render：把 `render.yaml` 当作起点，并自行验证实际服务。

## Windows 发行包

公开的 `v0.2.1` Windows x64 发行包已包含官方 Node.js 24 运行时。

1. 从 [GitHub Releases](https://github.com/kylefu8/gpt-live-1-demo/releases/latest) 下载完整 ZIP。
2. 解压时不要拆开 `Start.cmd`、`runtime` 和 `app`。
3. 双击 `Start.cmd`。
4. 如果浏览器没有自动打开，手动打开设置页。
5. 填写并测试实时语音服务；如需推理能力，再填写并测试推理后端；然后测试麦克风和播放设备并保存。

这种方式不需要安装 Node.js，也不需要编辑 `.env`。应用设置保存在操作系统的应用数据目录中。

## Node.js 开发运行

使用 Node.js 22 或更高版本：

```text
npm ci
npm start
```

只运行服务、不自动打开浏览器：

```text
npm run start:server
```

本机默认地址是 <http://127.0.0.1:8767/>。本机模式通过浏览器向导接受配置，默认只监听回环地址；如需局域网访问，请使用项目提供的本机网络容器配置。

## 本机 Docker

构建并启动本机容器：

```text
docker compose -f compose.yml up --build
```

打开 <http://127.0.0.1:8767/> 并完成向导。Compose 使用 `gpt-live-1-demo-data` 数据卷保存 `/data`。

停止服务：

```text
docker compose -f compose.yml down
```

需要保留设置时请保留这个数据卷。删除数据卷会删除已保存的设置和凭据。

## 远程 Docker 服务器

使用服务器上的私有目录，并从 `.env.example` 创建 `.env`。至少设置：

```dotenv
APP_MODE=remote
HOST=0.0.0.0
PORT=8767
APP_DATA_DIR=/data
PUBLIC_ORIGIN=https://voice.example.com
SETUP_TOKEN=replace-with-a-long-random-value
```

启动服务：

```text
docker compose -f compose.remote.yml up -d --build
```

在 `8767` 端口前配置反向代理，并在那里终止 TLS。代理必须转发普通 HTTP 请求和 WebSocket 升级请求。`PUBLIC_ORIGIN` 应填写用户实际打开的 HTTPS 根地址，包含协议且不带路径。

打开设置页前先检查服务：

```text
curl --fail https://voice.example.com/api/health
```

远程首次访问时输入 `SETUP_TOKEN`，随后创建至少 10 个字符的管理员密码。之后访问设置页使用这个密码。初始化口令和管理员密码保护设置及会话接口，但不会代替向导中填写的 API Key。

数据卷会在容器重启后保留 `/data`。为了让服务能够使用，设置文件会以明文保存 API Key；在支持的平台上文件使用 `0600` 模式创建。请用服务器账户的文件系统权限保护数据卷和备份。

## Render

仓库的 `render.yaml` 会创建 Docker Web Service、`/data` 持久磁盘和自动生成的初始化口令。模板使用 Render 的付费 Starter 服务和持久磁盘；创建前请在 Render 页面确认当前价格。

本仓库不声称该模板已经完成线上部署。创建服务后，请确认 HTTPS 地址；使用自定义域名时设置 `PUBLIC_ORIGIN`；从部署环境或日志取得初始化口令，然后完整运行设置和麦克风检查。

## 环境变量

普通用户优先使用浏览器向导，以下变量适合自动化部署：

| 变量 | 作用 |
| --- | --- |
| `LIVE_PROVIDER` | 实时语音服务类型（`azure` 或 `compatible`）。 |
| `LIVE_BASE_URL` | 实时语音服务的 HTTPS API 根地址。 |
| `LIVE_API_KEY` | 仅由服务端读取的 API Key。 |
| `LIVE_MODEL` | 实时语音部署名或模型名。 |
| `REASONING_BASE_URL` | 可选的兼容 Responses API 的根地址。 |
| `REASONING_API_KEY` | 仅由服务端读取的可选推理 Key。 |
| `REASONING_MODEL` | 可选的推理模型或部署名。 |
| `REASONING_AUTH` | 可选后端鉴权方式（`bearer` 或 `api-key`）。 |
| `APP_MODE` | `local` 或 `remote`。 |
| `HOST`、`PORT` | 监听地址和端口。 |
| `APP_DATA_DIR` | 设置和应用数据目录。 |
| `PUBLIC_ORIGIN` | 服务器模式必需的 HTTPS 根地址。 |
| `SETUP_TOKEN` | 远程首次设置口令。 |

服务保存地址时会去掉末尾的接口路径，并拒绝包含凭据或不安全查询参数的 URL。不要把 Key 放进 URL。

## 数据位置和隐私

没有设置 `APP_DATA_DIR` 时，默认位置是：

- Windows：`%LOCALAPPDATA%\GPTLiveDemo`
- macOS：`~/Library/Application Support/GPTLiveDemo`
- Linux：`$XDG_CONFIG_HOME/gpt-live-demo` 或 `~/.config/gpt-live-demo`

服务端不会把完整 API Key 返回给浏览器，面向用户的错误消息也会隐藏已配置的密钥。请保护数据目录、`.env`、初始化口令和备份。公开仓库和 Windows 发行包不包含你的个人设置。

## 常见问题

- **麦克风列表为空：** 允许麦克风权限，重新加载设置页，并在连接前运行麦克风测试。
- **语音或推理测试返回 401/403：** 确认 Key 属于当前地址，并有权访问填写的部署名。
- **测试返回 404：** 使用服务控制台显示的部署名或模型名，并填写 HTTPS API 根地址，不要填网页地址。
- **只能进行语音和时间回答：** 可能跳过了可选推理后端，或后端测试未通过。保存有效配置并重新连接。
- **远程浏览器无法使用麦克风：** 通过 HTTPS 打开服务，并检查浏览器站点权限。远程普通 HTTP 不足以使用麦克风。
- **端口被占用：** 停止旧进程或设置其他 `PORT`，然后打开对应的本机地址。
