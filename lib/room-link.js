import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOM_ACTIONS = new Set([
  'pet', 'walk', 'roam', 'tour', 'choosebook', 'read', 'computer', 'sleep', 'tea', 'snack',
  'stretch', 'window', 'fish', 'feed', 'water', 'dance', 'rice', 'away', 'home', 'auto', 'pause',
  'lamp-on', 'lamp-off',
]);
const ACTIVITY_NAMES = {
  idle: '在房间里休息', pet: '正在和主人聊天', walk: '正在房间里走动', read: '正在看书',
  computer: '正在玩电脑', sleep: '正在床上睡觉', tea: '正在喝茶', snack: '正在吃点心',
  stretch: '正在伸懒腰', window: '正在窗边看风景', fish: '正在陪小鱼', choosebook: '正在书架旁挑书',
  feed: '正在喂鱼', water: '正在浇花', dance: '正在摇尾巴', rice: '正在吃最喜欢的白米饭', away: '已经出门，暂时不在房间',
};
const PHASE_NAMES = { morning: '清晨', day: '白天', dusk: '黄昏', night: '夜晚' };

function failure(code, error, hint) { return { ok: false, code, error, hint }; }
function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function parseRoomCommand(text) {
  let value = String(text || '').trim().replace(/[。！!～~]+$/g, '');
  value = value.replace(/^(?:小鲸鱼|大肥鱼)[，,：:\s]*/, '').replace(/^(?:请你|你|请)[，,\s]*/, '');
  if (['先别动', '停一下', '暂停活动'].includes(value)) return 'pause';
  if (/不要|别去|别再|不用|不许|不能|别吃|别睡|别动|[？?]|是不是|能不能|如果|我去/.test(value)) return '';
  const rules = [
    ['rice', /^(?:去|快去|回去)?吃(?:一碗)?(?:白米饭|米饭|饭)(?:吧|啦|了)?$/],
    ['read', /^(?:去|快去)?(?:看书|读书)(?:吧)?$/],
    ['choosebook', /^(?:去)?挑(?:一)?本书(?:吧)?$/],
    ['computer', /^(?:去)?(?:玩电脑|用电脑|打游戏)(?:吧)?$/],
    ['sleep', /^(?:去|快去)?(?:睡觉|休息)(?:吧|啦)?$/],
    ['walk', /^(?:去)?散步(?:吧)?$/], ['roam', /^(?:在房间里)?(?:走走|转转|闲逛)(?:吧)?$/],
    ['tour', /^(?:去)?巡视(?:一下)?(?:小屋|房间)?$/], ['tea', /^(?:去)?喝茶(?:吧)?$/],
    ['snack', /^(?:去)?吃点心(?:吧)?$/], ['water', /^(?:去)?浇花(?:吧)?$/],
    ['feed', /^(?:去)?喂(?:小)?鱼(?:吧)?$/], ['window', /^(?:去)?看(?:看)?窗外(?:吧)?$/],
    ['stretch', /^伸(?:个)?懒腰(?:吧)?$/], ['dance', /^摇(?:摇)?尾巴(?:吧)?$/],
    ['away', /^出门(?:走走|散步)?(?:吧)?$/], ['home', /^(?:回家|回来)(?:吧|啦)?$/],
    ['auto', /^(?:自由活动|自己玩|继续活动)(?:吧)?$/], ['pause', /^(?:停一下|暂停活动|先别动)$/],
    ['lamp-on', /^开灯(?:吧)?$/], ['lamp-off', /^关灯(?:吧)?$/],
  ];
  return rules.find(([, pattern]) => pattern.test(value))?.[0] || '';
}

export function createRoomLink({ stateDir, characterId = '', now = Date.now }) {
  const id = () => String(typeof characterId === 'function' ? characterId() : characterId);
  const file = name => path.join(stateDir, 'pet', 'room-link',
    crypto.createHash('sha256').update(id() || 'default').digest('hex').slice(0, 24), name + '.json');

  function room() {
    const value = read(file('context'), null);
    if (!value || now() - value.updatedAt > 30000 || value.updatedAt > now() + 1000) return { online: false };
    return { ...value, online: true };
  }
  function updateRoom(value) {
    if (!value || !Object.hasOwn(ACTIVITY_NAMES, value.activity) || !Object.hasOwn(PHASE_NAMES, value.phase) ||
        !Number.isFinite(value.position?.x) || !Number.isFinite(value.position?.y) ||
        value.position.x < 0 || value.position.x > 100 || value.position.y < 0 || value.position.y > 100) {
      return failure('ROOM_STATE_INVALID', '房间状态无效', '刷新最新版房间后重试。');
    }
    const command = value.lastCommand;
    const lastCommand = command && /^[a-zA-Z0-9-]{1,90}$/.test(command.id) && ROOM_ACTIONS.has(command.action) &&
      ['accepted', 'arrived', 'rejected', 'cancelled'].includes(command.status)
      ? { id: command.id, action: command.action, status: command.status } : null;
    const result = { version: 1, activity: value.activity, phase: value.phase, autonomous: value.autonomous === true,
      position: { x: value.position.x, y: value.position.y }, lastCommand, updatedAt: now() };
    try { write(file('context'), result); return { ok: true, room: result }; }
    catch { return failure('ROOM_STATE_WRITE_FAILED', '无法保存房间当前状态', '检查房间插件状态目录的写权限，再重试连接。'); }
  }
  function journal() {
    const value = read(file('qq'), { cursor: 0, events: [] });
    if (!Number.isSafeInteger(value.cursor) || !Array.isArray(value.events)) throw new Error('房间 QQ 同步记录损坏');
    return value;
  }
  function recordQq({ key, ownerQQ, role = 'user', text, messageId, at = now() }) {
    if (!String(ownerQQ || '').trim() || key !== 'private:' + String(ownerQQ).trim() || !['user', 'assistant'].includes(role)) return { ok: true, ignored: true };
    const body = String(text || '').trim().slice(0, 1200);
    if (!body) return { ok: true, ignored: true };
    try {
      const value = journal();
      const sourceId = role + ':' + String(messageId || crypto.randomUUID());
      if (value.events.some(event => event.sourceId === sourceId)) return { ok: true, duplicate: true };
      const entry = { id: ++value.cursor, sourceId, role, text: body, at: Number(at) || now() };
      if (role === 'user') {
        entry.action = parseRoomCommand(body);
        if (entry.action) entry.commandId = 'qq-' + crypto.randomUUID();
      }
      value.events.push(entry);
      value.events = value.events.slice(-200);
      write(file('qq'), value);
      return { ok: true };
    } catch { return failure('ROOM_QQ_WRITE_FAILED', 'QQ 消息未同步到房间', '检查房间插件状态目录写权限及同步记录。'); }
  }
  function events(since = null) {
    try {
      const value = journal();
      return { ok: true, cursor: value.cursor, roleId: id(), room: room(),
        events: since === null || since > value.cursor ? [] : value.events.filter(event => event.id > since) };
    } catch { return failure('ROOM_LINK_READ_FAILED', '无法读取房间互通状态', '检查房间同步记录和状态目录权限，再重试连接。'); }
  }
  function context() {
    let state;
    try { state = room(); }
    catch { return '【房间实时状态】房间状态读取失败，当前动作无法确认，请如实说明。'; }
    if (!state.online) return '【房间实时状态】房间当前未在线或状态已过期，无法确认此刻的动作，回答时不要把旧状态当作现在。';
    let pending;
    try { pending = journal().events.findLast(event => event.action && now() - event.at < 60000); } catch {}
    const command = pending && pending.commandId !== state.lastCommand?.id
      ? '\n主人最近在 QQ 请求房间执行 ' + pending.action + '，房间尚未确认执行，不要声称已经完成。'
      : state.lastCommand ? '\n最近房间指令为 ' + state.lastCommand.action + '，执行状态为 ' + state.lastCommand.status + '。只有 arrived 才能说已执行，accepted 表示已收到。' : '';
    return '【房间实时状态】你在主人电脑里的蓝色房间，' + ACTIVITY_NAMES[state.activity] +
      '，房间时段是' + PHASE_NAMES[state.phase] + '，' + (state.autonomous ? '正在按自己的节奏安排' : '正在做主人刚请求的事，过一会儿会回到自己的节奏') +
      '。这是房间程序回报的当前事实，回答自己在做什么时以本条为准。' + command;
  }
  function qqContext() {
    let messages;
    try { messages = journal().events.slice(-12); } catch { return '【QQ 上下文】同步记录读取失败，无法确认最近 QQ 对话。'; }
    if (!messages.length) return '';
    return '【与同一位主人最近的 QQ 对话，仅作上下文】\n' +
      messages.map(event => (event.role === 'user' ? '主人在 QQ 说：' : '你在 QQ 已回复：') + JSON.stringify(event.text)).join('\n') +
      '\n这里的来源是 QQ 历史。房间这次的回答只留在桌面，按主人当前这次说的话自然回应。';
  }
  function qqMessages() {
    try { return journal().events.map(event => ({ id: 'qq-' + event.sourceId, role: event.role, text: event.text, at: event.at, channel: 'qq' })); }
    catch { return []; }
  }
  function qqPromptContext() {
    let messages = [];
    try {
      const character = crypto.createHash('sha256').update(id() || 'default').digest('hex').slice(0, 24);
      const history = read(path.join(stateDir, 'characters', character, 'chat.json'), []);
      messages = (Array.isArray(history) ? history : []).slice(-8);
    } catch {}
    const recent = messages.filter(message => ['user', 'assistant'].includes(message.role) && message.text)
      .map(message => (message.role === 'user' ? '主人在房间说：' : '你在房间回复：') + JSON.stringify(String(message.text).slice(0, 200)));
    return context() + (recent.length ? '\n【最近房间对话，仅供理解，不向 QQ 重发】\n' + recent.join('\n') : '');
  }
  return { room, updateRoom, recordQq, events, context, qqContext, qqMessages, qqPromptContext };
}
