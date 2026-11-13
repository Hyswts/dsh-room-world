import { PLANTS, FLOWERS, FISH, BAITS, GRADES, ALL_SPECIES, gradeIndex } from './species.js';
import { dayKey, PLOT_PRICES } from './economy.js';

export const DEFAULT_POLICY = Object.freeze({ keepSeedMinGrade: 'l', sellWhenMarketAtLeast: 1.15, keepRareFish: true, reserveShells: 20, bait: null });
export const PLAN_ACTIONS = ['outing', 'visit', 'plant', 'water', 'harvest', 'fertilize', 'cast', 'collect', 'buy', 'sell', 'cook', 'brew', 'craft', 'keep', 'release', 'decorate', 'deliver'];
// maxPerDay 0 means no daily cap; the gaps still keep her from re-planning every few seconds.
export const PLANNER_DEFAULTS = Object.freeze({ maxPerDay: 0, minGapMs: 2 * 3600000, eventGapMs: 20 * 60000, morningHour: 6, maxAttemptsPerDay: 8 });
/** After this many unparseable replies in one day, automatic planning stops until tomorrow. */
export const MAX_PLAN_FAILS = 3;
const H = 3600000;
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
/** The model sometimes answers with display names (稻米/雏菊/鲤鱼) instead of ids; ids win, names are mapped back. */
const SPECIES_BY_NAME = Object.fromEntries(Object.entries(ALL_SPECIES).map(([id, s]) => [s.name, id]));
export function speciesId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return ALL_SPECIES[raw] ? raw : SPECIES_BY_NAME[raw] || '';
}

export function normalizePolicy(raw = {}, base = DEFAULT_POLICY) {
  const p = { ...DEFAULT_POLICY, ...base };
  if (raw.keepSeedMinGrade === null || GRADES.some(g => g.id === raw.keepSeedMinGrade)) p.keepSeedMinGrade = raw.keepSeedMinGrade;
  else if (GRADES.some(g => g.name === raw.keepSeedMinGrade)) p.keepSeedMinGrade = GRADES.find(g => g.name === raw.keepSeedMinGrade).id;
  if (Number.isFinite(raw.sellWhenMarketAtLeast)) p.sellWhenMarketAtLeast = Math.min(1.3, Math.max(0.8, raw.sellWhenMarketAtLeast));
  if (typeof raw.keepRareFish === 'boolean') p.keepRareFish = raw.keepRareFish;
  if (Number.isInteger(raw.reserveShells)) p.reserveShells = Math.min(5000, Math.max(0, raw.reserveShells));
  if (raw.bait === null || BAITS[raw.bait]) p.bait = raw.bait ?? null;
  return p;
}
/** Validate a model or tool supplied plan. Invalid steps are dropped and reported, never executed. */
export function normalizePlan(raw, basePolicy = DEFAULT_POLICY) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('打算必须是对象：{goal, steps, policy}'), { code: 'PLAN_INVALID' });
  const steps = [], dropped = [];
  for (const step of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 20)) {
    if (!step || !PLAN_ACTIONS.includes(step.action)) { dropped.push((step?.action || '?') + '：不支持'); continue; }
    if (steps.length >= 12) { dropped.push(step.action + '：超过 12 步'); continue; }
    const clean = { action: step.action };
    if (['room', 'farm', 'garden', 'pond'].includes(step.area)) clean.area = step.area;
    if (Number.isInteger(step.slot) && step.slot >= 0 && step.slot < 8) clean.slot = step.slot;
    if (step.species) {
      const id = speciesId(step.species);
      if (!id) { dropped.push(step.action + '：未知物种 ' + step.species); continue; }
      clean.species = id;
    }
    for (const key of ['item', 'recipe', 'orderId', 'itemId', 'bait', 'maxGrade', 'at', 'place']) if (typeof step[key] === 'string' && /^[a-zA-Z0-9:_-]{1,40}$/.test(step[key])) clean[key] = step[key];
    if (Number.isInteger(step.qty)) clean.qty = Math.min(20, Math.max(1, step.qty));
    if (Number.isFinite(step.hours)) clean.hours = Math.min(12, Math.max(0.5, step.hours));
    if (typeof step.keepSeed === 'boolean') clean.keepSeed = step.keepSeed;
    steps.push(clean);
  }
  return { goal: str(raw.goal, 60) || '随便照料一下小天地', why: str(raw.why, 160), say: str(raw.say, 120),
    steps, policy: normalizePolicy(raw.policy || {}, basePolicy), dropped };
}

const lastAt = (view, action) => view.log?.findLast?.(e => e.action === action)?.at || 0;
/** Trading only happens in town; doing one of these starts (or continues) a short market trip. */
export const MARKET_ACTIONS = ['buy', 'sell', 'deliver'];
/** Every default chore in priority order; care chores come first. */
function* candidates(view) {
  const t = view.serverTime;
  if (view.fishing && view.fishing.state !== 'waiting') yield { action: 'collect', area: 'pond', care: true };
  for (const area of ['farm', 'garden']) {
    const i = view[area].findIndex(p => p?.ready); if (i >= 0) yield { action: 'harvest', area, slot: i, care: true };
  }
  for (const area of ['farm', 'garden']) {
    const i = view[area].findIndex(p => p?.thirsty); if (i >= 0) yield { action: 'water', area, slot: i, care: true };
  }
  const items = view.items || {}, wh = view.warehouse || [], policy = view.policy || DEFAULT_POLICY;
  const order = (view.orders || []).find(o => !o.done && wh.filter(i => i.species === o.species && gradeIndex(i.grade) >= (o.minGrade ? gradeIndex(o.minGrade) : 0)).length >= o.count);
  if (order) yield { action: 'deliver', orderId: order.id };
  if ((items['rice-bowl'] || 0) < 2 && wh.some(i => i.species === 'rice')) yield { action: 'cook' };
  if ((view.cravings?.tea || !items['flower-tea']) && wh.filter(i => FLOWERS[i.species]?.tea).length >= (view.cravings?.tea ? 1 : 2)) yield { action: 'brew' };
  if (!view.vase && wh.some(i => FLOWERS[i.species])) yield { action: 'decorate' };
  if ((items.bran || 0) >= 2 && (items.bait || 0) < 3) yield { action: 'craft', recipe: 'bait' };
  const fertile = [...view.farm.map((p, slot) => ({ p, slot, area: 'farm' })), ...view.garden.map((p, slot) => ({ p, slot, area: 'garden' }))]
    .filter(x => x.p && !x.p.ready && !x.p.fertilizer).sort((a, b) => PLANTS[b.p.species].price - PLANTS[a.p.species].price);
  if (fertile.length && (items.fishmeal || items.compost)) yield { action: 'fertilize', area: fertile[0].area, slot: fertile[0].slot, item: items.fishmeal ? 'fishmeal' : 'compost' };
  const smallFish = wh.find(i => FISH[i.species]?.rarity === 'common' && i.grade === 's');
  if (fertile.some(x => PLANTS[x.p.species].price >= 40) && !items.fishmeal && smallFish) yield { action: 'craft', recipe: 'fishmeal', itemId: smallFish.id };
  const rare = wh.find(i => ['rare', 'legendary'].includes(FISH[i.species]?.rarity));
  if (policy.keepRareFish && rare && (view.aquarium || []).length < view.aquariumSize) yield { action: 'keep', itemId: rare.id };
  for (const area of ['farm', 'garden']) {
    const empty = view[area].filter(p => !p).length;
    if (!empty) continue;
    if (Object.keys(view.seeds || {}).some(id => PLANTS[id]?.area === area)) { yield { action: 'plant', area }; continue; }
    const budget = view.shells - policy.reserveShells;
    const choice = Object.entries(PLANTS).filter(([, p]) => p.area === area && p.tier <= view.tier && p.seedPrice <= budget)
      .sort((a, b) => b[1].seedPrice - a[1].seedPrice)[0];
    if (choice) yield { action: 'buy', item: 'seed:' + choice[0], qty: Math.max(1, Math.min(empty, Math.floor(budget / choice[1].seedPrice))) };
  }
  const giants = wh.filter(i => i.grade === 'xl').sort((a, b) => b.price - a.price).slice(0, 3);
  const protectedItem = i => (i.species === 'rice' && wh.filter(x => x.species === 'rice').length <= 3) ||
    (policy.keepRareFish && ['rare', 'legendary'].includes(FISH[i.species]?.rarity)) || giants.includes(i);
  const market = Object.fromEntries((view.market || []).map(m => [m.species, m.factor]));
  const sellable = wh.filter(i => !protectedItem(i)).sort((a, b) => a.price - b.price);
  const hot = sellable.find(i => (market[i.species] || 1) >= policy.sellWhenMarketAtLeast);
  if (wh.length >= view.warehouseLimit * 0.6 && sellable.length) yield { action: 'sell', itemId: sellable[0].id };
  if (wh.length >= view.warehouseLimit * 0.3 && hot) yield { action: 'sell', itemId: hot.id };
  const starved = ['farm', 'garden'].some(area => view[area].some(p => !p) && !Object.keys(view.seeds || {}).some(id => PLANTS[id]?.area === area));
  if (starved && sellable.length) yield { action: 'sell', itemId: sellable.at(-1).id };
  for (const area of ['farm', 'garden']) {
    const price = PLOT_PRICES[view[area].length - 4];
    if (price && view.shells - policy.reserveShells >= price * 2) yield { action: 'buy', item: 'plot:' + area };
  }
  if (!view.fishing && t - lastAt(view, 'cast') > 90 * 60000 && wh.length < view.warehouseLimit * 0.75) {
    const night = view.phase === 'night';
    const bait = policy.bait && items[policy.bait] ? policy.bait : night && items['bait-glow'] ? 'bait-glow' : items['bait-pro'] ? 'bait-pro' : items.bait ? 'bait' : 'none';
    yield { action: 'cast', area: 'pond', item: bait };
  }
}
/**
 * Deterministic default behaviour. careOnly: time-sensitive chores only. marketOnly: what she can still do in town.
 * Without a filter the first candidate wins, so a market chore that comes first starts a market trip.
 */
export function nextAutoTask(view, { careOnly = false, marketOnly = false } = {}) {
  for (const { care, ...task } of candidates(view)) {
    if (careOnly) return care ? task : null;
    if (marketOnly) { if (MARKET_ACTIONS.includes(task.action)) return task; continue; }
    return task;
  }
  return null;
}

export function shouldPlan(view, t, cfg = PLANNER_DEFAULTS) {
  if (!view.autonomous) return '';
  const p = view.planner || {};
  const day = dayKey(t);
  const used = p.day === day ? p.used : 0;
  if (cfg.maxPerDay > 0 && used >= cfg.maxPerDay) return '';
  // A failed attempt backs off instead of retrying every two seconds; the attempt budget caps the day.
  if (p.retryAt && t < p.retryAt) return '';
  if (cfg.maxAttemptsPerDay > 0) {
    const attempts = p.attemptDay === day ? p.attempts || 0 : 0;
    if (attempts >= cfg.maxAttemptsPerDay) return '';
  }
  if (p.parseFailDay === day && (p.parseFails || 0) >= MAX_PLAN_FAILS) return '';
  const since = t - (p.lastAt || 0);
  if (p.day !== dayKey(t) && new Date(t).getHours() >= cfg.morningHour) return 'morning';
  if (p.wantReason && since >= cfg.eventGapMs) return p.wantReason;
  if (view.plan?.status !== 'active' && since >= cfg.minGapMs) return 'no-plan';
  return '';
}

export function plannerMessages({ persona, memory, briefText, reason, retry = null }) {
  const system = persona + '\n【记忆（节选）】\n' + (String(memory || '暂无').slice(0, 2500)) +
    '\n\n你正在为自己的小天地（农场、花园、池塘、小屋）定接下来几个小时的打算。这是你自己的生活，按你的性格和喜好决定。' +
    '\n只输出 JSON，不要别的文字：{"goal":"一句话目标","why":"为什么","say":"一句想对主人说的话，可空","steps":[...],"policy":{...}}' +
    '\nsteps 最多 12 步，每步 {action,...}，action 只能是：' + PLAN_ACTIONS.join('、') + '。' +
    '\n- plant {area:farm|garden, species?, slot?}；water/harvest/fertilize {area, slot, item?:fishmeal|compost}；cast {item?:none|bait|bait-pro|bait-glow}；collect' +
    '\n- buy {item:"seed:<物种id>"|bait|bait-pro|bait-glow|compost|"plot:farm"|"plot:garden"|aquarium, qty}；sell {itemId 或 species, qty?, maxGrade?}' +
    '\n- 买东西、扩地、交委托只能在镇上集市：做这些时会自动出门去集市（最多半小时），做完就回来；在集市卖东西是全价。出门期间不能照料小天地，所以尽量一次办完' +
    '\n- 不出门时 sell 默认在田园小摊卖，不用出门但只有八成价格；想按全价卖就 sell {at:"market"} 去集市卖' +
    '\n- outing {hours?:0.5~12, place?:market|town|seaside|flower-sea|night-market}：出门走走（集市可以纯逛，也可以顺便买卖），期间不在房间和小天地，到点自己回来；主人也可能让你出门或叫你回来' +
    '\n- cook（稻米→白米饭+米糠）；brew {species?}（可泡茶的花→花茶）；craft {recipe:bait|fishmeal, itemId?}；keep/release {itemId}（鱼缸）；decorate {itemId?}（花瓶）；deliver {orderId}' +
    '\npolicy：keepSeedMinGrade(s|m|l|xl|null，达到该等级的收获留种)，sellWhenMarketAtLeast(0.8~1.3)，keepRareFish(bool)，reserveShells(留底贝壳)，bait(默认鱼饵或null)。' +
    '\n简报里「主人的心愿」是主人的引导：认真考虑，可以采纳、部分采纳或者先放一放，并在 say 里自然回应。小天地的事都由你自己做，主人不会替你操作。' +
    '\n浇水、收获、收竿这类照料会自动优先完成，不必全写进 steps。步骤做不了会被跳过并记录原因。慢慢来，这是长期的小日子。';
  const constraint = '\n严格只输出一个 JSON 对象：第一个字符必须是 {，最后一个字符必须是 }。不要 Markdown 代码围栏，不要任何解释、前言或后缀。' +
    '\nJSON 字符串里不要出现裸换行，引号要转义；为什么/想说的话（why、say）各不超过 40 字。' +
    '\n不确定的计划就少写几步，宁少不多；必须完整闭合，宁可提前结束也不要写半截 JSON。';
  const messages = [{ role: 'user', content: [{ type: 'text', text: '【小屋简报】\n' + briefText + '\n\n触发原因：' + reason + '。请给出接下来的打算。' }] }];
  if (retry) messages.push({ role: 'user', content: [{ type: 'text',
    text: '上一次的回复没法用：' + String(retry.error || '不是合法 JSON').slice(0, 200) +
      '\n回复末尾是：' + String(retry.raw || '').slice(-300) +
      '\n请重新只输出一个合法、完整的 JSON 对象，不要解释。' }] });
  return { system: system + constraint, messages };
}
export function parsePlannerReply(text) {
  const body = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(new Error('规划回复不是 JSON'), { code: 'PLAN_PARSE' });
  try { return JSON.parse(body.slice(start, end + 1)); }
  catch (error) {
    throw Object.assign(new Error('规划回复不是合法 JSON：' + String(error.message).slice(0, 120)), { code: 'PLAN_PARSE', cause: error });
  }
}
export { H as HOUR_MS };
