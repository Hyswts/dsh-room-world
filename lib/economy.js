import { createHash } from 'node:crypto';
import { ALL_SPECIES, PLANTS, FISH, GRADES, TIER_AT, LIMITS, label } from './species.js';
export const PLOT_PRICES = [300, 600, 1200, 2400];
export const SUPPLIES = { bait: 5, 'bait-pro': 30, 'bait-glow': 80, compost: 20 };
export function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const frac = text => parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) / 0xffffffff;
/** Daily market factor 0.8..1.3, stable for the whole local day. */
export const marketFactor = (id, time) => Math.round((0.8 + 0.5 * frac(dayKey(time) + ':' + id)) * 100) / 100;
export function tierOf(codex) {
  const found = Object.keys(codex || {}).length;
  return TIER_AT.reduce((tier, need, i) => found >= need ? i : tier, 0);
}
export function sellPrice(item, time) {
  const grade = GRADES.find(g => g.id === item.grade) || GRADES[1];
  return Math.max(1, Math.round(ALL_SPECIES[item.species].price * grade.mult * marketFactor(item.species, time)));
}
export function shopCatalog(s) {
  const tier = tierOf(s.codex);
  const seeds = Object.entries(PLANTS).filter(([, p]) => p.tier <= tier)
    .map(([id, p]) => ({ item: 'seed:' + id, name: p.name + '种子', price: p.seedPrice, area: p.area }));
  const supplies = Object.entries(SUPPLIES).map(([id, price]) => ({ item: id, name: label(id), price }));
  const extra = [];
  for (const area of ['farm', 'garden']) {
    const n = s[area].length - LIMITS.plotsStart;
    if (s[area].length < LIMITS.plotsMax) extra.push({ item: 'plot:' + area, name: (area === 'farm' ? '农田' : '花圃') + '扩建一块', price: PLOT_PRICES[n] });
  }
  extra.push({ item: 'aquarium', name: '鱼缸扩容 +3 格', price: 400 * 2 ** Math.round((s.aquariumSize - LIMITS.aquarium) / 3) });
  return { tier, nextTierAt: TIER_AT[tier + 1] ?? null, items: [...seeds, ...supplies, ...extra] };
}
/** Two deterministic daily commissions from unlocked species. */
export function dailyOrders(time, tier) {
  const pool = Object.entries({ ...PLANTS, ...FISH }).filter(([, v]) => (v.tier ?? (v.rarity === 'common' ? 0 : v.rarity === 'uncommon' ? 1 : 9)) <= tier).map(([id]) => id);
  const day = dayKey(time);
  return [0, 1].map(i => {
    const species = pool[Math.floor(frac(day + ':order:' + i) * pool.length)];
    const big = i === 1;
    const count = big ? 1 : 2 + Math.floor(frac(day + ':count') * 3);
    const minGrade = big ? 'l' : null;
    const base = ALL_SPECIES[species].price * count * (big ? 1.5 : 1);
    return { id: day + '-' + i, species, count, minGrade, reward: Math.round(base * 1.6), done: false };
  });
}
