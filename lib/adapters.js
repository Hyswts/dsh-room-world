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
  return { async context() { return { id: 'dafeiyu', name: '大肥鱼', persona: (config.persona && typeof config.persona === 'object' && typeof config.persona.get === 'function' ? config.persona.get() : config.persona) ||
    '你是大肥鱼，住在主人电脑里的蓝色温馨小屋。蓝发鲸鱼女仆，喜欢白米饭。自然亲切地聊天，按工具反馈描述自己的活动。', memory: '' }; }, async messages() { return []; }, async mood() { return ''; } };
}
/**
 * Generic adapter for a DSH bot plugin that keeps its persona, memory and QQ sessions on disk.
 * botName is the bot plugin's id: its state lives in ~/.dsh/<botName> and its install in ~/.dsh/plugins/<botName>.
 * botRoot is the bot's source folder (config.json, state/sessions.json); by default it is found from the install link.
 */
export function botAdapter(config = {}) {
  const home = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const name = String(config.botName || process.env.ROOM_WORLD_BOT_NAME || '').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('机器人适配器需要 botName：填写机器人插件的名字，或把 adapter 改成 standalone');
  const state = config.botStateDir || path.join(home, name);
  let installed = path.join(home, 'plugins', name);
  try { installed = fs.realpathSync(installed); } catch {}
  const root = config.botRoot || process.env.ROOM_WORLD_BOT_ROOT || path.resolve(installed, '..', '..');
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
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('机器人插件当前角色不可用，请先选择人格，或把插件 adapter 改成 standalone');
      const dir = path.join(state, 'characters', id);
      const info = read(path.join(dir, 'character.json'), {});
      const persona = text(path.join(dir, 'persona.md'));
      if (!persona.trim()) throw new Error('机器人插件当前人格卡为空，拒绝改用其他人格');
      currentId = id;
      return { id, name: info.name || '大肥鱼', persona,
        memory: text(path.join(dir, 'memory', 'memory-card-prompt-qq.md')) };
    },
    /** Read-only view of the bot's heart/drives. Never written here: the bot plugin is the single writer. */
    async mood() {
      if (!currentId) return '';
      const value = read(path.join(state, 'characters', currentId, 'purpose-outreach.json'), null);
      return describeMood(value?.heart?.values, value?.drives, value);
    },
    async messages() {
      const cfg = read(path.join(root, 'config.json'), {});
      const ownerQQ = String(cfg.ownerQQ || '').trim();
      const token = String(cfg.consoleToken || text(path.join(root, 'state', 'console-token'))).trim();
      if (!ownerQQ || !token) throw new Error('机器人插件的 QQ 连接配置未就绪');
      const port = Number(cfg.consolePort || 3100);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('机器人插件的控制台端口无效');
      const response = await fetch('http://127.0.0.1:' + port + '/api/socialV2/recent?limit=100&key=' + encodeURIComponent('private:' + ownerQQ),
        { headers: { 'x-console-token': token }, signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (!response.ok) throw new Error('机器人插件的 QQ 只读同步暂不可用');
      const body = await response.json();
      if (!body.ok) throw new Error('机器人插件的 QQ 同步未就绪');
      return (body.messages || []).filter(m => m.isSelf || String(m.userId) === ownerQQ).map(m => ({
        key: 'private:' + ownerQQ, ownerQQ, role: m.isSelf ? 'assistant' : 'user',
        text: String(m.text || m.content || ''), messageId: String(m.messageId || m.id || m.seq || createHash('sha256').update(JSON.stringify([m.time, m.at, m.text, m.isSelf])).digest('hex')),
        at: Number(m.at || m.time || m.timestamp) * (Number(m.at || m.time || m.timestamp) < 1e12 ? 1000 : 1), characterId: currentId,
      }));
    },
  };
}
const HEART_LABELS = { fatigue: '疲惫', joy: '喜悦', stress: '压力', curiosity: '好奇', attachment: '依恋', social: '社交' };
const DRIVE_LABELS = { play: '玩', share: '分享', connect: '陪主人', consume: '吃喝体验', create: '创作', learn: '学东西', care: '关心主人', install: '装点新东西', identity: '做自己' };
const EMOTION_LABELS = { curious: '好奇', excited: '兴奋', lonely: '寂寞', envious: '羡慕', worried: '担心', proud: '得意', affectionate: '亲近', bored: '无聊', amused: '好笑', content: '平静' };
export function describeMood(values, drives, extra = {}) {
  const heart = values && typeof values === 'object' ? values : null;
  const v = key => Math.round(Number(heart?.[key]) || 0);
  const hasHeart = !!heart;
  let label = '';
  if (hasHeart) {
    label = v('fatigue') >= 75 ? '有点累，想歇歇' : v('stress') >= 65 ? '有点闷' : v('joy') >= 70 ? '心情不错' : v('curiosity') >= 72 ? '好奇心上来了' : '平静';
  }
  // 没有 heart 时用 surfcore 自己的情绪快照；文本比枚举更具体，优先文本。
  const text = String(extra?.lastEmotionText || '').trim().slice(0, 80);
  const emotion = EMOTION_LABELS[String(extra?.lastEmotion || '')] || '';
  if (!text && emotion) label = emotion;
  const dims = hasHeart ? Object.keys(HEART_LABELS).map(k => HEART_LABELS[k] + v(k)).join(' ') : '';
  const top = Object.entries(drives || {}).filter(([k]) => DRIVE_LABELS[k])
    .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2)
    .map(([k, x]) => DRIVE_LABELS[k] + Math.round((Number(x) || 0) * 100) + '%').join('、');
  const parts = [];
  if (text) parts.push(text); else if (label) parts.push(label);
  if (dims) parts.push('（' + dims + '）');
  if (top) parts.push('；最想要：' + top);
  return parts.join('').slice(0, 200);
}
export function resolveAdapter(config = {}) {
  const mode = config.adapter || 'standalone';
  if (mode === 'standalone') return standaloneAdapter(config);
  if (mode === 'bot') return botAdapter(config);
  const adapter = adapters.get(mode);
  if (!adapter) throw new Error('未注册的机器人适配器：' + mode);
  return adapter;
}
