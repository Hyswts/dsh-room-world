// Species table: add new crops, flowers or fish here only. Times are real milliseconds.
const H = 3600000, M = 60000;
export const CROPS = {
  rice: { name: '稻米', area: 'farm', tier: 0, seedPrice: 8, growMs: 2 * H, price: 18, size: 1, unit: 'kg', cook: true },
  radish: { name: '萝卜', area: 'farm', tier: 0, seedPrice: 10, growMs: 1.5 * H, price: 20, size: 0.6, unit: 'kg' },
  wheat: { name: '小麦', area: 'farm', tier: 1, seedPrice: 14, growMs: 3 * H, price: 34, size: 1.2, unit: 'kg' },
  tomato: { name: '番茄', area: 'farm', tier: 1, seedPrice: 18, growMs: 3 * H, price: 42, size: 0.25, unit: 'kg' },
  strawberry: { name: '草莓', area: 'farm', tier: 2, seedPrice: 30, growMs: 4 * H, price: 70, size: 40, unit: 'g' },
  pumpkin: { name: '南瓜', area: 'farm', tier: 2, seedPrice: 40, growMs: 6 * H, price: 100, size: 5, unit: 'kg' },
  watermelon: { name: '西瓜', area: 'farm', tier: 3, seedPrice: 60, growMs: 8 * H, price: 160, size: 6, unit: 'kg' },
  potato: { name: '土豆', area: 'farm', tier: 0, seedPrice: 9, growMs: 2.5 * H, price: 22, size: 0.3, unit: 'kg' },
  corn: { name: '玉米', area: 'farm', tier: 1, seedPrice: 16, growMs: 4 * H, price: 40, size: 0.5, unit: 'kg' },
  eggplant: { name: '茄子', area: 'farm', tier: 1, seedPrice: 20, growMs: 3.5 * H, price: 46, size: 0.35, unit: 'kg' },
  blueberry: { name: '蓝莓', area: 'farm', tier: 2, seedPrice: 32, growMs: 5 * H, price: 76, size: 2, unit: 'g' },
  grape: { name: '葡萄', area: 'farm', tier: 3, seedPrice: 55, growMs: 7 * H, price: 150, size: 0.5, unit: 'kg' },
};
export const FLOWERS = {
  daisy: { name: '雏菊', area: 'garden', tier: 0, seedPrice: 6, growMs: 1.5 * H, price: 14, size: 4, unit: 'cm', tea: true },
  sunflower: { name: '向日葵', area: 'garden', tier: 0, seedPrice: 10, growMs: 3 * H, price: 26, size: 20, unit: 'cm' },
  tulip: { name: '郁金香', area: 'garden', tier: 1, seedPrice: 12, growMs: 2.5 * H, price: 30, size: 7, unit: 'cm' },
  lavender: { name: '薰衣草', area: 'garden', tier: 1, seedPrice: 16, growMs: 3 * H, price: 38, size: 8, unit: 'cm', tea: true },
  rose: { name: '玫瑰', area: 'garden', tier: 2, seedPrice: 28, growMs: 5 * H, price: 72, size: 9, unit: 'cm', tea: true },
  hydrangea: { name: '绣球', area: 'garden', tier: 2, seedPrice: 34, growMs: 6 * H, price: 88, size: 18, unit: 'cm' },
  bluewhale: { name: '蓝鲸花', area: 'garden', tier: 3, seedPrice: 70, growMs: 10 * H, price: 220, size: 12, unit: 'cm' },
};
export const FISH = {
  crucian: { name: '鲫鱼', rarity: 'common', phases: ['morning', 'day', 'dusk', 'night'], price: 12, size: 15 },
  crayfish: { name: '小龙虾', rarity: 'common', phases: ['dusk', 'night'], price: 16, size: 9 },
  carp: { name: '鲤鱼', rarity: 'common', phases: ['morning', 'day', 'dusk'], price: 24, size: 35 },
  goldfish: { name: '金鱼', rarity: 'uncommon', phases: ['morning', 'day'], price: 40, size: 10 },
  grasscarp: { name: '草鱼', rarity: 'uncommon', phases: ['day'], price: 36, size: 50 },
  catfish: { name: '鲶鱼', rarity: 'uncommon', phases: ['dusk', 'night'], price: 48, size: 45 },
  koi: { name: '锦鲤', rarity: 'rare', phases: ['morning', 'day'], price: 150, size: 50 },
  moonfish: { name: '月光鱼', rarity: 'legendary', phases: ['night'], price: 400, size: 30, bait: 'bait-glow' },
};
for (const f of Object.values(FISH)) f.unit = 'cm';
export const PLANTS = { ...CROPS, ...FLOWERS };
export const ALL_SPECIES = { ...CROPS, ...FLOWERS, ...FISH };
export const kindOf = id => CROPS[id] ? 'crop' : FLOWERS[id] ? 'flower' : FISH[id] ? 'fish' : '';
export const RARITY = { common: { name: '普通', weight: 60 }, uncommon: { name: '少见', weight: 25 }, rare: { name: '稀有', weight: 8 }, legendary: { name: '传说', weight: 2 } };
export const BAITS = {
  none: { name: '不用鱼饵', mult: { common: 1, uncommon: 0.8, rare: 0.3, legendary: 0 }, size: 1 },
  bait: { name: '普通鱼饵', mult: { common: 1, uncommon: 1, rare: 1, legendary: 0 }, size: 1 },
  'bait-pro': { name: '高级鱼饵', mult: { common: 0.8, uncommon: 1.5, rare: 3, legendary: 0 }, size: 1.1 },
  'bait-glow': { name: '夜光鱼饵', mult: { common: 0.6, uncommon: 1.2, rare: 3, legendary: 20 }, size: 1.1 },
};
export const ITEMS = {
  'rice-bowl': '白米饭', bran: '米糠', bait: '普通鱼饵', 'bait-pro': '高级鱼饵', 'bait-glow': '夜光鱼饵',
  fishmeal: '鱼肥', compost: '有机肥', 'flower-tea': '花茶',
};
export const FERTILIZERS = { fishmeal: { size: 1.12, speed: 0.8 }, compost: { size: 1.08, speed: 0.8 } };
export const GRADES = [
  { id: 's', name: '小', below: 0.85, mult: 0.7 }, { id: 'm', name: '中', below: 1.15, mult: 1 },
  { id: 'l', name: '大', below: 1.4, mult: 1.5 }, { id: 'xl', name: '巨大', below: Infinity, mult: 3 },
];
export const gradeOf = ratio => GRADES.find(g => ratio < g.below);
export const gradeIndex = id => GRADES.findIndex(g => g.id === id || g.name === id);
export const TIER_AT = [0, 5, 11, 17];
export const PHASES = [{ id: 'morning', name: '清晨', start: 5 }, { id: 'day', name: '白天', start: 9 }, { id: 'dusk', name: '黄昏', start: 17 }, { id: 'night', name: '夜晚', start: 20 }];
export function phaseAt(time) {
  const hour = new Date(time).getHours();
  return ([...PHASES].reverse().find(p => hour >= p.start) || PHASES[3]).id;
}
export const FISHING = { minWaitMs: 3 * M, maxWaitMs: 15 * M, biteWindowMs: 10 * M };
export const LIMITS = { warehouse: 40, stack: 99, aquarium: 6, plotsStart: 4, plotsMax: 8 };
export const label = id => ALL_SPECIES[id]?.name || ITEMS[id] || id;
export function formatSize(id, size) {
  const unit = ALL_SPECIES[id]?.unit || '';
  return (unit === 'g' || unit === 'cm' ? Math.round(size * 10) / 10 : Math.round(size * 100) / 100) + unit;
}
