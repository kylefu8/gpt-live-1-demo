# GPT Live 1 Demo

一个可以自行部署的实时语音助手示例。浏览器负责麦克风、播放和实时字幕，本机服务负责会话连接、工具调用以及可选的推理后端。项目不绑定某一家推理服务，首次打开页面会进入配置向导。

这是非官方示例，需要支持 GPT-Live `/live/sessions` 协议的语音服务；普通聊天接口或其他 Realtime 接口不能直接替代。

项目地址：<https://github.com/kylefu8/gpt-live-1-demo>

## 最省事的方式：Windows 发行包

没有 Node.js 的用户直接下载 [GitHub Releases](https://github.com/kylefu8/gpt-live-1-demo/releases/latest) 中的 Windows x64 ZIP：

1. 解压完整 ZIP，不要只复制其中的 app 或 runtime 文件夹。
2. 双击 Start.cmd。
3. 浏览器打开后，按向导填写实时语音服务地址、部署名和 API Key。
4. 如需天气、搜索、复杂问答，再填写一个 Responses 兼容的推理后端；也可以先跳过。
5. 在向导中选择麦克风和音色，然后开始对话。

运行中的设置和凭据保存在操作系统的应用私有数据目录，不写回发行包目录。发行包中的 Start.cmd 使用自带的 Node 运行时，因此 Windows 用户不需要另行安装 Node.js。

第一次使用前需要准备：

- 一个可用的实时语音服务 API 地址、部署名或模型名以及 API Key。
- 可选的 Responses 兼容推理服务地址、模型名以及 API Key。
- 浏览器麦克风权限；远程部署时还需要 HTTPS。

## 本地开发

开发者需要 Node.js 22 或更高版本：

~~~text
npm ci
npm start
~~~

npm start 会启动服务并打开浏览器。只启动 HTTP 服务时使用：

~~~text
npm run start:server
~~~

运行测试：

~~~text
npm test
~~~

本地默认只绑定回环地址。用户可以通过页面设置向导完成连接配置；高级部署也可以复制 .env.example 为 .env，再填写环境变量。

## Docker

最简单的本机容器方式：

~~~text
docker compose -f compose.yml up --build
~~~

打开 <http://127.0.0.1:8767/>，然后完成页面向导。应用数据放在 Docker 的 gpt-live-1-demo-data 卷中。

远程服务器使用 compose.remote.yml 时，请先准备一个只在服务器保存的 .env，至少设置：

~~~dotenv
APP_MODE=remote
HOST=0.0.0.0
PUBLIC_ORIGIN=https://voice.example.com
SETUP_TOKEN=change-this-before-starting
APP_DATA_DIR=/data
~~~

远程模式要求 PUBLIC_ORIGIN 使用 HTTPS，并要求反向代理负责 TLS。不要把 .env 提交到 Git。容器端口可以通过反向代理公开；如果直接开放端口，仍应在防火墙和访问控制层保护它。

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kylefu8/gpt-live-1-demo)

仓库包含 render.yaml，用于创建一个 Docker Web Service 和 /data 持久磁盘。部署后：

1. 等待部署完成，应用会先显示受初始化口令保护的设置页。
2. Render 会把服务的 HTTPS 地址提供给应用；自定义域名部署时再设置 PUBLIC_ORIGIN。
3. Render 会生成 SETUP_TOKEN；从服务日志取出首次设置令牌。
4. 打开服务地址，完成管理员设置和语音/推理服务配置。

真实密钥只在 Render 环境变量或页面的受保护设置中保存，不要放进仓库。

该模板使用付费常驻服务和持久磁盘，费用以 Render 的部署确认页为准。

## 配置说明

页面向导适合普通用户，.env 适合自动化部署。可用变量见 .env.example：

- LIVE_PROVIDER、LIVE_BASE_URL、LIVE_API_KEY、LIVE_MODEL：实时语音服务。
- REASONING_BASE_URL、REASONING_API_KEY、REASONING_MODEL、REASONING_AUTH：可选的 Responses 兼容推理服务。
- APP_MODE、HOST、PORT、APP_DATA_DIR：运行方式和数据位置。
- PUBLIC_ORIGIN、SETUP_TOKEN：远程部署的来源校验和首次设置保护。

服务不会把 API Key 返回给浏览器。导出诊断信息时应继续检查内容，确保没有把请求头、环境变量或私有日志粘贴到公开 issue。

## 设计边界

实时语音模型负责听说和打断。明确的时间、日期问题直接读取本机时钟；计算、天气及搜索目前由配置的推理后端调度工具。对话页面显示时间戳、按句换行，并在语音未响应时保留文字答案。

语音服务、推理服务、搜索服务和浏览器之间的网络费用由部署者自己的账户承担。本仓库只提供示例应用和启动方式，不包含任何服务凭据。

## 发布和隐私

仓库只提交通用源码。.gitignore 和 .dockerignore 会排除 .env、密钥文件、日志、测试数据、发行目录和本机工作目录。提交前请运行：

~~~text
npm run check:release
~~~

制作 Windows 发行包：

~~~text
npm run build:release -- --out-dir ../releases/gpt-live-1-demo
~~~

构建脚本会下载固定版本的官方 Node 24 Windows x64 运行时，读取官方 SHASUMS256.txt，再用 SHA-256 校验后放入发行包。它只复制经过 allowlist 审查的应用文件和生产依赖，不会复制测试、工作目录或本机配置。完整的发布步骤见 docs/RELEASE.md。

## License

MIT，见 LICENSE。
