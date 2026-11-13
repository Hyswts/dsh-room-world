import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WORLD_DEFAULTS, worldOptions } from './world.js';

const require = createRequire(import.meta.url);
/**
 * Load Schemastery the way the host does (CommonJS). A plugin linked from a source folder cannot
 * resolve it from its own node_modules, so fall back to the copy installed in the DSH profile;
 * without either (plain Node tests) no Config is exported and defaults apply.
 */
/** Where Schemastery came from (or why it did not load), for diagnostics. */
export const schemaSource = { from: '', errors: [], attempts: 0 };
/**
 * While DSH boots it may still be loading cosmokit (an ES module Schemastery requires), and require()
 * then fails with "not yet fully loaded". That is a timing race, not a missing package: wait and retry.
 */
async function loadSchema() {
  const candidates = ['@deepseek-ai/schemastery'];
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  try {
    for (const profile of fs.readdirSync(path.join(home, 'profiles'))) candidates.push(path.join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'schemastery'));
  } catch {}
  const missing = new Set();
  for (let attempt = 0; attempt < 60; attempt++) {
    schemaSource.attempts = attempt + 1;
    let racing = false;
    for (const candidate of candidates) {
      if (missing.has(candidate)) continue;
      try { const schema = require(candidate); schemaSource.from = candidate; return schema; }
      catch (e) {
        const message = String(e.message);
        if (/not yet fully loaded|race condition/i.test(message)) racing = true;
        else missing.add(candidate);
        if (schemaSource.errors.length < 6) schemaSource.errors.push(message.slice(0, 200));
      }
    }
    if (!racing) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
}
const Schema = await loadSchema();

export const PLANNER_CONFIG_DEFAULTS = Object.freeze({ enabled: true, maxPerDay: 0, minGapMinutes: 120, eventGapMinutes: 20 });

/**
 * DSH publishes a settings namespace only for a Config with `volatile()` fields, and the settings
 * page edits exactly those fields. Volatile values are updated in place on the running config
 * object without restarting the plugin, so the plugin reads them through resolveConfig() each time.
 * Keys without volatile (adapter, folders) stay file-only and are not shown on the page.
 */
export const Config = Schema ? (() => {
  const live = schema => schema.volatile();
  return Schema.object({
    adapter: Schema.string().default('standalone').description('人格来源：standalone 为自带人格；bot 为读取机器人插件的人格与 QQ 记录；也可填其他已注册的适配器名。'),
    botName: Schema.string().description('adapter 为 bot 时：机器人插件的名字（~/.dsh 下的同名目录）。'),
    botRoot: Schema.string().description('adapter 为 bot 时：机器人插件源码目录，一般留空自动查找。'),
    dshHome: Schema.string().description('DSH 数据目录，一般留空。'),
    persona: live(Schema.string().role('textarea').default('')).description('独立模式下的人格设定，留空用自带的大肥鱼人格。'),
    qqContext: live(Schema.boolean().default(true)).description('在主人 QQ 私聊里补入房间事实和小屋简报。'),
    qqWishes: live(Schema.boolean().default(true)).description('主人 QQ 里说到小天地的话自动记成心愿。'),
    syncIntervalSeconds: live(Schema.number().min(5).max(120).default(30)).description('多久同步一次机器人插件的文件与 QQ 记录（秒）。QQ 注入是推送式，不受此影响。'),
    plannerEnabled: live(Schema.boolean().default(true)).description('让她自己定打算（会调用 DSH 默认模型）。'),
    plannerMaxPerDay: live(Schema.natural().default(0)).description('每天最多规划几次，0 为不限。'),
    plannerMinGapMinutes: live(Schema.number().min(5).max(1440).default(120)).description('没有打算时，两次规划至少间隔多少分钟。'),
    plannerEventGapMinutes: live(Schema.number().min(1).max(1440).default(20)).description('有新心愿、新纪录时，至少隔多少分钟才重新规划。'),
    budgetEnabled: live(Schema.boolean().default(true)).description('成本笼子：每天的花费与规划/聊天次数上限（读 dsh-cost-meter 的会话账本，读不到就不调模型）。'),
    budgetDailyCny: live(Schema.number().min(0).max(1000).default(0.6)).description('每天最多花多少元（按 cost-meter 的今日会话金额），0 为不限金额。'),
    budgetPlanMaxPerDay: live(Schema.natural().default(12)).description('每天最多自主规划几次（独立于 plannerMaxPerDay，两者取更严），0 为不限。'),
    budgetChatMaxPerDay: live(Schema.natural().default(60)).description('每天最多桌面聊天几次，0 为不限。'),
    budgetChatGraceMessages: live(Schema.natural().default(3)).description('预算用完后仍允许主人继续聊几条，默认 3，超出后回复预算已用完。'),
    growthSpeed: live(Schema.number().min(0.1).max(20).default(WORLD_DEFAULTS.growthSpeed)).description('作物生长速度倍率，2 表示快一倍。'),
    tickSeconds: live(Schema.number().min(5).max(300).default(WORLD_DEFAULTS.tickSeconds)).description('她每隔多少秒做一件事。'),
    marketMinutes: live(Schema.number().min(5).max(240).default(WORLD_DEFAULTS.marketMinutes)).description('去集市办事最多多少分钟。'),
    outingHours: live(Schema.number().min(0.5).max(12).default(WORLD_DEFAULTS.outingHours)).description('出门走走默认多少小时。'),
    restHomeMinutes: live(Schema.number().min(0).max(240).default(WORLD_DEFAULTS.restHomeMinutes)).description('叫她回小屋后歇多少分钟。'),
    stallRate: live(Schema.number().min(0.3).max(1).step(0.05).default(WORLD_DEFAULTS.stallRate)).description('田园小摊的价格是集市的几成。'),
  });
})() : undefined;

/** Normalise the (flat, or older nested) config into the values the service uses. Call it on every use: volatile fields change in place. */
/** A volatile field arrives as a live reference with get(); plain values (tests, files) pass through. */
export const unwrap = v => v && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v;
export function resolveConfig(raw = {}) {
  const config = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k, unwrap(v)]));
  const old = config.planner || {}, oldWorld = config.world || {};
  const pick = (flat, nested, d) => config[flat] ?? nested ?? d;
  const num = (v, d, lo, hi) => Number.isFinite(Number(v)) && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d;
  return {
    qqContext: config.qqContext !== false,
    qqWishes: config.qqWishes !== false,
    sync: { intervalMs: num(pick('syncIntervalSeconds', config.sync?.intervalSeconds, 30), 30, 5, 120) * 1000 },
    planner: {
      enabled: pick('plannerEnabled', old.enabled, true) !== false,
      maxPerDay: Math.floor(num(pick('plannerMaxPerDay', old.maxPerDay, 0), 0, 0, 100000)),
      minGapMs: num(pick('plannerMinGapMinutes', old.minGapMinutes, 120), 120, 5, 1440) * 60000,
      eventGapMs: num(pick('plannerEventGapMinutes', old.eventGapMinutes, 20), 20, 1, 1440) * 60000,
    },
    budget: (() => {
      const oldBudget = config.budget || {};
      return {
        enabled: pick('budgetEnabled', oldBudget.enabled, true) !== false,
        dailyBudgetCny: num(pick('budgetDailyCny', oldBudget.dailyBudgetCny, 0.6), 0.6, 0, 1000),
        planMaxPerDay: Math.floor(num(pick('budgetPlanMaxPerDay', oldBudget.planMaxPerDay, 12), 12, 0, 100000)),
        chatMaxPerDay: Math.floor(num(pick('budgetChatMaxPerDay', oldBudget.chatMaxPerDay, 60), 60, 0, 100000)),
        chatGraceMessages: Math.floor(num(pick('budgetChatGraceMessages', oldBudget.chatGraceMessages, 3), 3, 0, 1000)),
      };
    })(),
    world: worldOptions({
      growthSpeed: pick('growthSpeed', oldWorld.growthSpeed), tickSeconds: pick('tickSeconds', oldWorld.tickSeconds),
      marketMinutes: pick('marketMinutes', oldWorld.marketMinutes), outingHours: pick('outingHours', oldWorld.outingHours),
      restHomeMinutes: pick('restHomeMinutes', oldWorld.restHomeMinutes), stallRate: pick('stallRate', oldWorld.stallRate),
    }),
  };
}
