import { ALL_SPECIES } from './species.js';
import { parseRoomCommand } from './room-link.js';
const NAMES = Object.values(ALL_SPECIES).map(s => s.name);
const WORDS = ['小天地', '农场', '花园', '池塘', '鱼缸', '花瓶', '图鉴', '商店', '贝壳', '种子', '种地', '播种', '浇水', '施肥', '收获', '收成', '钓鱼', '钓', '鱼竿', '鱼饵', '收竿', '收杆',
  '卖', '买', '扩地', '委托', '育种', '留种', '果实', '巨大', '纪录', '煮饭', '花茶', '插花'];
/** Owner QQ text that talks about the little world becomes a wish (guidance only); room commands keep their own path. */
export function worldGuidance(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 2 || value.startsWith('/') || /^\[(图片|表情|转发消息|拍一拍|语音)\]/.test(value)) return '';
  if (parseRoomCommand(value)) return '';
  return [...WORDS, ...NAMES].some(word => value.includes(word)) ? value.slice(0, 80) : '';
}
/** DSH rejects tool output that is not lossless JSON (undefined fields, NaN, class instances). */
export const toJson = value => JSON.parse(JSON.stringify(value ?? null, (_, v) => typeof v === 'number' && !Number.isFinite(v) ? null : v));
