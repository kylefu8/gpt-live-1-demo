import {spawn} from 'node:child_process';
import process from 'node:process';
import {startServer} from './server.mjs';
import {translateMessage} from './ui-messages.mjs';

const language=Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh')?'zh-CN':'en';
const text=(zh,en)=>language==='zh-CN'?zh:en;

const openRequested = process.argv.includes('--open') || process.env.GPT_LIVE_PACKAGED === '1';

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, {detached: true, stdio: 'ignore', windowsHide: true});
  child.unref();
  child.on('error', error => {
    console.warn(text(`浏览器未能自动打开，请手动访问 ${url}`,`The browser could not open automatically. Visit ${url}`));
  });
}

let running;
try {
  running = await startServer({autoPort: true});
  console.log(text(`GPT Live 1 Demo 已启动：${running.url}`,`GPT Live 1 Demo started: ${running.url}`));
  console.log(text(`数据目录：${running.dataDir}`,`Private data directory: ${running.dataDir}`));
  if (openRequested) openBrowser(running.url);
} catch (error) {
  console.error(text('启动失败：','Startup failed: ')+translateMessage(error instanceof Error ? error.message : String(error),language));
  console.error(text('请检查配置、端口和运行环境后重试。','Check your settings, port, and runtime, then try again.'));
  process.exitCode = 1;
}

async function stop() {
  if (!running?.close) return;
  try {
    await running.close();
  } catch (error) {
    console.error(text('关闭服务时出错：','Shutdown failed: ')+translateMessage(error instanceof Error ? error.message : String(error),language));
  }
}

process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
