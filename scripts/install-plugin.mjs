import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = root;
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profileName = process.argv[2] || 'desktop';
if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) throw new Error('profile 名称无效');
const profile = path.join(home, 'profiles', profileName);
const packageFile = path.join(profile, 'package.json'), patchFile = path.join(profile, 'cordis.patch.yml');
JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const patch = fs.readFileSync(patchFile, 'utf8');
const backup = path.join(home, 'room-world', 'install-backups', String(Date.now()));
fs.mkdirSync(backup, { recursive: true });
fs.copyFileSync(packageFile, path.join(backup, 'package.json'));
fs.copyFileSync(patchFile, path.join(backup, 'cordis.patch.yml'));
const lockFile = path.join(profile, 'pnpm-lock.yaml');
if (fs.existsSync(lockFile)) fs.copyFileSync(lockFile, path.join(backup, 'pnpm-lock.yaml'));
// Register through DSH's own package manager, including its lockfile. A hand-made
// junction and package.json entry alone do not appear in pnpm's installed list.
const dshExe = process.env.DSH_DESKTOP_EXE || path.join(path.parse(root).root, 'DSH', 'DeepSeek Harness.exe');
if (!fs.existsSync(dshExe)) throw new Error('找不到 DSH 程序，请设置 DSH_DESKTOP_EXE 为 DeepSeek Harness.exe 的绝对路径后重试。');
const cli = path.join(path.dirname(dshExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
const installed = spawnSync(dshExe, ['--expose-internals', cli, 'plugin', '--profile', profileName,
  'add', 'link:' + plugin.replaceAll('\\', '/'), '--offline', '--ignore-scripts'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
});
if (installed.error || installed.status !== 0) throw new Error('DSH 官方安装未成功，未继续改动启用配置。备份：' + backup);
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.dsh ||= {}; pkg.dsh.profile ||= {}; pkg.dsh.profile.bundles ||= [];
if (!pkg.dsh.profile.bundles.includes('dsh-room-world')) pkg.dsh.profile.bundles.push('dsh-room-world');
fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
if (!/^\s*- id: dsh-room-world\s*$/m.test(patch)) {
  // A bot plugin to read persona and QQ history from: ROOM_WORLD_BOT_NAME (its plugin id), optional ROOM_WORLD_BOT_ROOT.
  const botName = (process.env.ROOM_WORLD_BOT_NAME || '').trim(), botRoot = (process.env.ROOM_WORLD_BOT_ROOT || '').trim();
  const adapterConfig = botName
    ? '    adapter: bot\n    botName: ' + JSON.stringify(botName) + '\n' + (botRoot ? '    botRoot: ' + JSON.stringify(botRoot.replaceAll('\\', '/')) + '\n' : '')
    : '    adapter: standalone\n';
  fs.writeFileSync(patchFile, patch + '\n# Independent room/world plugin\n- id: dsh-room-world\n  config:\n' + adapterConfig);
}
// Bot plugins may restrict which tools QQ chats can call; that list belongs to the bot, so it is not edited here.
if (process.env.ROOM_WORLD_BOT_NAME) console.log('提示：如果机器人插件限制了 QQ 可用工具，请在它的白名单里加入 room_world。');
console.log('已安装独立房间插件到 DSH profile：' + profileName + '。重载 DSH 后生效。备份：' + backup);
