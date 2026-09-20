import {spawn} from 'node:child_process';
import process from 'node:process';
import {startServer} from './server.mjs';

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
    console.warn(`浏览器未能自动打开，请手动访问 ${url}（${error.message}）`);
  });
}

let running;
try {
  running = await startServer({autoPort: true});
  console.log(`GPT Live 1 Demo 已启动：${running.url}`);
  console.log(`数据目录：${running.dataDir}`);
  if (openRequested) openBrowser(running.url);
} catch (error) {
  console.error(`启动失败：${error instanceof Error ? error.message : String(error)}`);
  console.error('请检查配置、端口和运行环境后重试。');
  process.exitCode = 1;
}

async function stop() {
  if (!running?.close) return;
  try {
    await running.close();
  } catch (error) {
    console.error(`关闭服务时出错：${error instanceof Error ? error.message : String(error)}`);
  }
}

process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
