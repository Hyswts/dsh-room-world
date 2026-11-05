import { PLANTS, ITEMS, GRADES, PHASES, label } from './species.js';
const areaName = { room: '小屋', farm: '农场', garden: '花园', pond: '池塘' };
const mins = ms => ms <= 0 ? '马上' : ms < 3600000 ? Math.ceil(ms / 60000) + ' 分钟' : (ms / 3600000).toFixed(1) + ' 小时';
const gradeName = id => GRADES.find(g => g.id === id)?.name || id;
function plotText(p, i, t) {
  if (!p) return (i + 1) + '号空';
  const tag = p.ready ? (p.overripe ? '过熟待收' : '可收获') : p.thirsty ? '缺水' : '还差' + mins(p.stageEndsAt - t);
  return (i + 1) + '号' + p.name + '(' + (p.ready ? '熟' : '第' + (p.stage + 1) + '段') + '·' + tag + (p.fertilizer ? '·已施肥' : '') + (p.lineage ? '·血统+' + p.lineage : '') + ')';
}
/** Compact shared facts for desktop chat, QQ injection and planning. Keep it short; it is sent on every QQ step. */
export function buildBrief(view, { mood = '' } = {}) {
  const t = view.serverTime;
  const groups = {};
  for (const item of view.warehouse) {
    const g = groups[item.species] ||= { n: 0, best: item };
    g.n++; if (item.size > g.best.size) g.best = item;
  }
  const wh = Object.entries(groups).map(([id, g]) => label(id) + '×' + g.n + (g.best.grade !== 'm' && g.best.grade !== 's' ? '(最大' + gradeName(g.best.grade) + ')' : '')).join('、') || '空';
  const items = Object.entries(view.items).map(([id, n]) => (ITEMS[id] || id) + n).join('、') || '无';
  const seeds = Object.entries(view.seeds).map(([id, s]) => label(id) + s.count + (s.bestLineage ? '(血统+' + s.bestLineage + ')' : '')).join('、') || '无';
  const pond = !view.fishing ? '空着' : view.fishing.state === 'waiting' ? '在等鱼咬钩' : view.fishing.state === 'bite' ? '有鱼咬钩！要尽快收竿' : '鱼已经跑了';
  const market = view.market.slice(0, 3).map(m => m.name + '×' + m.factor).join('、');
  const orders = view.orders.map(o => (o.done ? '[已交]' : '[' + o.id + ']') + label(o.species) + '×' + o.count + (o.minGrade ? '(' + gradeName(o.minGrade) + '以上)' : '') + '→' + o.reward + '贝壳').join('；');
  const plan = view.plan ? '「' + view.plan.goal + '」' + ({ active: '进行中，第 ' + (view.plan.cursor + 1) + '/' + view.plan.steps.length + ' 步', done: '已完成', failed: '失败：' + (view.plan.lastError || ''), expired: '已过期' })[view.plan.status] : '还没有打算';
  const cravings = Object.keys(view.cravings || {}).map(k => k === 'rice' ? '想吃白米饭' : k === 'tea' ? '想喝花茶' : k).join('、');
  const phase = PHASES.find(p => p.id === view.phase)?.name;
  const lines = [
    `现在${phase}，你在${areaName[view.location]}，${view.autonomous ? '自己安排小天地中' : '正在歇息（' + new Date(view.restUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 后继续）'}。贝壳 ${view.shells}，商店等级 ${view.tier}，图鉴 ${view.codex.found}/${view.codex.total}。`,
    '农场：' + view.farm.map((p, i) => plotText(p, i, t)).join(' '),
    '花园：' + view.garden.map((p, i) => plotText(p, i, t)).join(' '),
    '池塘：' + pond + '。鱼缸 ' + view.aquarium.length + '/' + view.aquariumSize + (view.aquarium.length ? '（' + view.aquarium.map(f => f.name).join('、') + '）' : '') + (view.vase ? '。花瓶里插着' + view.vase.name : ''),
    `仓库 ${view.warehouse.length}/${view.warehouseLimit}：${wh}。种子：${seeds}。物品：${items}。`,
    '今日行情高：' + (market || '暂无') + '。委托：' + (orders || '无'),
    '打算：' + plan + (view.policy ? `。规矩：${view.policy.keepSeedMinGrade ? gradeName(view.policy.keepSeedMinGrade) + '以上留种' : '不留种'}，行情≥${view.policy.sellWhenMarketAtLeast}才卖，留底 ${view.policy.reserveShells} 贝壳${view.policy.keepRareFish ? '，稀有鱼养鱼缸' : ''}` : ''),
  ];
  if (cravings) lines.push('惦记：' + cravings);
  const wishes = (view.wishes || []).map(x => (x.source === 'qq' ? 'QQ 里说' : '') + '「' + x.text + '」' + (x.seen ? '' : '（新）')).join('；');
  if (wishes) lines.push('主人的心愿（只是引导，要不要做、怎么做由你决定）：' + wishes);
  if (mood) lines.push('心境：' + mood);
  const recent = view.milestones.slice(-3).map(m => m.text).join('；');
  if (recent) lines.push('最近的纪录：' + recent);
  const last = view.log.filter(e => e.text).slice(-4).map(e => e.text).join('；');
  if (last) lines.push('刚做过：' + last);
  return lines.join('\n');
}
export { PLANTS };
