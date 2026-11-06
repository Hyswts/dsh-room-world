import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorld } from '../lib/world.js';
import { createService } from '../lib/service.js';
import { buildBrief } from '../lib/brief.js';
import { shouldPlan, parsePlannerReply } from '../lib/planner.js';

const M = 60000, H = 60 * M;
const start = () => new Date(2026, 10, 5, 10).getTime();
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-loop-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const clock = { t: start() };
  const make = () => createWorld({ file: path.join(dir, 'world.json'), now: () => clock.t, random: options.random || (() => 0.5) });
  return { dir, clock, w: make(), make };
}
function grow(w, clock, area, slot, stageMs) {
  for (let i = 0; i < 3; i++) { w.act({ action: 'water', area, slot }); clock.t += stageMs + 1; }
}

test('crops grow in three watered stages, survive reload, reject early rewards, and deduplicate requests', t => {
  const { w, clock, make } = setup(t);
  w.act({ action: 'plant', area: 'farm', slot: 0, species: 'rice', requestId: 'plant-1' });
  w.act({ action: 'plant', area: 'farm', slot: 0, species: 'rice', requestId: 'plant-1' });
  assert.equal(w.snapshot().seeds.rice.count, 3, 'duplicate request must not spend a second seed');
  assert.throws(() => w.act({ action: 'harvest', area: 'farm', slot: 0 }), /未成熟/);
  w.act({ action: 'water', area: 'farm', slot: 0 }); clock.t += 40 * M + 1;
  assert.equal(w.snapshot().farm[0].thirsty, true, 'each stage needs water again');
  assert.equal(w.snapshot().farm[0].stage, 1);
  w.act({ action: 'water', area: 'farm', slot: 0 }); clock.t += 40 * M + 1;
  w.act({ action: 'water', area: 'farm', slot: 0 }); clock.t += 40 * M + 1;
  const reloaded = make(); assert.equal(reloaded.snapshot().farm[0].ready, true);
  reloaded.act({ action: 'harvest', area: 'farm', slot: 0, requestId: 'harvest-1' });
  reloaded.act({ action: 'harvest', area: 'farm', slot: 0, requestId: 'harvest-1' });
  const view = reloaded.snapshot();
  assert.equal(view.warehouse.length, 1); assert.equal(view.warehouse[0].grade, 'm'); assert.equal(view.codex.found, 1);
  assert.throws(() => reloaded.act({ action: 'plant', area: 'farm', slot: 9 }), /地块编号/);
});

test('fishing has a bite window, spends bait, and records catches in the codex', t => {
  const { w, clock } = setup(t);
  w.act({ action: 'cast', item: 'bait' }); assert.equal(w.snapshot().items.bait, 2);
  assert.throws(() => w.act({ action: 'collect' }), /还没有鱼/);
  assert.throws(() => w.act({ action: 'cast' }), /已有鱼竿/);
  clock.t += 9 * M + 1;
  const caught = w.act({ action: 'collect' });
  assert.ok(caught.item && caught.milestones.some(m => m.type === 'new'));
  assert.equal(w.snapshot().warehouse.length, 1);
  w.act({ action: 'cast' }); clock.t += 30 * M;
  assert.equal(w.snapshot().fishing.state, 'escaped');
  assert.equal(w.act({ action: 'collect' }).escaped, true);
  assert.equal(w.snapshot().warehouse.length, 1, 'an escaped fish gives nothing');
});

test('fertilizer and luck make giants, which become records and better seeds', t => {
  const { w, clock } = setup(t, { random: () => 0.99 });
  w.act({ action: 'cast', item: 'bait' }); clock.t += 15 * M;
  const fish = w.act({ action: 'collect' }).item;
  w.act({ action: 'craft', recipe: 'fishmeal', itemId: fish.id });
  assert.equal(w.snapshot().items.fishmeal, 2);
  w.act({ action: 'plant', area: 'farm', species: 'rice' });
  w.act({ action: 'fertilize', area: 'farm', slot: 0 });
  assert.throws(() => w.act({ action: 'fertilize', area: 'farm', slot: 0 }), /施过肥/);
  grow(w, clock, 'farm', 0, 40 * M);
  const result = w.act({ action: 'harvest', area: 'farm', slot: 0, keepSeed: true });
  assert.equal(result.item.grade, 'xl');
  assert.ok(result.milestones.some(m => m.type === 'giant'));
  const view = w.snapshot();
  assert.equal(view.seeds.rice.bestLineage, 0.06, 'giant harvest kept as a better seed');
  assert.equal(view.seeds.rice.count, 4, 'keeping seed replaces the fruit with exactly one seed');
  assert.equal(view.warehouse.length, 0, 'kept as seed instead of stored');
  assert.equal(view.milestones.at(-1).type, 'giant');
});

test('neglected watering lowers care and the harvest grade', t => {
  const { w, clock } = setup(t);
  w.act({ action: 'plant', area: 'farm', species: 'rice' });
  for (let i = 0; i < 3; i++) { clock.t += 6 * H; w.act({ action: 'water', area: 'farm', slot: 0 }); clock.t += 40 * M + 1; }
  const item = w.act({ action: 'harvest', area: 'farm', slot: 0 }).item;
  assert.equal(item.grade, 's'); assert.ok(item.size < 0.7);
});

test('economy: shop tiers, buying, selling, cooking, and room meals use real stock', t => {
  const { w, clock } = setup(t);
  assert.throws(() => w.act({ action: 'buy', item: 'seed:tomato' }), /商店里没有/, 'tier 1 seeds stay locked');
  const bought = w.act({ action: 'buy', item: 'seed:radish', qty: 2 }); assert.equal(w.snapshot().shells, 40);
  assert.match(bought.text, /去镇上集市/); assert.equal(bought.world.location, 'away'); assert.equal(bought.world.outing.purpose, 'market');
  assert.throws(() => w.act({ action: 'plant', area: 'farm', species: 'rice' }), /出门/, 'no field work while in town');
  assert.equal(w.act({ action: 'recall' }).text, '从集市回来了');
  assert.throws(() => w.act({ action: 'buy', item: 'plot:farm' }), /贝壳不够/);
  assert.equal(w.roomActivity('rice'), '想吃白米饭，但电饭煲空了'); assert.ok(w.snapshot().cravings.rice);
  w.act({ action: 'plant', area: 'farm', species: 'rice' }); grow(w, clock, 'farm', 0, 40 * M);
  w.act({ action: 'harvest', area: 'farm', slot: 0 });
  w.act({ action: 'cook' });
  let view = w.snapshot();
  assert.equal(view.items['rice-bowl'], 2); assert.equal(view.items.bran, 1); assert.equal(view.cravings.rice, undefined);
  w.roomActivity('rice'); assert.equal(w.snapshot().items['rice-bowl'], 1);
  w.act({ action: 'plant', area: 'farm', species: 'radish' }); grow(w, clock, 'farm', 0, 30 * M);
  w.act({ action: 'harvest', area: 'farm', slot: 0 });
  const radish = w.snapshot().warehouse[0];
  const sold = w.act({ action: 'sell', itemId: radish.id });
  assert.equal(sold.earned, Math.round(radish.price * 0.8), 'field stall pays 80%'); assert.equal(w.snapshot().shells, 40 + sold.earned);
  assert.match(sold.text, /田园小摊/); assert.equal(w.snapshot().outing, null, 'selling at the stall needs no trip');
  view = w.snapshot();
  assert.equal(view.codex.found, 2, 'selling keeps codex records');
  assert.equal(view.orders.length, 2);
  assert.ok(w.act({ action: 'shop' }).shop.items.some(i => i.item === 'seed:rice'));
  assert.equal(w.act({ action: 'codex' }).codex.total, 27);
});

test('v1 saves migrate to v2 with items, plots and codex entries', t => {
  const { dir, make, clock } = setup(t);
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ version: 1, inventory: { rice: 2, flower: 1, fish: 1 },
    farm: [{ crop: 'rice', plantedAt: 1, readyAt: clock.t - 1, watered: true }, { crop: 'rice', plantedAt: 1, readyAt: null, watered: false }, null, null],
    garden: [null, null, null, null], fishing: { castAt: 1, readyAt: 2 }, location: 'farm', activity: 'plant', autonomous: true, nextAt: 0, log: [], requests: ['old-1'] }));
  const view = make().snapshot();
  assert.equal(view.version, 2); assert.equal(view.warehouse.length, 4); assert.equal(view.codex.found, 3);
  assert.equal(view.farm[0].ready, true); assert.equal(view.farm[1].thirsty, true); assert.equal(view.fishing, null);
  assert.equal(view.location, 'farm'); assert.equal(view.autonomous, true);
  assert.equal(make().act({ action: 'plant', area: 'farm', slot: 2, requestId: 'old-1' }).duplicate, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'world.json.v1-backup.json'), 'utf8')).version, 1, 'original v1 save is kept');
});

test('she plays by herself for days, rests when she chooses, and resumes on her own', t => {
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { w, clock } = setup(t, { random });
  for (let i = 0; i < 3 * 24 * 60; i++) { w.tick(); clock.t += M; }
  const view = w.snapshot();
  assert.ok(view.codex.found >= 4, 'found ' + view.codex.found);
  assert.ok(view.farm.some(Boolean) || view.garden.some(Boolean), 'still farming after three days');
  assert.ok(view.farm.length + view.garden.length > 8 || view.shells > 100, 'trading at the market pays for seeds and land');
  assert.ok(view.warehouse.length < view.warehouseLimit, 'warehouse does not overflow');
  w.act({ action: 'auto', enabled: false }); const before = JSON.stringify(w.snapshot().log);
  assert.equal(w.snapshot().autonomous, false);
  clock.t += 50 * M; w.tick(); assert.equal(JSON.stringify(w.snapshot().log), before, 'resting means no chores');
  clock.t += 11 * M; assert.equal(w.snapshot().autonomous, true, 'rest ends by itself');
  w.tick(); assert.notEqual(JSON.stringify(w.snapshot().log), before);
});

test('her plan runs step by step; invalid steps are dropped and failures recorded', t => {
  const { w, clock } = setup(t);
  const set = w.act({ action: 'plan', plan: { goal: '种萝卜', steps: [{ action: 'buy', item: 'seed:radish', qty: 1 }, { action: 'teleport' },
    { action: 'plant', area: 'farm', species: 'radish' }, { action: 'buy', item: 'seed:watermelon' }], policy: { keepRareFish: false, reserveShells: 10 } } }, { by: 'self' });
  assert.deepEqual(set.dropped, ['teleport：不支持']);
  assert.equal(w.snapshot().policy.reserveShells, 10);
  w.act({ action: 'auto', enabled: true });
  for (let i = 0; i < 12; i++) { w.tick(); clock.t += 15000; }
  const plan = w.snapshot().plan;
  assert.equal(plan.steps[0].status, 'done'); assert.equal(w.snapshot().farm[0].species, 'radish');
  assert.equal(plan.steps[2].status, 'failed'); assert.match(plan.steps[2].error, /商店里没有/);
  assert.equal(plan.status, 'done');
  w.act({ action: 'plan', policy: { keepSeedMinGrade: '巨大' } });
  assert.equal(w.snapshot().policy.keepSeedMinGrade, 'xl');
});

test('service: brief replaces raw JSON, room meals consume stock, and planning is model-driven but limited', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-plan-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start(), calls = 0, prompt = '';
  const plan = { goal: '攒钱买番茄种子', why: '想试试新作物', steps: [{ action: 'plant', area: 'garden', species: 'daisy' }], policy: { reserveShells: 30 } };
  const s = createService({ stateDir: dir, now: () => clock, random: () => 0.5, planner: { maxPerDay: 2 },
    adapter: { context: async () => ({ id: 'a', persona: '人格A', memory: '记忆A' }), mood: async () => '心情不错；最想要：玩60%' },
    complete: async ({ system, messages }) => { calls++; prompt = system + messages[0].content[0].text; return '```json\n' + JSON.stringify(plan) + '\n```'; } });
  await s.refresh();
  const observed = await s.tool({ target: 'world', action: 'observe' });
  assert.match(observed.brief, /贝壳 60/); assert.match(observed.brief, /心境：心情不错/);
  assert.equal(observed.world.farm, undefined, 'tool replies stay compact');
  s.room.updateRoom({ activity: 'rice', phase: 'day', position: { x: 77, y: 76 } });
  assert.ok(s.world().world.cravings.rice, 'eating without stock becomes a craving');
  await s.tool({ target: 'world', action: 'auto', enabled: true });
  await s.sync();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 1); assert.match(prompt, /人格A/); assert.match(prompt, /小屋简报/);
  const world = s.world().world;
  assert.equal(world.plan.goal, '攒钱买番茄种子'); assert.equal(world.plan.source, 'self'); assert.equal(world.policy.reserveShells, 30);
  assert.equal(world.planner.used, 1);
  await s.sync(); await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 1, 'an active plan does not trigger another model call');
  await s.planNow('test'); assert.equal(calls, 2);
  await assert.rejects(s.planNow('test'), /规划次数用完/);
  assert.equal(shouldPlan({ ...s.world().world, plan: null, planner: { ...world.planner, used: 2 } }, clock), '');
  assert.throws(() => parsePlannerReply('不想说'), /不是 JSON/);
  assert.ok(buildBrief(s.world().world).length < 1200, 'brief stays short');
});

test('owner QQ guidance about the little world becomes a wish; room commands and old messages do not', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-qq-wish-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const clock = start();
  const msg = (id, text, ago = 0, role = 'user') => ({ key: 'private:1', ownerQQ: '1', role, text, messageId: id, at: clock - ago });
  let inbox = [msg('a', '今天多钓点鱼，想看锦鲤'), msg('b', '去吃白米饭'), msg('c', '西瓜种得怎么样', 2 * H), msg('d', '在吗'), msg('e', '我也想看西瓜', 0, 'assistant')];
  const s = createService({ stateDir: dir, now: () => clock, planner: { enabled: false },
    adapter: { context: async () => ({ id: 'a', persona: 'p' }), messages: async () => inbox }, complete: async () => '' });
  await s.sync(); await s.sync();
  const wishes = s.world().world.wishes;
  assert.deepEqual(wishes.map(w => w.text), ['今天多钓点鱼，想看锦鲤']); assert.equal(wishes[0].source, 'qq');
  assert.match((await s.tool({ target: 'world', action: 'observe' })).brief, /QQ 里说「今天多钓点鱼，想看锦鲤」/);
  assert.equal(s.world().world.planner.wantReason, 'wish', 'a new wish asks her to rethink her plan');
});

test('outing: she leaves the room and the world, can be recalled, and comes back by herself', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-outing-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start();
  const s = createService({ stateDir: dir, now: () => clock, planner: { enabled: false }, adapter: { context: async () => ({ id: 'a', persona: 'p' }) }, complete: async () => '' });
  await s.refresh();
  const wish = await s.tool({ target: 'world', action: 'wish', text: 'see  sunset   please' }, { by: 'owner' });
  assert.equal(wish.world.wishes[0].text, 'see sunset please', 'whitespace collapses without eating the letter s');
  assert.equal((await s.tool({ target: 'world', action: 'outing', hours: 1 }, { by: 'owner' })).code, 'OWNER_GUIDANCE_ONLY', 'going out is her decision');
  const out = await s.tool({ target: 'world', action: 'outing', hours: 1 });
  assert.equal(out.world.location, 'away'); assert.ok(out.world.outing); assert.equal(out.world.autonomous, false);
  assert.equal(s.commands(0).events.at(-1).action, 'away', 'the room shows her leaving');
  assert.equal((await s.tool({ target: 'world', action: 'plant', area: 'farm', species: 'rice' })).code, 'OUTING_AWAY');
  const before = s.world().world.log.length;
  clock += 30 * M; await s.sync();
  assert.equal(s.world().world.log.length, before, 'no chores while she is out');
  assert.match((await s.tool({ target: 'world', action: 'observe' })).brief, /出门去/);
  const back = await s.tool({ target: 'world', action: 'recall' }, { by: 'owner' });
  assert.equal(back.world.location, 'room'); assert.equal(back.world.outing, null);
  assert.equal(s.commands(0).events.at(-1).action, 'home');
  assert.equal((await s.tool({ target: 'world', action: 'recall' }, { by: 'owner' })).code, 'NOT_OUT');
  await s.tool({ target: 'world', action: 'outing', hours: 1 });
  clock += 61 * M; await s.sync();
  assert.equal(s.world().world.location, 'room', 'she comes back on her own when the time is up');
  assert.equal(s.commands(0).events.at(-1).action, 'home');
  assert.equal((await s.tool({ target: 'world', action: 'visit', area: 'farm' }, { by: 'owner' })).code, 'OWNER_GUIDANCE_ONLY');
});

test('market trip: she goes to town to buy seeds by herself and comes back when done', t => {
  const { w, clock } = setup(t);
  for (const species of ['rice', 'daisy']) while (w.snapshot().seeds[species]) w.act({ action: 'plant', area: species === 'rice' ? 'farm' : 'garden', species });
  const seen = [];
  for (let i = 0; i < 12; i++) { const r = w.tick(); if (r?.text) seen.push(r.text); clock.t += 15000; }
  const trip = seen.findIndex(x => /去镇上集市/.test(x));
  assert.ok(trip >= 0, seen.join(' / '));
  assert.ok(seen.slice(trip).some(x => x === '从集市回来了'), 'returns on her own: ' + seen.join(' / '));
  assert.equal(w.snapshot().outing, null);
  assert.ok(Object.keys(w.snapshot().seeds).length || [...w.snapshot().farm, ...w.snapshot().garden].filter(Boolean).length > 4, 'bought seeds got used');
});

test('market: full-price selling and browsing; strolls elsewhere do not trade', t => {
  const { w, clock } = setup(t);
  w.act({ action: 'plant', area: 'farm', species: 'rice' }); grow(w, clock, 'farm', 0, 40 * M);
  w.act({ action: 'harvest', area: 'farm', slot: 0 });
  const item = w.snapshot().warehouse[0];
  const sold = w.act({ action: 'sell', itemId: item.id, at: 'market' });
  assert.equal(sold.earned, item.price, 'full price in town'); assert.match(sold.text, /去镇上集市/);
  w.act({ action: 'recall' });
  const browse = w.act({ action: 'outing', place: 'market', hours: 1 }, { by: 'self' });
  assert.equal(browse.world.outing.place, 'market'); assert.equal(browse.world.outing.purpose, 'stroll');
  for (let i = 0; i < 6; i++) { w.tick(); clock.t += 15000; }
  assert.ok(w.snapshot().outing, 'browsing the market does not end early');
  w.act({ action: 'recall' });
  const sea = w.act({ action: 'outing', place: 'seaside' });
  assert.equal(sea.world.outing.place, 'seaside');
  const bought = w.act({ action: 'buy', item: 'bait' });
  assert.match(bought.text, /顺路去集市/); assert.equal(bought.world.outing.place, 'market');
});

test('stars rate size against the species standard; codex keeps the best stars', t => {
  const { w, clock } = setup(t, { random: () => 0.99 });
  w.act({ action: 'plant', area: 'farm', species: 'rice' }); grow(w, clock, 'farm', 0, 40 * M);
  w.act({ action: 'harvest', area: 'farm', slot: 0 });
  const item = w.snapshot().warehouse[0];
  assert.equal(item.stars, 4, 'about 1.29x standard size is four stars');
  assert.equal(w.act({ action: 'codex' }).codex.entries.find(e => e.species === 'rice').best.stars, 4);
});

test('settings: planning is unlimited by default; pacing options change the world', async t => {
  const { resolveConfig } = await import('../lib/config.js');
  const cfg = resolveConfig({});
  assert.equal(cfg.planner.maxPerDay, 0, 'no daily cap by default');
  const view = { autonomous: true, plan: null, planner: { day: '2026-11-05', used: 50, lastAt: 0 } };
  assert.equal(shouldPlan(view, start(), cfg.planner), 'no-plan', 'still plans after many runs');
  assert.equal(shouldPlan(view, start(), resolveConfig({ planner: { maxPerDay: 3 } }).planner), '', 'a set cap still applies');
  assert.equal(resolveConfig({ world: { growthSpeed: 99, stallRate: 0.1 } }).world.growthSpeed, 20, 'values are clamped');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-opts-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start();
  const w = createWorld({ file: path.join(dir, 'w.json'), now: () => clock, random: () => 0.5, options: { growthSpeed: 4, stallRate: 0.5 } });
  w.act({ action: 'plant', area: 'farm', species: 'rice' });
  for (let i = 0; i < 3; i++) { w.act({ action: 'water', area: 'farm', slot: 0 }); clock += 10 * M + 1; }
  assert.equal(w.snapshot().farm[0].ready, true, 'four times faster: 2h rice ready in 30 minutes');
  w.act({ action: 'harvest', area: 'farm', slot: 0 });
  const item = w.snapshot().warehouse[0];
  assert.equal(w.act({ action: 'sell', itemId: item.id }).earned, Math.round(item.price * 0.5));
});

test('settings changed in place (DSH volatile config) are picked up without restarting', async t => {
  const { resolveConfig } = await import('../lib/config.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-live-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const config = {}; let clock = start(), calls = 0;
  const s = createService({ stateDir: dir, now: () => clock, settings: () => resolveConfig(config),
    adapter: { context: async () => ({ id: 'a', persona: 'p' }) }, complete: async () => { calls++; return '{"goal":"x","steps":[]}'; } });
  await s.refresh();
  config.plannerMaxPerDay = 1;
  await s.planNow('t1'); await assert.rejects(s.planNow('t2'), /用完/);
  config.plannerMaxPerDay = 0;
  await s.planNow('t3'); assert.equal(calls, 2, 'raising the cap applies immediately');
  config.plannerEnabled = false; clock += 3 * H;
  await s.sync(); await new Promise(r => setTimeout(r, 20)); assert.equal(calls, 2, 'turning planning off stops automatic plans');
});

test('volatile settings arrive as live references and are unwrapped', async t => {
  const { resolveConfig } = await import('../lib/config.js');
  const ref = v => ({ get: () => v });
  const cfg = resolveConfig({ plannerMaxPerDay: ref(7), plannerEnabled: ref(false), qqWishes: ref(false), growthSpeed: ref(2), adapter: 'surfcore' });
  assert.equal(cfg.planner.maxPerDay, 7); assert.equal(cfg.planner.enabled, false); assert.equal(cfg.qqWishes, false); assert.equal(cfg.world.growthSpeed, 2);
});
