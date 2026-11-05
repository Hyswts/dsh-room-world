import fs from 'node:fs';
import { read, write } from './store.js';
import { worldArgs } from './actions.js';
import { CROPS, FLOWERS, PLANTS, FISH, BAITS, ITEMS, FERTILIZERS, RARITY, GRADES, LIMITS, FISHING,
  ALL_SPECIES, kindOf, gradeOf, gradeIndex, phaseAt, label, formatSize } from './species.js';
import { dayKey, marketFactor, tierOf, sellPrice, shopCatalog, dailyOrders } from './economy.js';
import { recordCatch, codexView } from './codex.js';
import { DEFAULT_POLICY, normalizePlan, nextAutoTask, MARKET_ACTIONS } from './planner.js';

const H = 3600000;
const SPECIES_NAMES = Object.fromEntries(Object.entries(ALL_SPECIES).map(([id, v]) => [id, v.name]));
export const WORLD_ACTIONS = ['observe', 'visit', 'plant', 'water', 'harvest', 'fertilize', 'cast', 'collect', 'auto',
  'shop', 'buy', 'sell', 'cook', 'brew', 'craft', 'keep', 'release', 'decorate', 'deliver', 'plan', 'codex', 'wish', 'outing', 'recall'];
/** The owner may only look and guide; everything else in the world is her own doing. */
export const OWNER_ACTIONS = ['observe', 'shop', 'codex', 'wish', 'outing', 'recall'];
/** While she is out, only these make sense; visit (or recall) brings her back first. */
const AWAY_OK = ['shop', 'codex', 'plan', 'wish', 'outing', 'recall', 'visit', 'auto', ...MARKET_ACTIONS];
/** Where she can go out. Only the market allows trading; the field stall sells without a trip at a lower price. */
export const PLACES = { market: '镇上集市', town: '小镇', seaside: '海边', 'flower-sea': '花海', 'night-market': '夜市' };
const STALL_RATE = 0.8;
const OUTING_MS = 2 * 3600000, OUTING_MAX_MS = 12 * 3600000, MARKET_MS = 30 * 60000;
const REST_HOME_MS = 30 * 60000, REST_MS = 60 * 60000, WISH_TTL = 3 * 24 * 3600000;
const AREAS = ['room', 'farm', 'garden', 'pond'];
const BY = ['self', 'owner', 'tool'];
export const TICK_MS = 15000;
export const LINEAGE_CAP = 0.15;
const LINGER_MS = 5 * 60000;

function fail(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
const notReady = message => fail('NOT_READY', message, { wait: true });
const stageMs = (p, stage = p.stage) => PLANTS[p.species].growMs / 3 * (p.fertilizer && stage === 2 ? FERTILIZERS[p.fertilizer].speed : 1);
const ripeWindow = species => Math.max(2 * H, PLANTS[species].growMs / 2);
const newPlot = (species, lineage, t) => ({ species, lineage, plantedAt: t, stage: 0, thirstySince: t, stageEndsAt: null, readyAt: null, care: 1, fertilizer: null });

function initial(t = Date.now()) {
  return { version: 2, shells: 60, seq: 0, seeds: { rice: [0, 0, 0, 0], daisy: [0, 0] }, items: { bait: 3 },
    warehouse: [], aquarium: [], aquariumSize: LIMITS.aquarium, vase: null,
    farm: Array(LIMITS.plotsStart).fill(null), garden: Array(LIMITS.plotsStart).fill(null), fishing: null,
    location: 'room', activity: 'idle', autonomous: true, restUntil: 0, wishes: [], outing: null, nextAt: 0, codex: {}, milestones: [], orders: { day: '', list: [] },
    cravings: {}, plan: null, policy: { ...DEFAULT_POLICY }, planner: { day: '', used: 0, lastAt: 0, lastError: '', wantReason: '' },
    rescueDay: '', log: [], requests: [], createdAt: t };
}
/** v1 -> v2: old counts become medium-sized items, old plots keep their crop. */
export function migrate(s, t) {
  if (s?.version === 2) return s;
  const next = initial(t);
  for (const key of ['location', 'activity', 'log', 'requests']) if (s?.[key] !== undefined) next[key] = s[key];
  next.log = Array.isArray(next.log) ? next.log : []; next.requests = Array.isArray(next.requests) ? next.requests : [];
  const convert = (old, species) => {
    if (!old) return null;
    if (old.watered && old.readyAt && t >= old.readyAt) return { ...newPlot(species, 0, old.plantedAt || t), stage: 2, thirstySince: null, readyAt: t };
    return newPlot(species, 0, t);
  };
  next.farm = Array.from({ length: LIMITS.plotsStart }, (_, i) => convert(s?.farm?.[i], 'rice'));
  next.garden = Array.from({ length: LIMITS.plotsStart }, (_, i) => convert(s?.garden?.[i], 'daisy'));
  const inv = s?.inventory || {};
  for (const [old, species] of [['rice', 'rice'], ['flower', 'daisy'], ['fish', 'crucian']]) {
    for (let i = 0; i < Math.min(Number(inv[old]) || 0, LIMITS.warehouse); i++) {
      if (next.warehouse.length >= LIMITS.warehouse) break;
      const item = { id: 'i' + ++next.seq, species, size: ALL_SPECIES[species].size, grade: 'm', at: t };
      next.warehouse.push(item); recordCatch(next, item, { by: 'self' });
    }
  }
  next.milestones = [];
  return next;
}
function advance(p, t) {
  if (!p || p.readyAt) return p;
  while (p.stageEndsAt != null && t >= p.stageEndsAt) {
    if (p.stage >= 2) { p.readyAt = p.stageEndsAt; p.stageEndsAt = null; break; }
    p.stage++; p.thirstySince = p.stageEndsAt; p.stageEndsAt = null;
  }
  return p;
}
export function plotView(raw, t) {
  if (!raw) return null;
  const p = advance(structuredClone(raw), t);
  const partial = p.readyAt ? 1 : p.stageEndsAt ? 1 - Math.max(0, p.stageEndsAt - t) / stageMs(p) : 0;
  const overripe = !!p.readyAt && t > p.readyAt + ripeWindow(p.species);
  return { ...p, name: PLANTS[p.species].name, ready: !!p.readyAt, thirsty: !p.readyAt && p.stageEndsAt == null, overripe,
    progress: p.readyAt ? 1 : Math.min(1, (p.stage + partial) / 3), ripeUntil: p.readyAt ? p.readyAt + ripeWindow(p.species) : null,
    // Kept for older clients/prompts.
    watered: !(!p.readyAt && p.stageEndsAt == null) };
}

export function createWorld({ file, now = Date.now, random = Math.random }) {
  const load = () => {
    const t = now(), raw = read(file, initial(t));
    // Keep the original v1 save once before the first upgrade is written.
    if (raw.version !== 2 && !fs.existsSync(file + '.v1-backup.json')) write(file + '.v1-backup.json', raw);
    const s = migrate(raw, t); s.wishes ||= []; s.restUntil ||= 0; s.outing ||= null; daily(s, t); return s;
  };
  const bell = () => (random() + random()) / 2;
  function daily(s, t) {
    const day = dayKey(t);
    if (s.orders.day !== day) s.orders = { day, list: dailyOrders(t, tierOf(s.codex)) };
    const seeds = Object.values(s.seeds).reduce((n, list) => n + list.length, 0);
    const cheapest = Math.min(...Object.values(PLANTS).map(p => p.seedPrice));
    const planted = [...s.farm, ...s.garden].some(Boolean);
    if (s.rescueDay !== day && seeds === 0 && !planted && !s.warehouse.length && s.shells < cheapest) {
      s.seeds.rice = [0, 0]; s.rescueDay = day; note(s, t, 'rescue', '米缸里翻出两颗稻种。');
    }
  }
  function note(s, t, action, text, by = 'self', extra = {}) {
    s.log.push({ at: t, action, area: s.location, text, by, ...extra }); s.log = s.log.slice(-60);
  }
  function snapshot() {
    const s = load(), t = now();
    const fishing = s.fishing ? { ...s.fishing, bait: s.fishing.bait, state: t < s.fishing.biteAt ? 'waiting' : t <= s.fishing.escapeAt ? 'bite' : 'escaped',
      ready: t >= s.fishing.biteAt && t <= s.fishing.escapeAt } : null;
    const market = Object.keys(ALL_SPECIES).map(id => ({ species: id, name: label(id), factor: marketFactor(id, t) }))
      .filter(m => s.codex[m.species]).sort((a, b) => b.factor - a.factor);
    const warehouse = s.warehouse.map(item => ({ ...item, name: label(item.species), kind: kindOf(item.species), sizeText: formatSize(item.species, item.size),
      gradeName: GRADES.find(g => g.id === item.grade)?.name, price: sellPrice(item, t) }));
    return { version: 2, serverTime: t, phase: phaseAt(t), names: SPECIES_NAMES, shells: s.shells, items: s.items,
      seeds: Object.fromEntries(Object.entries(s.seeds).filter(([, v]) => v.length).map(([id, v]) => [id, { count: v.length, bestLineage: Math.max(...v) }])),
      warehouse, warehouseLimit: LIMITS.warehouse,
      aquarium: s.aquarium.map(item => ({ ...item, name: label(item.species), sizeText: formatSize(item.species, item.size) })), aquariumSize: s.aquariumSize,
      vase: s.vase && t < s.vase.until ? { ...s.vase, name: label(s.vase.species) } : null,
      farm: s.farm.map(p => plotView(p, t)), garden: s.garden.map(p => plotView(p, t)), fishing,
      location: s.location, activity: s.activity, autonomous: t >= s.restUntil && !s.outing, restUntil: s.restUntil > t ? s.restUntil : 0, outing: s.outing, nextAt: s.nextAt,
      wishes: s.wishes.filter(x => t - x.at < WISH_TTL),
      market, orders: s.orders.list, cravings: s.cravings, plan: s.plan, policy: s.policy, planner: s.planner,
      tier: tierOf(s.codex), codex: { found: Object.keys(s.codex).length, total: Object.keys(ALL_SPECIES).length },
      milestones: s.milestones.slice(-8), log: s.log.slice(-20),
      inventory: { rice: s.items['rice-bowl'] || 0, flower: warehouse.filter(i => i.kind === 'flower').length, fish: warehouse.filter(i => i.kind === 'fish').length } };
  }
  const addItem = (s, id, n) => { s.items[id] = Math.min(LIMITS.stack, (s.items[id] || 0) + n); };
  function takeItem(s, id, n = 1) {
    if ((s.items[id] || 0) < n) throw fail('ITEM_MISSING', '缺少' + label(id) + '（需要 ' + n + '）', { hint: '先在商店购买或加工。' });
    s.items[id] -= n; if (!s.items[id]) delete s.items[id];
  }
  function findItem(s, args, filter = () => true, from = 'warehouse') {
    const list = s[from];
    const item = args.itemId ? list.find(i => i.id === args.itemId) :
      list.filter(i => (!args.species || i.species === args.species) && filter(i)).sort((a, b) => a.size / ALL_SPECIES[a.species].size - b.size / ALL_SPECIES[b.species].size)[0];
    if (!item || !filter(item)) throw fail('ITEM_MISSING', args.species ? '仓库里没有合适的' + label(args.species) : '没有找到这件物品', { hint: '先 observe 查看仓库里的 itemId。' });
    return item;
  }
  const removeFrom = (s, from, item) => { s[from] = s[from].filter(i => i !== item); };
  function plotOf(s, args, area) {
    const slot = args.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot >= s[area].length) throw fail('SLOT_INVALID', '地块编号应为 0 至 ' + (s[area].length - 1));
    return slot;
  }
  function rollPlant(p, t) {
    const sp = PLANTS[p.species];
    const ratio = (0.7 + 0.6 * bell()) * p.care * (p.fertilizer ? FERTILIZERS[p.fertilizer].size : 1) * (1 + p.lineage) * (t > p.readyAt + ripeWindow(p.species) ? 0.85 : 1);
    return { size: Math.round(sp.size * ratio * 1000) / 1000, grade: gradeOf(ratio).id };
  }
  function rollFish(f) {
    const phase = phaseAt(f.biteAt), bait = BAITS[f.bait] || BAITS.none;
    const pool = Object.entries(FISH).filter(([, v]) => v.phases.includes(phase) && (!v.bait || v.bait === f.bait))
      .map(([id, v]) => [id, RARITY[v.rarity].weight * bait.mult[v.rarity]]).filter(([, w]) => w > 0);
    let roll = random() * pool.reduce((n, [, w]) => n + w, 0);
    const species = (pool.find(([, w]) => (roll -= w) < 0) || pool[0])[0];
    const ratio = (0.6 + 0.9 * bell()) * bait.size;
    return { species, size: Math.round(FISH[species].size * ratio * 10) / 10, grade: gradeOf(ratio).id, phase };
  }
  function addProduce(s, t, data, by, context) {
    const item = { id: 'i' + ++s.seq, species: data.species, size: data.size, grade: data.grade, at: t, by };
    const milestones = recordCatch(s, item, { ...context, by });
    return { item, milestones };
  }

  function apply(s, args, t, by, internal) {
    const action = args.action;
    if (s.outing && !AWAY_OK.includes(action)) throw fail('OUTING_AWAY', '她出门了，还没回来', { hint: '先叫她回来：{action:"recall"}（她自己的话用 visit 回小屋）。' });
    const area = args.area || (['cast', 'collect'].includes(action) ? 'pond' : s.location === 'away' ? 'room' : s.location);
    if (!AREAS.includes(area)) throw fail('WORLD_AREA_INVALID', '区域无效：' + area);
    let result = {}, where = s.location;
    switch (action) {
      case 'visit':
        if (s.outing) { endOuting(s, t); if (area === 'room') return { text: '出门回来了' }; }
        s.location = area; s.activity = area === 'room' ? 'idle' : 'explore';
        // Asked home: stay home for a while instead of being pulled straight back outside.
        if (area === 'room' && !internal) { s.restUntil = t + REST_HOME_MS; return { text: '回小屋歇一会儿' }; }
        return { text: area === 'room' ? '回到小屋' : '去' + ({ farm: '农场', garden: '花园', pond: '池塘' })[area] };
      case 'auto':
        // Her own choice to rest; the world keeps growing and she resumes by herself.
        s.restUntil = args.enabled === false ? t + REST_MS : 0; s.nextAt = t;
        return { text: args.enabled === false ? '决定歇一个小时' : '歇好了，继续忙小天地' };
      case 'outing': {
        const hours = Number(args.hours);
        const span = Number.isFinite(hours) && hours > 0 ? Math.min(OUTING_MAX_MS, Math.max(30 * 60000, hours * 3600000)) : OUTING_MS;
        const place = PLACES[args.place] ? args.place : Object.keys(PLACES)[Math.floor(random() * Object.keys(PLACES).length)];
        const back = ' ，大约 ' + new Date(t + span).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 回来';
        // Already in town on errands: keep strolling there (or wander on to another place).
        if (s.outing?.purpose === 'market') {
          s.outing = { ...s.outing, until: t + span, purpose: 'stroll', place: PLACES[args.place] ? args.place : 'market' };
          return { text: '买完东西，在' + PLACES[s.outing.place] + '多逛一会儿' + back.trim() };
        }
        if (s.outing) throw fail('ALREADY_OUT', '她已经在外面了', { hint: '叫她回来用 recall。' });
        if (s.fishing) s.fishing = null; // reels in; the bait is spent
        s.outing = { since: t, until: t + span, by, purpose: 'stroll', place };
        s.location = 'away'; s.activity = 'outing';
        return { text: (by === 'owner' ? '你让她去' : '去') + PLACES[place] + (place === 'market' ? '逛逛' : '走走') + back.trim() };
      }
      case 'recall':
        if (!s.outing) throw fail('NOT_OUT', '她没有出门', { hint: '她现在在' + s.location + '。' });
        const fromMarket = s.outing.purpose === 'market';
        endOuting(s, t);
        return { text: by === 'owner' ? '你把她叫回来了' : fromMarket ? '从集市回来了' : '出门回来了' };
      case 'wish': {
        if (by !== 'owner') throw fail('WISH_OWNER_ONLY', '心愿只能由主人留下', { hint: '你可以用 plan 回应主人的心愿。' });
        const text = String(args.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!text) throw fail('WISH_EMPTY', '心愿不能为空');
        s.wishes = [...s.wishes.filter(x => t - x.at < WISH_TTL), { id: 'w' + ++s.seq, text, at: t, seen: false, source: args.source === 'qq' ? 'qq' : 'panel' }].slice(-5);
        s.planner.wantReason = 'wish';
        return { text: '留下心愿：' + text };
      }
      case 'plant': {
        const target = args.area && args.area !== 'room' && args.area !== 'pond' ? args.area : args.species ? PLANTS[args.species]?.area : 'farm';
        if (!['farm', 'garden'].includes(target)) throw fail('WORLD_AREA_INVALID', '播种需要 farm 或 garden');
        const slot = Number.isInteger(args.slot) ? plotOf(s, args, target) : s[target].findIndex(p => !p);
        if (slot < 0) throw fail('NO_EMPTY_PLOT', (target === 'farm' ? '农田' : '花圃') + '没有空地了', { wait: true });
        if (s[target][slot]) throw fail('PLOT_BUSY', '这块地已有植物');
        const owned = Object.keys(s.seeds).filter(id => s.seeds[id].length && PLANTS[id]?.area === target);
        const species = args.species || owned.sort((a, b) => PLANTS[b].seedPrice - PLANTS[a].seedPrice)[0];
        if (!species || PLANTS[species]?.area !== target) throw fail('SEED_MISSING', '没有适合' + (target === 'farm' ? '农田' : '花圃') + '的种子', { hint: '用 buy 买 seed:<物种>。' });
        const list = s.seeds[species] || [];
        if (!list.length) throw fail('SEED_MISSING', '没有' + label(species) + '种子', { hint: '用 buy 购买 seed:' + species + '。' });
        list.sort((a, b) => a - b); const lineage = list.pop();
        s[target][slot] = newPlot(species, lineage, t); s.location = target; s.activity = 'plant';
        return { text: '在' + (slot + 1) + '号地种下' + label(species) + (lineage ? '（留种血统 +' + lineage + '）' : '') };
      }
      case 'water': case 'fertilize': case 'harvest': {
        if (!['farm', 'garden'].includes(area)) throw fail('WORLD_AREA_INVALID', '种植动作需要农场或花园');
        const slot = plotOf(s, args, area);
        const p = advance(s[area][slot], t);
        if (!p) throw fail('PLOT_EMPTY', '需要先播种');
        s.location = area; s.activity = action;
        if (action === 'water') {
          if (p.readyAt) throw fail('PLOT_READY', '已经成熟，可以收获了');
          if (p.stageEndsAt != null) throw notReady('这一段已经浇过水了');
          p.care = Math.max(0.55, p.care - Math.min(0.15, (t - p.thirstySince) / stageMs(p) * 0.15));
          p.stageEndsAt = t + stageMs(p); p.thirstySince = null;
          return { text: '给' + (slot + 1) + '号' + label(p.species) + '浇水' };
        }
        if (action === 'fertilize') {
          const kind = args.item || (s.items.fishmeal ? 'fishmeal' : 'compost');
          if (!FERTILIZERS[kind]) throw fail('ITEM_INVALID', '肥料只能是 fishmeal 或 compost');
          if (p.readyAt) throw fail('PLOT_READY', '已经成熟，不用施肥了');
          if (p.fertilizer) throw fail('ALREADY_FERTILIZED', '这株已经施过肥');
          takeItem(s, kind);
          const remaining = p.stage === 2 && p.stageEndsAt ? p.stageEndsAt - t : 0;
          p.fertilizer = kind; if (remaining) p.stageEndsAt = t + remaining * FERTILIZERS[kind].speed;
          return { text: '给' + label(p.species) + '施了' + label(kind) };
        }
        if (!p.readyAt) throw notReady('植物还未成熟');
        const rolled = rollPlant(p, t);
        const minSeed = gradeIndex(args.keepSeedMinGrade ?? '');
        const keepSeed = args.keepSeed === true || (minSeed >= 0 && gradeIndex(rolled.grade) >= minSeed && (s.seeds[p.species]?.length || 0) < 2);
        if (!keepSeed && s.warehouse.length >= LIMITS.warehouse) throw fail('WAREHOUSE_FULL', '仓库满了，先卖掉或用掉一些', { hint: '用 sell、cook、brew 或 deliver 腾地方。' });
        const { item, milestones } = addProduce(s, t, { species: p.species, ...rolled }, by, { boost: p.fertilizer });
        s[area][slot] = null;
        const grade = GRADES.find(g => g.id === rolled.grade);
        if (keepSeed) {
          // One seed replaces the fruit: keeping seed is a real trade-off, never free growth.
          const lineage = Math.round(Math.min(LINEAGE_CAP, Math.max(p.lineage, p.lineage + (rolled.grade === 'xl' ? 0.06 : rolled.grade === 'l' ? 0.03 : 0))) * 100) / 100;
          s.seeds[p.species] = [...(s.seeds[p.species] || []), lineage].slice(-LIMITS.stack);
          result = { text: '收获' + grade.name + '的' + label(p.species) + '（' + formatSize(p.species, rolled.size) + '），留作种子', item, milestones, keptSeed: true };
        } else {
          s.warehouse.push(item);
          result = { text: '收获' + grade.name + '的' + label(p.species) + '（' + formatSize(p.species, rolled.size) + '）', item, milestones };
        }
        if (!s.seeds[p.species]?.length) delete s.seeds[p.species];
        return result;
      }
      case 'cast': {
        if (s.fishing) throw fail('ALREADY_FISHING', '已有鱼竿在等待收竿', { wait: true });
        const bait = args.item || args.bait || 'none';
        if (!BAITS[bait]) throw fail('ITEM_INVALID', '鱼饵只能是 none、bait、bait-pro 或 bait-glow');
        if (bait !== 'none') takeItem(s, bait);
        const biteAt = t + FISHING.minWaitMs + random() * (FISHING.maxWaitMs - FISHING.minWaitMs);
        s.fishing = { castAt: t, biteAt, escapeAt: biteAt + FISHING.biteWindowMs, bait,
          readyAt: biteAt };
        s.location = 'pond'; s.activity = 'fishing';
        return { text: '下竿（' + BAITS[bait].name + '）' };
      }
      case 'collect': {
        const f = s.fishing;
        if (!f || t < f.biteAt) throw notReady('还没有鱼咬钩');
        s.fishing = null; s.location = 'pond'; s.activity = 'idle';
        if (t > f.escapeAt) return { text: '收竿晚了，鱼跑掉了', escaped: true };
        const fish = rollFish(f);
        const { item, milestones } = addProduce(s, t, fish, by, { phase: fish.phase, boost: f.bait });
        const grade = GRADES.find(g => g.id === fish.grade);
        if (s.warehouse.length >= LIMITS.warehouse) return { text: '钓到' + grade.name + '的' + label(fish.species) + '，仓库满了，放生了', item, milestones, released: true };
        s.warehouse.push(item);
        return { text: '钓到' + grade.name + '的' + label(fish.species) + '（' + formatSize(fish.species, fish.size) + '）', item, milestones };
      }
      case 'shop': return { shop: shopCatalog(s) };
      case 'codex': return { codex: codexView(s) };
      case 'buy': {
        const qty = Math.max(1, Math.min(20, Number.isInteger(args.qty) ? args.qty : 1));
        const entry = shopCatalog(s).items.find(i => i.item === args.item);
        if (!entry) throw fail('SHOP_ITEM_INVALID', '商店里没有 ' + args.item, { hint: '用 shop 查看在售物品；更高级的种子要先扩充图鉴。' });
        const count = entry.item.startsWith('plot:') || entry.item === 'aquarium' ? 1 : qty;
        if (s.shells < entry.price * count) throw fail('SHELLS_LOW', '贝壳不够（需要 ' + entry.price * count + '，现有 ' + s.shells + '）', { hint: '先卖掉一些东西或完成委托。' });
        s.shells -= entry.price * count;
        const [kind, id] = entry.item.split(':');
        if (kind === 'seed') s.seeds[id] = [...(s.seeds[id] || []), ...Array(count).fill(0)].slice(-LIMITS.stack);
        else if (kind === 'plot') s[id].push(null);
        else if (kind === 'aquarium') s.aquariumSize += 3;
        else addItem(s, kind, count);
        return { text: '买了' + entry.name + (count > 1 ? ' ×' + count : '') + '，花了 ' + entry.price * count + ' 贝壳' };
      }
      case 'sell': {
        // Not in town: sell at the field stall (no trip, lower price). In town: full market price.
        const atStall = !s.outing;
        const grades = args.maxGrade ? gradeIndex(args.maxGrade) : 9;
        const filter = i => gradeIndex(i.grade) <= grades;
        const count = Math.max(1, Math.min(LIMITS.warehouse, Number.isInteger(args.qty) ? args.qty : 1));
        let earned = 0, sold = [];
        for (let n = 0; n < count; n++) {
          let item; try { item = findItem(s, args, filter); } catch (e) { if (n) break; throw e; }
          const price = atStall ? Math.max(1, Math.round(sellPrice(item, t) * STALL_RATE)) : sellPrice(item, t); earned += price; s.shells += price; sold.push(item); removeFrom(s, 'warehouse', item);
          if (args.itemId) break;
        }
        if (atStall) { s.location = sold[0] && FLOWERS[sold[0].species] ? 'garden' : 'farm'; s.activity = 'sell'; }
        return { text: (atStall ? '在田园小摊卖掉' : '卖掉') + sold.map(i => label(i.species)).join('、') + '，得到 ' + earned + ' 贝壳', earned };
      }
      case 'cook': {
        const item = findItem(s, { ...args, species: 'rice' });
        removeFrom(s, 'warehouse', item);
        const bowls = 2 + (gradeIndex(item.grade) >= 2 ? 1 : 0);
        addItem(s, 'rice-bowl', bowls); addItem(s, 'bran', 1); delete s.cravings.rice;
        s.location = 'room'; s.activity = 'cook';
        return { text: '用电饭煲煮了 ' + bowls + ' 碗白米饭，还得到 1 份米糠' };
      }
      case 'brew': {
        const item = findItem(s, args, i => FLOWERS[i.species]?.tea);
        removeFrom(s, 'warehouse', item); addItem(s, 'flower-tea', 2); delete s.cravings.tea;
        s.location = 'room'; s.activity = 'brew';
        return { text: '把' + label(item.species) + '泡成 2 杯花茶' };
      }
      case 'craft': {
        if (args.recipe === 'bait') { takeItem(s, 'bran', 2); addItem(s, 'bait', 1); return { text: '用 2 份米糠做了 1 个鱼饵' }; }
        if (args.recipe === 'fishmeal') {
          const item = findItem(s, args, i => kindOf(i.species) === 'fish');
          removeFrom(s, 'warehouse', item); addItem(s, 'fishmeal', 2);
          return { text: '把' + label(item.species) + '做成 2 份鱼肥' };
        }
        throw fail('RECIPE_INVALID', '配方只能是 bait（米糠→鱼饵）或 fishmeal（鱼→鱼肥）');
      }
      case 'keep': {
        const item = findItem(s, args, i => kindOf(i.species) === 'fish');
        if (s.aquarium.length >= s.aquariumSize) throw fail('AQUARIUM_FULL', '鱼缸满了', { hint: '放生一条（release）或在商店扩容鱼缸。' });
        removeFrom(s, 'warehouse', item); s.aquarium.push(item); s.location = 'room'; s.activity = 'feed';
        return { text: '把' + label(item.species) + '（' + formatSize(item.species, item.size) + '）养进鱼缸' };
      }
      case 'release': {
        const item = findItem(s, args, () => true, 'aquarium');
        removeFrom(s, 'aquarium', item);
        return { text: '把鱼缸里的' + label(item.species) + '放回池塘' };
      }
      case 'decorate': {
        const item = findItem(s, args, i => kindOf(i.species) === 'flower');
        removeFrom(s, 'warehouse', item); s.vase = { species: item.species, size: item.size, grade: item.grade, until: t + 48 * H };
        s.location = 'room'; s.activity = 'decorate';
        return { text: '把' + label(item.species) + '插进花瓶' };
      }
      case 'deliver': {
        const order = s.orders.list.find(o => o.id === args.orderId) || (!args.orderId && s.orders.list.find(o => !o.done && canDeliver(s, o)));
        if (!order) throw fail('ORDER_INVALID', '没有这条委托', { hint: 'observe 里的 orders 有委托编号。' });
        if (order.done) throw fail('ORDER_DONE', '这条委托今天已经交过了');
        if (!canDeliver(s, order)) throw notReady('交委托还差东西：' + label(order.species) + ' ×' + order.count + (order.minGrade ? '（' + GRADES.find(g => g.id === order.minGrade).name + '以上）' : ''));
        const min = order.minGrade ? gradeIndex(order.minGrade) : 0;
        const picks = s.warehouse.filter(i => i.species === order.species && gradeIndex(i.grade) >= min).sort((a, b) => a.size - b.size).slice(0, order.count);
        s.warehouse = s.warehouse.filter(i => !picks.includes(i)); s.shells += order.reward; order.done = true;
        return { text: '交了委托：' + label(order.species) + ' ×' + order.count + '，得到 ' + order.reward + ' 贝壳' };
      }
      case 'plan': {
        if (args.clear) { s.plan = null; return { text: '放下了之前的打算' }; }
        if (args.policy && !args.plan) { s.policy = normalizePlan({ steps: [], policy: { ...s.policy, ...args.policy } }).policy; return { text: '更新了留存和售卖的规矩' }; }
        const plan = normalizePlan(args.plan, s.policy);
        if (by === 'self' || by === 'tool') s.wishes.forEach(x => { x.seen = true; });
        s.plan = { ...plan, createdAt: t, cursor: 0, failures: 0, status: 'active', source: by };
        s.policy = plan.policy;
        return { text: '定下打算：' + plan.goal, dropped: plan.dropped };
      }
    }
    return { text: '' };
  }
  function endOuting(s, t) {
    s.outing = null; s.location = 'room'; s.activity = 'idle'; s.nextAt = t + TICK_MS;
  }
  function canDeliver(s, o) {
    const min = o.minGrade ? gradeIndex(o.minGrade) : 0;
    return s.warehouse.filter(i => i.species === o.species && gradeIndex(i.grade) >= min).length >= o.count;
  }

  function act(rawArgs = {}, meta = {}) {
    const args = worldArgs(rawArgs);
    const action = args.action || 'observe';
    if (!WORLD_ACTIONS.includes(action)) throw fail('WORLD_ACTION_INVALID', '未知世界动作：' + action,
      { hint: '可用：' + WORLD_ACTIONS.join('、') + '。回房间：action=visit, area=room。' });
    if (action === 'observe') return { ok: true, world: snapshot() };
    const by = BY.includes(meta.by) ? meta.by : 'tool';
    const s = load(), t = now();
    const requestId = String(args.requestId || '');
    if (requestId && !/^[a-zA-Z0-9-]{1,90}$/.test(requestId)) throw fail('REQUEST_ID_INVALID', '请求编号无效');
    if (requestId && s.requests.includes(requestId)) return { ok: true, duplicate: true, world: snapshot() };
    // Buying and commissions happen in town (selling too when at:'market'); the first one starts a short market trip.
    // Selling without at:'market' while home uses the field stall instead.
    const needsTown = MARKET_ACTIONS.includes(action) && (action !== 'sell' || args.at === 'market' || !!s.outing);
    const trip = needsTown && !s.outing;
    if (trip) {
      if (s.fishing) s.fishing = null;
      s.outing = { since: t, until: t + MARKET_MS, by, purpose: 'market', place: 'market' };
      s.location = 'away'; s.activity = 'market';
    }
    const walked = needsTown && !trip && s.outing.place !== 'market';
    if (walked) s.outing = { ...s.outing, place: 'market' }; // strolling elsewhere: she wanders over to the market
    const result = apply(s, { ...args, action }, t, by, meta.internal === true);
    if (trip) result.text = '去镇上集市，' + result.text;
    else if (walked) result.text = '顺路去集市，' + result.text;
    if (!['shop', 'codex'].includes(action)) {
      note(s, t, action, result.text, by, { slot: args.slot ?? null });
      if (result.milestones?.length) s.planner.wantReason ||= result.milestones[0].type === 'giant' ? 'giant' : result.milestones[0].type === 'new' ? 'new-species' : '';
      if (requestId) s.requests = [...s.requests, requestId].slice(-200);
      write(file, s);
    }
    const { item, milestones, text, shop, codex, earned, escaped, released, dropped } = result;
    return { ok: true, text, item, milestones, shop, codex, earned, escaped, released, dropped, world: snapshot() };
  }

  /** Room animations consume real stock; missing stock becomes a craving for the planner. */
  function roomActivity(activity) {
    const map = { rice: 'rice-bowl', tea: 'flower-tea' };
    const id = map[activity]; if (!id) return null;
    const s = load(), t = now();
    let text;
    if (s.items[id]) { takeItem(s, id); text = activity === 'rice' ? '在房间吃了一碗白米饭' : '在房间喝了一杯花茶'; }
    else { s.cravings[activity] = t; text = activity === 'rice' ? '想吃白米饭，但电饭煲空了' : '想喝花茶，但没有存货'; }
    note(s, t, 'room-' + activity, text); write(file, s);
    return text;
  }

  /** One action per tick: urgent care, then her plan, then diligent defaults, otherwise go home. */
  function tick() {
    const s = load(), t = now();
    if (s.outing && t >= s.outing.until) return act({ action: 'recall' }, { by: 'self', internal: true });
    if (s.outing) {
      if (t < s.nextAt) return null;
      // In town she can still trade: her plan's market step first, then default market chores; a market trip ends when nothing is left.
      // Strolling anywhere else is just a stroll.
      if (s.outing.place && s.outing.place !== 'market') { s.nextAt = t + TICK_MS; write(file, s); return null; }
      const plan = s.plan?.status === 'active' && s.plan.cursor < s.plan.steps.length ? s.plan : null;
      const fromPlan = !!plan && MARKET_ACTIONS.includes(plan.steps[plan.cursor].action);
      const task = fromPlan ? plan.steps[plan.cursor] : nextAutoTask(snapshot(), { marketOnly: true });
      s.nextAt = t + TICK_MS; write(file, s);
      if (!task) return s.outing.purpose === 'market' ? act({ action: 'recall' }, { by: 'self', internal: true }) : null;
      return runTask(task, fromPlan, s, t);
    }
    if (t < s.restUntil || t < s.nextAt) return null;
    const view = snapshot();
    let task = null, fromPlan = false;
    const plan = s.plan?.status === 'active' ? s.plan : null;
    if (plan && t - plan.createdAt > 24 * H) { plan.status = 'expired'; note(s, t, 'plan', '打算过期了：' + plan.goal); }
    const care = nextAutoTask(view, { careOnly: true });
    if (care) task = care;
    else if (plan?.status === 'active' && plan.cursor < plan.steps.length) { task = plan.steps[plan.cursor]; fromPlan = true; }
    else task = nextAutoTask(view, { careOnly: false });
    if (plan?.status === 'active' && plan.cursor >= plan.steps.length) { plan.status = 'done'; plan.endedAt = t; note(s, t, 'plan', '完成了打算：' + plan.goal); s.planner.wantReason ||= 'plan-done'; }
    s.nextAt = t + TICK_MS; write(file, s);
    if (!task) {
      // Linger outside a little so the room does not flicker between away and home every tick.
      const lastWork = s.log.findLast(e => e.by === 'self' && e.action !== 'visit')?.at || 0;
      if (s.location !== 'room' && t - lastWork >= LINGER_MS) return act({ action: 'visit', area: 'room' }, { by: 'self', internal: true });
      return null;
    }
    return runTask(task, fromPlan, s, t);
  }
  function runTask(task, fromPlan, s, t) {
    const args = { ...task, keepSeedMinGrade: task.action === 'harvest' ? s.policy.keepSeedMinGrade : task.keepSeedMinGrade };
    try {
      const result = act(args, { by: 'self', internal: true });
      if (fromPlan) updatePlan(p => { p.steps[p.cursor].status = 'done'; p.cursor++; });
      return result;
    } catch (error) {
      if (fromPlan) updatePlan(p => {
        if (error.wait && t - p.createdAt < 12 * H) { p.steps[p.cursor].waiting = error.message; return; }
        p.steps[p.cursor].status = 'failed'; p.steps[p.cursor].error = error.message; p.cursor++; p.failures++;
        p.lastError = error.message;
        if (p.failures >= 3) { p.status = 'failed'; p.endedAt = t; }
      });
      return { ok: false, error: error.message };
    }
  }
  function updatePlan(fn) {
    const s = load(); if (!s.plan) return;
    fn(s.plan);
    if (s.plan.status === 'failed') { note(s, now(), 'plan', '打算没能完成：' + s.plan.goal + '（' + s.plan.lastError + '）'); s.planner.wantReason ||= 'plan-failed'; }
    write(file, s);
  }
  /** Planner bookkeeping lives in the same file so limits survive restarts. */
  function plannerState(fn) { const s = load(); const out = fn(s.planner, s, now()); write(file, s); return out; }
  return { snapshot, act, tick, roomActivity, plannerState, file };
}
