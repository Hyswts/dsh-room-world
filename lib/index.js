import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { read, write } from './store.js';
import { resolveAdapter } from './adapters.js';
import { createService } from './service.js';
import { createQqContextHook, createContextMessage } from './qq-context.js';
import { toJson } from './guidance.js';
import { ROOM_ACTIONS } from './room-link.js';
import { WORLD_ACTIONS } from './world.js';
import { HOME_ALIASES } from './actions.js';
import { Config as ConfigSchema, resolveConfig } from './config.js';
export { registerAdapter } from './adapters.js';
export const name = 'dsh-room-world';
export const inject = ['tools', 'webServer'];
/** Settings shown in DSH (see lib/client.js). */
export const Config = ConfigSchema;
let active;
/** Other DSH plugins may read context/control without receiving any credentials. */
export function getRoomWorld() { if (!active) throw new Error('房间插件尚未启用'); return active; }
export function apply(ctx, config = {}) {
  const stateDir = path.join(config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'room-world');
  const tokenFile = path.join(stateDir, 'token.json');
  const token = read(tokenFile, {}).token || randomBytes(32).toString('hex');
  write(tokenFile, { token });
  const prefix = '/dsh-room-world/api';
  const selection = () => ctx.get('agentDefaultModel')?.currentSelection?.();
  const adapter = resolveAdapter(config);
  const settings = resolveConfig(config);
  const service = createService({ stateDir, adapter, async complete({ system, messages }) {
    const model = selection();
    if (!model?.provider || !model?.model || !ctx.get('llm')?.stream) throw new Error('请在 DSH 设置默认模型');
    let text = '';
    for await (const chunk of ctx.get('llm').stream({ provider: model.provider, model: model.model, system, messages,
      maxTokens: 1000, signal: AbortSignal.timeout(180000) })) {
      if (chunk.type === 'text-delta') text += chunk.text || '';
      if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) throw new Error('DSH 模型调用失败');
    }
    return text;
  }, planner: settings.planner, world: settings.world, qqWishes: settings.qqWishes });
  if (active) throw new Error('房间插件不能重复启用');
  active = service;
  const qqContext = createQqContextHook({ adapter, service, createMessage: createContextMessage, enabled: settings.qqContext });
  if (settings.qqContext) ctx.on('agent/pre-step', qqContext.handler);
  let stopped = false, syncing = false;
  function host() {
    const ws = ctx.get('webServer');
    if (ws?.port) write(path.join(stateDir, 'host.json'), { version: 1, api: prefix, token,
      baseUrl: `${ws.protocol || 'http:'}//127.0.0.1:${ws.port}` });
  }
  async function tick() {
    if (syncing || stopped) return;
    syncing = true;
    try { host(); await service.sync(); } catch (e) { console.warn('[room-world]', e.message); } finally { syncing = false; }
  }
  const interval = setInterval(() => void tick(), 2000); interval.unref?.(); void tick();
  const disposeTool = ctx.tools.register({ name: 'room_world',
    description: '你在主人电脑里的小屋与小天地（农场、花园、池塘、商店、图鉴）。先 {target:"world",action:"observe"} 读小屋简报再决定。' +
      '回家：{target:"room",action:"home"}。种地 plant/water/harvest/fertilize，钓鱼 cast/collect，买卖 shop/buy/sell/deliver，加工 cook/brew/craft，鱼缸 keep/release，花瓶 decorate，图鉴 codex。' +
      '小天地完全由你自己经营，主人只会留心愿引导（见简报）。买种子、扩地、交委托在镇上集市，调用时会自动出门去集市，做完自己回来；sell 不出门时在田园小摊卖（八成价），sell {at:"market"} 去集市全价卖。自己的长期打算用 plan：{action:"plan",plan:{goal,why,steps:[...],policy:{...}}}；只改规矩用 {action:"plan",policy:{keepRareFish:true}}。动作结果以工具反馈为准；桌面回复不会发 QQ。',
    parameters: { type: 'object', properties: {
      target: { type: 'string', enum: ['room', 'world'], description: 'room=房间动作；world=小天地。' },
      action: { type: 'string', enum: [...new Set([...ROOM_ACTIONS, ...WORLD_ACTIONS.filter(a => a !== 'wish'), ...HOME_ALIASES, 'move', 'go_to'])],
        description: 'room 用 home回家、rice吃饭、read看书、sleep睡觉等；world 用 visit前往area、plant播种、water浇水、harvest收获、fertilize施肥、cast下竿、collect收竿、' +
          'shop看商店、buy购买、sell卖出、deliver交委托、cook煮饭、brew泡花茶、craft加工、keep养进鱼缸、release放生、decorate插花、codex看图鉴、plan定打算、auto（enabled:false 歇一小时，true 继续）、outing出门走走（hours）、recall回来；observe观察。兼容 move/go_to=visit，go_home/return_home/back_home=回家。' },
      area: { type: 'string', enum: ['room', 'farm', 'garden', 'pond'], description: 'visit 目的地；种植动作的 farm 或 garden。' },
      slot: { type: 'integer', minimum: 0, maximum: 7, description: '地块编号，从 0 开始。plant 可省略，自动找空地。' },
      species: { type: 'string', description: '物种 id，如 rice、tomato、rose、koi。' },
      item: { type: 'string', description: 'buy 的商品（seed:<物种>、bait、bait-pro、bait-glow、compost、plot:farm、plot:garden、aquarium）；cast 的鱼饵；fertilize 的肥料。' },
      qty: { type: 'integer', minimum: 1, maximum: 20 }, itemId: { type: 'string', description: '仓库或鱼缸里的物品编号，如 i12。' },
      recipe: { type: 'string', enum: ['bait', 'fishmeal'] }, orderId: { type: 'string' },
      maxGrade: { type: 'string', enum: ['s', 'm', 'l', 'xl'], description: 'sell 时只卖不超过该等级的。' },
      keepSeed: { type: 'boolean', description: 'harvest 时把这次收获留作种子。' },
      plan: { type: 'object', additionalProperties: true, description: '{goal,why,say,steps:[{action,...}],policy}' },
      policy: { type: 'object', additionalProperties: true, description: 'keepSeedMinGrade、sellWhenMarketAtLeast、keepRareFish、reserveShells、bait' },
      clear: { type: 'boolean', description: 'plan 时放下当前打算。' },
      at: { type: 'string', enum: ['stall', 'market'], description: 'sell 在哪卖：stall 田园小摊（不出门，八成价），market 镇上集市（全价，会出门）。不出门时默认小摊。' },
      place: { type: 'string', enum: ['market', 'town', 'seaside', 'flower-sea', 'night-market'], description: 'outing 去哪：market 集市（可纯逛也可买卖）、town 小镇、seaside 海边、flower-sea 花海、night-market 夜市。' },
      hours: { type: 'number', minimum: 0.5, maximum: 12, description: 'outing 出门多久（小时），默认 2。' },
      enabled: { type: 'boolean' }, requestId: { type: 'string' },
    }, required: ['target', 'action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async args => toJson(await service.tool(args)),
  });
  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const address = req.socket.remoteAddress;
      const actual = Buffer.from(String(req.headers['x-pet-token'] || '')), expected = Buffer.from(token);
      const origin = req.headers.origin;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) ||
        (origin && origin !== 'http://' + req.headers.host) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        json(403, { ok: false, error: '只接受已认证的本机连接' }); return;
      }
      const url = new URL(req.url, 'http://127.0.0.1'); const route = url.pathname.slice(prefix.length);
      let body = {};
      if (req.method === 'POST') {
        if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('需要 JSON');
        let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 32768) throw new Error('请求过长'); }
        body = JSON.parse(value);
      }
      await service.refresh();
      let result;
      if (req.method === 'GET' && route === '/status') result = { ...await service.status(!!selection()?.model && !!ctx.get('llm')?.stream), qqContext: qqContext.status() };
      else if (req.method === 'GET' && route === '/qq-context') {
        // Read-only dry run of the same pre-step path; does not submit a turn or send QQ.
        const id = adapter.ownerSessionId?.();
        const decision = await qqContext.handler({ agent: { session: { id } }, step: 1, dryRun: true },
          async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '房间连接诊断' }] }] }));
        const message = decision.messages.find(m => m.source?.kind === 'room-world');
        result = { ok: true, matched: !!message, context: message?.content?.[0]?.text || '', diagnostics: qqContext.status() };
      }
      else if (req.method === 'GET' && route === '/history') result = service.history();
      else if (req.method === 'POST' && route === '/chat') {
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 || !/^[a-zA-Z0-9-]{1,90}$/.test(body.requestId)) throw new Error('消息或请求编号无效');
        result = await service.chat(body.text, body.requestId);
      }
      else if (req.method === 'POST' && route === '/room/state') result = service.room.updateRoom(body);
      else if (req.method === 'GET' && route === '/room/events') result = service.room.events(url.searchParams.has('since') ? Number(url.searchParams.get('since')) : null);
      else if (req.method === 'GET' && route === '/commands') result = service.commands(url.searchParams.has('since') ? Number(url.searchParams.get('since')) : null);
      else if (req.method === 'GET' && route === '/world') result = service.world();
      else if (req.method === 'POST' && route === '/world' && body.action === 'replan') { await service.planNow('主人在面板上请你重新想想打算'); result = service.world(); }
      else if (req.method === 'POST' && route === '/world') result = await service.tool({ ...body, target: 'world' }, { by: 'owner' });
      else if (req.method === 'GET' && route === '/events') {
        await new Promise(resolve => setTimeout(resolve, 1000)); result = { ok: true, bootId: service.bootId, cursor: 0, events: [] };
      } else { json(404, { ok: false, error: '未知接口' }); return; }
      json(result.ok === false ? 400 : 200, result);
    } catch (e) { json(400, { ok: false, error: String(e.message).slice(0, 250) }); }
  } });
  ctx.on('dispose', () => { stopped = true; clearInterval(interval); disposeTool(); disposeRoute(); if (active === service) active = null; });
}
