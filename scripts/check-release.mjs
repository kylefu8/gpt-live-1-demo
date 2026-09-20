import {readFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenName = /\.(env|key|pem|pfx|p12|clixml|log)$/i;
const forbiddenPath = /(?:[A-Za-z]:[\\/]+Users[\\/]|\/Users\/|\/home\/|\\\\Users\\\\)/;
const sourceFiles = [
  'package.json', 'package-lock.json', 'launcher.mjs', 'server.mjs',
  'backend.mjs', 'config.mjs', 'delivery.mjs', 'fast-time.mjs', 'tools.mjs',
  'auth.mjs', 'connections.mjs', 'settings-store.mjs',
  'README.md', 'LICENSE', '.env.example', 'Dockerfile', 'compose.yml',
  'compose.remote.yml', 'render.yaml'
];

async function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(fullPath));
    else result.push(fullPath);
  }
  return result;
}

const files = [];
for (const name of sourceFiles) if (existsSync(join(root, name))) files.push(join(root, name));
for (const name of ['public', 'modules', 'docs']) files.push(...await filesUnder(join(root, name)));

const failures = [];
for (const file of files) {
  const relative = file.slice(root.length + 1);
  if (forbiddenName.test(relative) && relative.toLowerCase() !== '.env.example') {
    failures.push(relative + ': 文件类型不应发布');
  }
  const text = await readFile(file, 'utf8');
  if (forbiddenPath.test(text)) failures.push(relative + ': 含有本机用户路径');
  if (text.includes('-----BEGIN PRIVATE KEY-----')) failures.push(relative + ': 含有私钥材料');
  if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) failures.push(relative + ': 含有疑似 API Key');
}
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'gpt-live-1-demo') failures.push('package.json: 包名必须为 gpt-live-1-demo');
if (!existsSync(join(root, '.env.example'))) failures.push('.env.example: 缺少通用配置示例');
if (failures.length) {
  console.error('发布检查失败：');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log('发布检查通过：配置示例、路径和疑似凭据扫描未发现问题。');
}
