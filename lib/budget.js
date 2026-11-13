import { createHash } from 'node:crypto';

/**
 * Cost cage for the two model entry points (plan/chat).
 *
 * Design: research/room-world-phase0/cost-cage-implementation.md (方案 A) and
 * call-ref-verification.md. The synthetic session id puts every background model
 * call into one cost-meter ledger row; the gate reads that row and stops the
 * model calls before the daily budget is spent.
 *
 * Fail-closed: if the meter is missing, throws, or returns a row without a CNY
 * amount, spent() reports ok:false and the gates refuse (plan is hard-blocked,
 * chat keeps the owner-grace window then refuses).
 */
export const BUDGET_DEFAULTS = Object.freeze({
  enabled: true,
  dailyBudgetCny: 0.6, // 0 = unlimited amount (counts still apply)
  planMaxPerDay: 12,
  chatMaxPerDay: 60,
  chatGraceMessages: 3,
  cacheMs: 60000,
});

/** Same character hash as service.js scope(), so ledger rows line up with characters/<scope>/. */
export const roomSessionId = characterId =>
  'room-world-' + createHash('sha256').update(String(characterId ?? '')).digest('hex').slice(0, 24);

const localDay = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const finite = v => (typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(Number(v)));
const clampNum = (v, d, lo, hi) => finite(v) ? Math.min(hi, Math.max(lo, Number(v))) : d;
const clampInt = (v, d, lo, hi) => finite(v) ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : d;
const text = (v, n) => String(v || '').slice(0, n);

/**
 * @param {object} options
 * @param {object} [options.ctx] host plugin context (used via ctx.get('costMeter'))
 * @param {() => object} [options.getMeter] alternative meter getter (tests / other hosts)
 * @param {string|(() => string)} options.sessionId synthetic ledger session id
 * @param {object|(() => object)} [options.config] live budget config (may change in place)
 * @param {() => number} [options.now] clock, injectable for tests
 */
export function createBudgetGate({ ctx, getMeter, sessionId, config, now = Date.now } = {}) {
  let cached = null; // { sessionId, at, ok, spentCny, error }
  let counterDay = '';
  let chatsToday = 0;
  let planUsedToday = 0;
  let graceUsed = 0;

  const id = () => (typeof sessionId === 'function' ? sessionId() : sessionId);
  function cfg() {
    const raw = typeof config === 'function' ? config() : config;
    const c = { ...BUDGET_DEFAULTS, ...(raw || {}) };
    return {
      enabled: c.enabled !== false,
      dailyBudgetCny: clampNum(c.dailyBudgetCny, BUDGET_DEFAULTS.dailyBudgetCny, 0, 100000),
      planMaxPerDay: clampInt(c.planMaxPerDay, BUDGET_DEFAULTS.planMaxPerDay, 0, 100000),
      chatMaxPerDay: clampInt(c.chatMaxPerDay, BUDGET_DEFAULTS.chatMaxPerDay, 0, 100000),
      chatGraceMessages: clampInt(c.chatGraceMessages, BUDGET_DEFAULTS.chatGraceMessages, 0, 1000),
      cacheMs: clampNum(c.cacheMs, BUDGET_DEFAULTS.cacheMs, 0, 3600000),
    };
  }
  function rollDay(t) {
    const key = localDay(t);
    if (key !== counterDay) { counterDay = key; chatsToday = 0; planUsedToday = 0; graceUsed = 0; }
  }
  const meter = () => (typeof getMeter === 'function' ? getMeter() : ctx?.get?.('costMeter'));
  function rowCost(row) {
    if (!row || typeof row !== 'object') return null;
    if (finite(row.costCny)) return Number(row.costCny);
    if (finite(row.apiCostCny)) return Number(row.apiCostCny);
    return null;
  }
  /** Read today's spend for the synthetic session. Cached for cacheMs; any failure is fail-closed. */
  async function spent() {
    const c = cfg(), t = now(), session = id();
    if (cached && cached.sessionId === session && t - cached.at < c.cacheMs) return { ...cached, cached: true };
    let error = '', row = null;
    try {
      if (!session) error = '缺少会话 id';
      else {
        const service = meter();
        if (!service || typeof service.getSessionListCosts !== 'function') error = 'cost-meter 未安装或 costMeter 服务缺失';
        else {
          const rows = await service.getSessionListCosts({ sessionIds: [session], period: 'today' });
          row = Array.isArray(rows) ? rows[0] : Array.isArray(rows?.rows) ? rows.rows[0] : rows;
        }
      }
    } catch (e) { error = text(e?.message || e, 200); row = null; }
    const cost = error ? null : rowCost(row);
    if (cost === null) error = error || '账本没有可用的金额字段（costCny/apiCostCny 都缺失）';
    const unlimited = c.dailyBudgetCny <= 0;
    const result = cost === null
      ? { sessionId: session, at: t, ok: false, spentCny: null, budgetCny: c.dailyBudgetCny, remainingCny: null, reason: 'unavailable', error }
      : { sessionId: session, at: t, ok: true, spentCny: cost, budgetCny: c.dailyBudgetCny,
        remainingCny: unlimited ? null : Math.max(0, Math.round((c.dailyBudgetCny - cost) * 1e6) / 1e6),
        reason: unlimited ? 'unlimited' : 'ok', error: '' };
    cached = result;
    return { ...result, cached: false };
  }
  function blockUnavailable(s, kind) {
    // Spread first: s.ok/s.reason would otherwise overwrite the fail-closed verdict.
    return { ...s, ok: false, code: 'BUDGET_UNKNOWN', reason: '读不到今天的开销，先不调模型（fail-closed）' + (s.error ? '：' + s.error : '') };
  }
  async function allow(kind, meta = {}) {
    const c = cfg(), t = now();
    rollDay(t);
    if (meta.usedToday != null) planUsedToday = Math.max(planUsedToday, Math.floor(Number(meta.usedToday) || 0));
    const owner = meta.by === 'owner';
    if (!c.enabled) return { ok: true, reason: 'disabled', code: 'BUDGET_DISABLED', spentCny: null, budgetCny: c.dailyBudgetCny, remainingCny: null };
    if (kind === 'plan') {
      // The budget plan cap is a hard ceiling on top of planner.maxPerDay; the owner bypasses this one only.
      if (!owner && c.planMaxPerDay > 0 && planUsedToday >= c.planMaxPerDay)
        return { ok: false, code: 'PLAN_QUOTA', reason: `今天的规划次数用完了（${c.planMaxPerDay} 次）`, spentCny: null, budgetCny: c.dailyBudgetCny, remainingCny: null, usedToday: planUsedToday };
      const s = await spent();
      if (!s.ok) return blockUnavailable(s, kind);
      if (c.dailyBudgetCny > 0 && s.spentCny >= c.dailyBudgetCny)
        return { ...s, ok: false, code: 'BUDGET_EXCEEDED', reason: '今天的预算用完了' };
      return { ...s, ok: true, code: 'BUDGET_OK', reason: s.reason };
    }
    if (kind === 'chat') {
      const s = await spent();
      if (c.chatMaxPerDay > 0 && chatsToday >= c.chatMaxPerDay)
        return { ...s, ok: false, code: 'CHAT_QUOTA', reason: `今天聊得够多了（${c.chatMaxPerDay} 次），我先把小屋的事放一放`, chatsToday };
      const exhausted = !s.ok || (c.dailyBudgetCny > 0 && s.spentCny >= c.dailyBudgetCny);
      if (!exhausted) {
        graceUsed = 0;
        chatsToday++;
        return { ...s, ok: true, code: 'BUDGET_OK', reason: s.reason, graceRemaining: Math.max(0, c.chatGraceMessages), chatsToday };
      }
      // Owner exception: after the budget is gone, the last N owner messages may still be answered.
      if (graceUsed < c.chatGraceMessages) {
        graceUsed++;
        chatsToday++;
        return { ...s, ok: true, code: s.ok ? 'BUDGET_EXCEEDED' : 'BUDGET_UNKNOWN', reason: 'owner-grace',
          graceRemaining: c.chatGraceMessages - graceUsed, chatsToday };
      }
      return { ...s, ok: false, code: s.ok ? 'BUDGET_EXCEEDED' : 'BUDGET_UNKNOWN',
        reason: '今天的预算用完了，我先把小屋的事放一放，你想聊就聊', graceRemaining: 0, chatsToday };
    }
    throw new Error('未知的预算门类：' + kind);
  }
  /** Synchronous diagnostics snapshot (no I/O). */
  function state() {
    const c = cfg(), session = id();
    return {
      sessionId: session,
      budgetCny: c.dailyBudgetCny,
      spentCny: cached?.spentCny ?? null,
      remainingCny: cached?.spentCny == null ? null : c.dailyBudgetCny <= 0 ? null : Math.max(0, Math.round((c.dailyBudgetCny - cached.spentCny) * 1e6) / 1e6),
      // ok means "a model call may run now": readable ledger AND money left (counts are checked in allow()).
      ok: cached ? cached.ok && !(c.dailyBudgetCny > 0 && cached.spentCny != null && cached.spentCny >= c.dailyBudgetCny) : null,
      reason: cached?.reason || 'unread',
      error: cached?.error || '',
      readAt: cached?.at || 0,
      planMaxPerDay: c.planMaxPerDay,
      planUsedToday,
      chatMaxPerDay: c.chatMaxPerDay,
      chatsToday,
      chatGraceMessages: c.chatGraceMessages,
      graceRemaining: Math.max(0, c.chatGraceMessages - graceUsed),
    };
  }
  return { allow, spent, state, invalidate() { cached = null; } };
}
