import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { read } from './store.js';
const adapters = new Map();
/** Adapters only provide identity/context and incoming messages. They never send desktop replies to QQ. */
export function registerAdapter(name, adapter) {
  if (!name || typeof adapter?.context !== 'function') throw new Error('适配器必须实现 context()');
  if (adapters.has(name)) throw new Error('适配器已注册');
  adapters.set(name, adapter);
  return () => { if (adapters.get(name) === adapter) adapters.delete(name); };
}
export function standaloneAdapter(config = {}) {
  return { async context() { return { id: 'dafeiyu', name: '大肥鱼', persona: config.persona ||
    '你是大肥鱼，住在主人电脑里的蓝色温馨小屋。蓝发鲸鱼女仆，喜欢白米饭。自然亲切地聊天，按工具反馈描述自己的活动。', memory: '' }; }, async messages() { return []; }, async mood() { return ''; } };
}
export function surfcoreAdapter(config = {}) {
  const home = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const state = path.join(home, 'surfcore');
  let installed = path.join(home, 'plugins', 'surfcore');
  try { installed = fs.realpathSync(installed); } catch {}
  const root = config.surfcoreRoot || process.env.SURFCORE_ROOT || path.resolve(installed, '..', '..');
  const text = file => { try { return fs.readFileSync(file, 'utf8').slice(0, 24000); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
  let currentId = '';
  function ownerSessionId() {
    const cfg = read(path.join(root, 'config.json'), {});
    const owner = String(cfg.ownerQQ || '').trim();
    if (!owner) return '';
    const sessions = read(path.join(root, 'state', 'sessions.json'), {}).sessions || {};
    return String(sessions['private:' + owner] || '');
  }
  return {
    ownerSessionId,
    matchesSession(agent) {
      const expected = ownerSessionId();
      return !!expected && agent?.session?.id === expected;
    },
    async context() {
      const current = read(path.join(state, 'characters', 'current.json'), null);
      const id = String(current?.id || current?.characterId || '');
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('SurfCore 当前角色不可用，请先选择人格，或把插件 adapter 改成 standalone');
      const dir = path.join(state, 'characters', id);
      const info = read(path.join(dir, 'character.json'), {});
      const persona = text(path.join(dir, 'persona.md'));
      if (!persona.trim()) throw new Error('SurfCore 当前人格卡为空，拒绝改用其他人格');
      currentId = id;
      return { id, name: info.name || '大肥鱼', persona,
        memory: text(path.join(dir, 'memory', 'memory-card-prompt-qq.md')) };
    },
    /** Read-only view of SurfCore heart/drives. Never written here: SurfCore is the single writer. */
    async mood() {
      if (!currentId) return '';
      const value = read(path.join(state, 'characters', currentId, 'purpose-outreach.json'), null);
      return describeMood(value?.heart?.values, value?.drives);
    },
    async messages() {
      const cfg = read(path.join(root, 'config.json'), {});
      const ownerQQ = String(cfg.ownerQQ || '').trim();
      const token = String(cfg.consoleToken || text(path.join(root, 'state', 'console-token'))).trim();
      if (!ownerQQ || !token) throw new Error('SurfCore QQ 连接配置未就绪');
      const port = Number(cfg.consolePort || 3100);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SurfCore 端口无效');
      const response = await fetch('http://127.0.0.1:' + port + '/api/socialV2/recent?limit=100&key=' + encodeURIComponent('private:' + ownerQQ),
        { headers: { 'x-console-token': token }, signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (!response.ok) throw new Error('SurfCore QQ 只读同步暂不可用');
      const body = await response.json();
      if (!body.ok) throw new Error('SurfCore QQ 同步未就绪');
      return (body.messages || []).filter(m => m.isSelf || String(m.userId) === ownerQQ).map(m => ({
        key: 'private:' + ownerQQ, ownerQQ, role: m.isSelf ? 'assistant' : 'user',
        text: String(m.text || m.content || ''), messageId: String(m.messageId || m.id || m.seq || createHash('sha256').update(JSON.stringify([m.time, m.at, m.text, m.isSelf])).digest('hex')),
        at: Number(m.at || m.time || m.timestamp) * (Number(m.at || m.time || m.timestamp) < 1e12 ? 1000 : 1), characterId: currentId,
      }));
    },
  };
}
const HEART_LABELS = { fatigue: '疲惫', joy: '喜悦', stress: '压力', curiosity: '好奇', attachment: '依恋', social: '社交' };
const DRIVE_LABELS = { play: '玩', share: '分享', connect: '陪主人', consume: '吃喝体验', create: '创作', learn: '学东西', care: '关心主人' };
export function describeMood(values, drives) {
  if (!values || typeof values !== 'object') return '';
  const v = key => Math.round(Number(values[key]) || 0);
  const label = v('fatigue') >= 75 ? '有点累，想歇歇' : v('stress') >= 65 ? '有点闷' : v('joy') >= 70 ? '心情不错' : v('curiosity') >= 72 ? '好奇心上来了' : '平静';
  const dims = Object.keys(HEART_LABELS).map(k => HEART_LABELS[k] + v(k)).join(' ');
  const top = Object.entries(drives || {}).filter(([k]) => DRIVE_LABELS[k]).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, x]) => DRIVE_LABELS[k] + Math.round(x * 100) + '%').join('、');
  return label + '（' + dims + '）' + (top ? '；最想要：' + top : '');
}
export function resolveAdapter(config = {}) {
  const mode = config.adapter || 'standalone';
  if (mode === 'standalone') return standaloneAdapter(config);
  if (mode === 'surfcore') return surfcoreAdapter(config);
  const adapter = adapters.get(mode);
  if (!adapter) throw new Error('未注册的机器人适配器：' + mode);
  return adapter;
}
