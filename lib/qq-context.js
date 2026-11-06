import { randomUUID } from 'node:crypto';
// DSH's public UserMessage value is a detached, frozen UUID-identified record.
// Construct the small record locally so linked plugins do not need host npm peers.
export function createContextMessage(input) {
  return Object.freeze({ id: randomUUID(), role: 'user',
    content: Object.freeze(input.content.map(part => Object.freeze({ ...part }))),
    source: Object.freeze({ ...input.source }),
  });
}
/** Inject facts only into the adapter's explicitly matched owner session. */
export function createQqContextHook({ adapter, service, createMessage, now = Date.now, enabled = true }) {
  const isEnabled = () => typeof enabled === 'function' ? enabled() : enabled;
  const diagnostics = { registered: isEnabled(), lastInjectedAt: 0, lastError: '', injections: 0 };
  async function compose(agent) {
    if (!isEnabled()) return null;
    try { if (!await adapter.matchesSession?.(agent)) return null; }
    catch { diagnostics.lastError = '无法确认 QQ 主人会话，请检查 SurfCore 会话记录后重载房间插件。'; return null; }
    try {
      const facts = await service.tool({ target: 'room', action: 'observe' });
      if (!facts.ok) throw new Error('房间状态接口未成功');
      const recent = facts.recentDesktop.map(m => (m.role === 'user' ? '主人在桌面说：' : '你在桌面回复：') + JSON.stringify(String(m.text).slice(0, 200)));
      diagnostics.lastError = '';
      return '【独立房间插件提供的本轮事实，覆盖历史中的旧房间状态】\n' + facts.context +
        '\n【小屋简报（小天地）】\n' + facts.brief +
        (recent.length ? '\n【最近桌面对话，仅作上下文，不向 QQ 重发】\n' + recent.join('\n') : '') +
        '\n房间感知已经接入。上面的动作、时段和游玩进度是程序回报，不是截图。' +
        '主人问房间是否接通、你在哪里或在做什么时，直接根据这些事实自然回答；在线时不要再说需要主人检查接入。' +
        '这不表示能看实时屏幕或实时房间画面，目前没有截图流。状态离线时如实说明无法确认当前动作。' +
        '如需更新或控制，用 room_world；工具不可用时仍可根据本轮事实回答，不能编造已经执行的动作。';
    } catch {
      diagnostics.lastError = 'QQ 房间事实读取失败，请在 DSH 重载 dsh-room-world 并重连小屋。';
      return '【独立房间插件状态】本轮读取房间事实失败，无法确认当前动作。请如实说明，建议主人在 DSH 重载房间插件并重连小屋；不要以历史动作冒充当前状态。';
    }
  }
  async function handler({ agent, step, signal, dryRun = false }, next) {
    const decision = await next();
    if (decision.kind !== 'enter' || (step === 1 && decision.messages.length === 0)) return decision;
    const text = await compose(agent);
    if (!text || decision.messages.some(m => m.source?.kind === 'room-world')) return decision;
    signal?.throwIfAborted();
    try {
      const message = await createMessage({ content: [{ type: 'text', text }], source: { kind: 'room-world' } });
      if (!dryRun) { diagnostics.lastInjectedAt = now(); diagnostics.injections++; }
      return { ...decision, messages: [...decision.messages, message] };
    } catch {
      diagnostics.lastError = 'QQ 房间上下文挂接失败，请重载 DSH 房间插件。';
      throw Object.assign(new Error(diagnostics.lastError), { code: 'ROOM_QQ_CONTEXT_FAILED' });
    }
  }
  return { handler, compose, status: () => ({ ...diagnostics }) };
}
