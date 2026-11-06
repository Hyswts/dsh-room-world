import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WORLD_DEFAULTS, worldOptions } from './world.js';

const require = createRequire(import.meta.url);
/**
 * DSH serves a settings namespace for a plugin only when it exports a Schemastery `Config`.
 * Schemastery is loaded the way the host does (CommonJS). When the plugin is linked from a source
 * folder, fall back to the copy installed in the DSH profile; without either (plain Node tests)
 * no Config is exported and defaults apply.
 */
function loadSchema() {
  try { return require('@deepseek-ai/schemastery'); } catch {}
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  try {
    for (const profile of fs.readdirSync(path.join(home, 'profiles'))) {
      try { return require(path.join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'schemastery')); } catch {}
    }
  } catch {}
  return null;
}
const Schema = loadSchema();

export const PLANNER_CONFIG_DEFAULTS = Object.freeze({ enabled: true, maxPerDay: 0, minGapMinutes: 120, eventGapMinutes: 20 });

/** Every key the plugin reads must be declared, or the host strips it from the stored config. */
export const Config = Schema ? Schema.object({
  adapter: Schema.string().default('standalone').description('人格来源：standalone 为自带人格，或填写已注册的机器人适配器名。'),
  surfcoreRoot: Schema.string().description('外部机器人目录（使用对应适配器时）。'),
  persona: Schema.string().role('textarea').description('standalone 模式下的人格设定（留空用自带大肥鱼人格）。'),
  dshHome: Schema.string().description('DSH 数据目录，一般留空。'),
  qqContext: Schema.boolean().default(true).description('在主人 QQ 私聊里补入房间事实和小屋简报。'),
  qqWishes: Schema.boolean().default(true).description('主人 QQ 里说到小天地的话自动记成心愿。'),
  planner: Schema.object({
    enabled: Schema.boolean().default(true).description('让她自己定打算（会调用 DSH 默认模型）。'),
    maxPerDay: Schema.natural().default(0).description('每天最多规划几次，0 为不限。'),
    minGapMinutes: Schema.number().min(5).max(1440).default(120).description('没有打算时，两次规划至少间隔多少分钟。'),
    eventGapMinutes: Schema.number().min(1).max(1440).default(20).description('有新心愿、新纪录时，至少隔多少分钟才重新规划。'),
  }).description('她的规划'),
  world: Schema.object({
    growthSpeed: Schema.number().min(0.1).max(20).default(WORLD_DEFAULTS.growthSpeed).description('作物生长速度倍率，2 表示快一倍。'),
    tickSeconds: Schema.number().min(5).max(300).default(WORLD_DEFAULTS.tickSeconds).description('她每隔多少秒做一件事。'),
    marketMinutes: Schema.number().min(5).max(240).default(WORLD_DEFAULTS.marketMinutes).description('去集市办事最多多少分钟。'),
    outingHours: Schema.number().min(0.5).max(12).default(WORLD_DEFAULTS.outingHours).description('出门走走默认多少小时。'),
    restHomeMinutes: Schema.number().min(0).max(240).default(WORLD_DEFAULTS.restHomeMinutes).description('叫她回小屋后歇多少分钟。'),
    stallRate: Schema.number().min(0.3).max(1).step(0.05).default(WORLD_DEFAULTS.stallRate).description('田园小摊的价格是集市的几成。'),
  }).description('小天地节奏'),
}) : undefined;

/** Normalise whatever the host passed (or nothing) into the values the service uses. */
export function resolveConfig(config = {}) {
  const p = { ...PLANNER_CONFIG_DEFAULTS, ...(config.planner || {}) };
  const num = (v, d, lo, hi) => Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d;
  return {
    qqContext: config.qqContext !== false,
    qqWishes: config.qqWishes !== false,
    planner: {
      enabled: p.enabled !== false,
      maxPerDay: Math.floor(num(p.maxPerDay, 0, 0, 100000)),
      minGapMs: num(p.minGapMinutes, 120, 5, 1440) * 60000,
      eventGapMs: num(p.eventGapMinutes, 20, 1, 1440) * 60000,
    },
    world: worldOptions(config.world || {}),
  };
}
