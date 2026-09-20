# 部署说明

## 本机

页面向导是默认入口。开发模式下运行 npm start，Windows 发行包运行 Start.cmd，二者都会启动本机服务并打开浏览器。浏览器需要允许麦克风。

本机模式默认绑定 127.0.0.1，不需要管理员账号。数据目录由运行时选择系统私有位置；使用 APP_DATA_DIR 可以显式指定一个目录。不要把这个目录放进 Git 或 Docker 构建上下文。

## 容器

本机容器运行：

~~~text
docker compose -f compose.yml up --build
~~~

这个模板仍然将宿主机端口绑定到 127.0.0.1。停止服务：

~~~text
docker compose -f compose.yml down
~~~

如果需要保留设置，保留 compose 创建的数据卷；删除卷会删除应用保存的设置和凭据。

远程服务器运行 compose.remote.yml 前，复制 .env.example 为 .env，并设置 APP_MODE=remote、HOST=0.0.0.0、APP_DATA_DIR=/data、PUBLIC_ORIGIN=https://你的域名。SETUP_TOKEN 可以由部署系统生成，也可以在启动前手动设置一个随机值。

远程模式会要求 HTTPS 来源和首次设置令牌。反向代理应该把 HTTPS 请求转发到容器的 8767 端口，并正确转发 WebSocket/HTTP 升级请求。先用健康检查确认 /api/health 可访问，再从浏览器打开首页完成设置。

## Render

render.yaml 使用 Docker 运行时和 /data 持久磁盘。应用会读取 Render 提供的 HTTPS 外部地址；使用自定义域名时再设置 PUBLIC_ORIGIN。保留 SETUP_TOKEN 生成值，首次设置时从服务日志取得令牌。

应用自己的管理员登录保护配置和运行接口。不要把令牌和 API Key 写进 render.yaml。此模板使用付费服务与持久磁盘，请在 Render 的部署确认页核对费用。

## 配置变量

.env.example 中的服务配置是可选的。多数用户可以先启动，再在浏览器设置向导中填写：

- LIVE_PROVIDER、LIVE_BASE_URL、LIVE_API_KEY、LIVE_MODEL
- REASONING_BASE_URL、REASONING_API_KEY、REASONING_MODEL、REASONING_AUTH
- APP_MODE、HOST、PORT、APP_DATA_DIR
- PUBLIC_ORIGIN、SETUP_TOKEN

Key 只由本机服务读取。浏览器不应收到完整 Key；日志和诊断信息也不应包含 Key。
