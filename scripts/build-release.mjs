import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, mkdir, writeFile, cp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VERSION = 'v24.21.0';
const NODE_PLATFORM = 'win-x64';
const NODE_ARCHIVE = 'node-' + NODE_VERSION + '-' + NODE_PLATFORM + '.zip';
const NODE_SHA256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
const NODE_BASE_URL = 'https://nodejs.org/dist/' + NODE_VERSION;

// This is deliberately an allowlist. A release must never pick up tests, local
// working files, credentials, logs, or an unreviewed file added to the project.
const APP_FILES = [
  'package.json', 'package-lock.json', 'launcher.mjs', 'server.mjs',
  'backend.mjs', 'config.mjs', 'delivery.mjs', 'fast-time.mjs', 'tools.mjs',
  'auth.mjs', 'connections.mjs', 'settings-store.mjs', 'ui-messages.mjs', 'search.mjs',
  'README.md', 'README.zh-CN.md', 'LICENSE', '.env.example', 'Dockerfile', 'compose.yml',
  'compose.remote.yml', 'render.yaml'
];
const APP_DIRECTORIES = ['public', 'docs'];

const START_CMD = [
  '@echo off',
  'setlocal EnableExtensions',
  'cd /d "%~dp0"',
  'if not exist "runtime\\node.exe" (',
  '  echo Runtime is missing. Please extract the complete release ZIP and run Start.cmd again.',
  '  pause',
  '  exit /b 1',
  ')',
  'if not exist "app\\launcher.mjs" (',
  '  echo Application files are missing. Please extract the complete release ZIP and run Start.cmd again.',
  '  pause',
  '  exit /b 1',
  ')',
  'set "GPT_LIVE_PACKAGED=1"',
  '"runtime\\node.exe" "app\\launcher.mjs" --open',
  'set "exitCode=%ERRORLEVEL%"',
  'if not "%exitCode%"=="0" (',
  '  echo.',
  '  echo The app could not start. Review the error above, then try again.',
  '  pause',
  ')',
  'exit /b %exitCode%',
  ''
].join('\r\n');

function parseArgs(argv) {
  const options = {outDir: resolve(PROJECT_ROOT, '..', 'releases'), skipRuntime: false, skipInstall: false, noZip: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--out-dir 后需要目录路径');
      options.outDir = resolve(process.cwd(), value);
    } else if (arg === '--skip-runtime') {
      options.skipRuntime = true;
    } else if (arg === '--skip-install') {
      options.skipInstall = true;
    } else if (arg === '--no-zip') {
      options.noZip = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/build-release.mjs [--out-dir DIR] [--skip-runtime] [--skip-install] [--no-zip]');
      console.log('默认输出到项目旁的 releases 目录，并制作 Windows x64 ZIP。');
      process.exit(0);
    } else {
      throw new Error('未知参数：' + arg);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', windowsHide: true, ...options});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(command + ' 退出码 ' + code)));
  });
}

async function download(url, destination) {
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok) throw new Error('下载失败（HTTP ' + response.status + '）：' + url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, buffer);
}

async function sha256(file) {
  const hash = createHash('sha256');
  const data = await readFile(file);
  hash.update(data);
  return hash.digest('hex');
}

async function extractArchive(archive, destination) {
  await mkdir(destination, {recursive: true});
  try {
    await run('tar', ['-xf', archive, '-C', destination]);
  } catch (tarError) {
    if (process.platform !== 'win32') throw tarError;
    const escapedArchive = archive.replaceAll("'", "''");
    const escapedDestination = destination.replaceAll("'", "''");
    const command = "Expand-Archive -LiteralPath '" + escapedArchive + "' -DestinationPath '" + escapedDestination + "' -Force";
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
  }
}

async function copyIfPresent(source, destination) {
  if (!existsSync(source)) return false;
  await mkdir(dirname(destination), {recursive: true});
  await cp(source, destination, {recursive: true, force: true});
  return true;
}

function ensureSafeOutput(projectRoot, output) {
  const normalizedRoot = resolve(projectRoot);
  const normalizedOutput = resolve(output);
  if (normalizedRoot === normalizedOutput) throw new Error('输出目录不能是项目根目录');
  if (normalizedOutput === resolve(normalizedRoot, 'node_modules')) throw new Error('输出目录不能是 node_modules');
  if (existsSync(normalizedOutput)) throw new Error('输出目录已存在，为避免覆盖请换一个新目录：' + normalizedOutput);
  return normalizedOutput;
}

function assertSafeTemp(tempDir) {
  const tempRoot = resolve(tmpdir());
  const normalized = resolve(tempDir);
  if (!normalized.startsWith(tempRoot + sep) || !basename(normalized).startsWith('gpt-live-1-demo-release-')) {
    throw new Error('临时目录不在受保护的构建临时路径中：' + normalized);
  }
}

async function makeRuntime(outDir, tempDir) {
  const archivePath = join(tempDir, NODE_ARCHIVE);
  const sumsPath = join(tempDir, 'SHASUMS256.txt');
  await download(NODE_BASE_URL + '/' + NODE_ARCHIVE, archivePath);
  await download(NODE_BASE_URL + '/SHASUMS256.txt', sumsPath);
  const sums = await readFile(sumsPath, 'utf8');
  const line = sums.split(/\r?\n/).find(value => value.trim().endsWith(' ' + NODE_ARCHIVE));
  const publishedHash = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!publishedHash) throw new Error('官方校验文件中没有找到 ' + NODE_ARCHIVE);
  if (publishedHash !== NODE_SHA256) throw new Error('Node ' + NODE_VERSION + ' 校验值与固定值不一致，已停止打包');
  const actualHash = await sha256(archivePath);
  if (actualHash !== publishedHash) throw new Error('Node 运行时 SHA-256 校验失败：' + actualHash);

  const extracted = join(tempDir, 'extracted');
  await extractArchive(archivePath, extracted);
  const sourceRuntime = join(extracted, 'node-' + NODE_VERSION + '-' + NODE_PLATFORM);
  if (!existsSync(join(sourceRuntime, 'node.exe'))) throw new Error('Node 压缩包内容不完整');
  await cp(sourceRuntime, join(outDir, 'runtime'), {recursive: true, force: true});
  return join(outDir, 'runtime', 'node.exe');
}

async function copyApplication(outDir) {
  const appDir = join(outDir, 'app');
  await mkdir(appDir, {recursive: true});
  for (const file of APP_FILES) await copyIfPresent(join(PROJECT_ROOT, file), join(appDir, file));
  for (const directory of APP_DIRECTORIES) await copyIfPresent(join(PROJECT_ROOT, directory), join(appDir, directory));
  if (!existsSync(join(appDir, 'package.json')) || !existsSync(join(appDir, 'launcher.mjs'))) {
    throw new Error('发布包缺少 package.json 或 launcher.mjs');
  }
  await writeFile(join(outDir, 'Start.cmd'), START_CMD, 'ascii');
  return appDir;
}

async function installProductionDependencies(outDir, appDir, runtimeNode, useBundledRuntime) {
  const npmCli = join(outDir, 'runtime', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (useBundledRuntime) {
    if (!existsSync(npmCli)) throw new Error('Node 运行时缺少 npm，无法安装生产依赖');
    await run(runtimeNode, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: appDir});
  } else {
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: appDir, shell: process.platform === 'win32'});
  }
}

async function makeZip(outDir, archivePath) {
  if (existsSync(archivePath)) throw new Error('发行 ZIP 已存在，为避免覆盖请换一个新目录或删除旧 ZIP：' + archivePath);
  await run('tar', ['-a', '-c', '-f', archivePath, '-C', outDir, '.']);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = ensureSafeOutput(PROJECT_ROOT, options.outDir);
  const tempDir = await mkdtemp(join(tmpdir(), 'gpt-live-1-demo-release-'));
  assertSafeTemp(tempDir);
  try {
    await mkdir(output, {recursive: true});
    const appDir = await copyApplication(output);
    let runtimeNode = process.execPath;
    if (!options.skipRuntime) runtimeNode = await makeRuntime(output, tempDir);
    if (!options.skipInstall) await installProductionDependencies(output, appDir, runtimeNode, !options.skipRuntime);
    const packageJson = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (!options.noZip) {
      const archivePath = join(dirname(output), packageJson.name + '-' + packageJson.version + '-windows-x64.zip');
      await makeZip(output, archivePath);
      console.log('已生成：' + archivePath);
    }
    console.log('发布目录：' + output);
    console.log('Windows 用户运行 Start.cmd；应用数据保存在系统私有数据目录。');
  } finally {
    assertSafeTemp(tempDir);
    await rm(tempDir, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error('发布构建失败：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
