# 发布清单

## 发布前

1. 在干净的检出目录运行 npm ci。
2. 运行 npm test。
3. 运行 npm run check:release。
4. 检查 .env、数据目录、日志、截图、音频和测试输出没有进入 Git。
5. 确认 README、许可证和部署模板中的地址都是通用示例。

## Windows ZIP

在项目目录运行：

~~~text
npm run build:release -- --out-dir ../releases/gpt-live-1-demo
~~~

脚本会：

- 只复制 allowlist 中的应用模块、public 和必要文档；
- 下载固定版本的官方 Node 24 Windows x64 ZIP；
- 下载官方 SHASUMS256.txt，并同时核对固定 SHA-256；
- 用随 Node 一起提供的 npm 安装生产依赖；
- 写入根目录 Start.cmd；
- 生成带版本号的 Windows x64 ZIP。

发行包中 app 和 runtime 必须保持同级。不要单独上传 app 目录，也不要把 .env、应用数据目录或本机日志复制进去。

## GitHub Releases

发布 `v*` 标签后，GitHub Actions 会运行检查、构建 Windows ZIP，并创建带校验文件的 GitHub Release。也可以在本机生成候选包验证。上传前查看压缩包目录：

~~~text
tar -tf ../releases/gpt-live-1-demo-0.1.0-windows-x64.zip
~~~

确认只包含 Start.cmd、runtime 和 app。Windows 端验收：

1. 将 ZIP 解压到没有 Node.js 的 Windows 用户目录。
2. 双击 Start.cmd。
3. 浏览器打开首页，完成实时语音服务配置。
4. 选择麦克风并确认测试、连接、断开、重新打开都能工作。
5. 关闭程序后确认设置仍在系统私有数据目录，而不是 ZIP 目录。

## 版本变更

升级 Node 24 时，在 scripts/build-release.mjs 中同时更新版本和固定 SHA-256，然后重新执行构建。升级依赖后提交 package-lock.json。任何版本都需要重新执行隐私扫描和发行包 smoke test。
