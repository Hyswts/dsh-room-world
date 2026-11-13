import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBudgetGate, BUDGET_DEFAULTS, roomSessionId } from '../lib/budget.js';
import { createService } from '../lib/service.js';

const M = 60000, H = 60 * M;
const start = () => new Date(2026, 10, 5, 10).getTime();

/** A fake cost-meter service: programmable rows, counts queries, can throw on demand. */
function fakeMeter({ rows = [], onQuery } = {}) {
  const queries = [];
  return {
    queries,
    getSessionListCosts: async query => {
      queries.push(query);
      if (onQuery) return onQuery(query, queries.length);
      return rows;
    },
  };
}
const gateOf = (meter, extra = {}) => createBudgetGate({ getMeter: () => meter, sessionId: 'room-world-test', now: extra.now || (() => start()), config: extra.config || {} });
const meterWith = costCny => fakeMeter({ rows: [{ id: 'room-world-test', costCny, calls: 3, input: 100, output: 50, found: true }] });

test('room session id is lowercase hex, matches the character scope length, and is stable', () => {
  const id = roomSessionId('a');
  assert.match(id, /^room-world-[0-9a-f]{24}$/);
  assert.equal(id, roomSessionId('a'));
  assert.notEqual(id, roomSessionId('b'));
  assert.match(roomSessionId(''), /^room-world-[0-9a-f]{24}$/, 'empty character still yields a valid id');
});

test('budget: reads today\'s cost, deducts it from the daily budget and blocks when exhausted', async () => {
  let spend = 0.15;
  const meter = fakeMeter({ onQuery: () => [{ id: 'room-world-test', costCny: spend, apiCostCny: 0.2 }] });
  const gate = gateOf(meter, { config: { dailyBudgetCny: 0.6 } });
  const first = await gate.allow('plan');
  assert.equal(first.ok, true);
  assert.equal(first.spentCny, 0.15);
  assert.equal(first.budgetCny, 0.6);
  assert.equal(first.remainingCny, 0.45);
  assert.equal(first.code, 'BUDGET_OK');

  spend = 0.6;
  gate.invalidate();
  const blocked = await gate.allow('plan');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BUDGET_EXCEEDED');
  assert.equal(blocked.spentCny, 0.6);

  const state = gate.state();
  assert.equal(state.spentCny, 0.6);
  assert.equal(state.remainingCny, 0);
  assert.equal(state.ok, false);
});

test('budget: falls back to apiCostCny when costCny is missing, and fails closed when a found row has neither', async () => {
  // row without costCny but with apiCostCny
  const meter = fakeMeter({ rows: [{ id: 'room-world-test', apiCostCny: 0.25, found: true }] });
  const gate = gateOf(meter);
  const allowed = await gate.allow('plan');
  assert.equal(allowed.ok, true);
  assert.equal(allowed.spentCny, 0.25);

  // found:true says the session has ledger data, but no CNY amount survived the freeze:
  // that is a broken/unknown ledger, so fail closed.
  const broken = gateOf(fakeMeter({ rows: [{ id: 'room-world-test', calls: 2, found: true }] }));
  const blocked = await broken.allow('plan');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BUDGET_UNKNOWN');
  assert.equal(blocked.reason.includes('fail-closed'), true);
});

test('budget: a fresh session (found:false, no FX fields yet) counts as zero spend, not as unavailable', async () => {
  // Measured real shape from dsh-cost-meter session-tree.js: empty(id) has numeric buckets
  // but FX fields (costCny/apiCostCny) are absent until a contributing row recorded them.
  const meter = fakeMeter({ rows: [{ id: 'room-world-test', input: 0, output: 0, calls: 0, cost: 0, apiCost: 0, found: false }] });
  const gate = gateOf(meter, { config: { dailyBudgetCny: 0.6 } });
  const allowed = await gate.allow('plan');
  assert.equal(allowed.ok, true, 'the first plan must be allowed so it can create the ledger row');
  assert.equal(allowed.spentCny, 0);
  assert.equal(allowed.remainingCny, 0.6);
  assert.equal(allowed.code, 'BUDGET_OK');
  assert.equal(gate.state().ok, true);
  // and chat allowance reads the same fresh row without failing over
  const chat = await gate.allow('chat', { by: 'owner' });
  assert.equal(chat.ok, true);
  assert.equal(chat.code, 'BUDGET_OK');
});

test('budget: missing service, thrown query and invalid rows all fail closed (no model call)', async () => {
  const missing = createBudgetGate({ getMeter: () => undefined, sessionId: 'room-world-test', now: start });
  const plan = await missing.allow('plan');
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'BUDGET_UNKNOWN');
  assert.match(plan.reason, /cost-meter/);

  const noMethod = createBudgetGate({ getMeter: () => ({}), sessionId: 'room-world-test', now: start });
  assert.equal((await noMethod.allow('plan')).ok, false);

  const thrown = gateOf(fakeMeter({ onQuery: () => { throw new Error('ledger broken'); } }));
  const blocked = await thrown.allow('plan');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BUDGET_UNKNOWN');
  assert.match(blocked.reason, /ledger broken/);

  // chat is fail-closed too, but still grants the owner-grace window first.
  const chat = await thrown.allow('chat', { by: 'owner' });
  assert.equal(chat.ok, true, 'first owner message during grace');
  assert.equal(chat.code, 'BUDGET_UNKNOWN');
});

test('budget: the ledger is queried at most once per 60s cache window', async () => {
  let clock = start();
  const meter = meterWith(0.1);
  const gate = createBudgetGate({ getMeter: () => meter, sessionId: 'room-world-test', now: () => clock, config: { dailyBudgetCny: 0.6 } });
  await gate.allow('plan');
  await gate.allow('plan');
  await gate.allow('chat');
  assert.equal(meter.queries.length, 1, 'three checks inside 60s share one ledger read');
  clock += 59 * 1000;
  await gate.allow('plan');
  assert.equal(meter.queries.length, 1);
  clock += 2 * 1000;
  await gate.allow('plan');
  assert.equal(meter.queries.length, 2, 'a stale cache is refreshed');
  assert.deepEqual(meter.queries[0], { sessionIds: ['room-world-test'], period: 'today' });
});

test('budget: planMaxPerDay is a hard ceiling for self-plans, the owner replan bypasses the count only', async () => {
  const meter = meterWith(0);
  let clock = start();
  const gate = createBudgetGate({ getMeter: () => meter, sessionId: 'room-world-test', now: () => clock, config: { planMaxPerDay: 12, dailyBudgetCny: 0.6 } });
  const blocked = await gate.allow('plan', { usedToday: 12 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'PLAN_QUOTA');
  const owner = await gate.allow('plan', { usedToday: 12, by: 'owner' });
  assert.equal(owner.ok, true, 'the owner may ask her to rethink');
  // the amount is still a hard line for the owner
  const rich = gateOf(fakeMeter({ rows: [{ id: 'room-world-test', costCny: 0.6 }] }));
  const ownerBroke = await rich.allow('plan', { usedToday: 0, by: 'owner' });
  assert.equal(ownerBroke.ok, false);
  assert.equal(ownerBroke.code, 'BUDGET_EXCEEDED');
  assert.equal(BUDGET_DEFAULTS.planMaxPerDay, 12);
});

test('budget: disabled means allow everything without reading the ledger', async () => {
  const meter = fakeMeter({ onQuery: () => { throw new Error('should not be called'); } });
  const gate = gateOf(meter, { config: { enabled: false } });
  const allowed = await gate.allow('plan');
  assert.equal(allowed.ok, true);
  assert.equal(allowed.code, 'BUDGET_DISABLED');
  assert.equal(meter.queries.length, 0);
});

function serviceSetup(t, budget, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-budget-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const clock = { t: options.at ?? start() };
  const calls = [];
  const plan = { goal: '攒钱买番茄种子', why: '想试试新作物', steps: [{ action: 'plant', area: 'garden', species: 'daisy' }] };
  const s = createService({ stateDir: dir, now: () => clock.t, random: () => 0.5, planner: options.planner || { maxPerDay: 0 },
    budget,
    adapter: { context: async () => ({ id: 'a', persona: '人格A', memory: '记忆A' }), mood: async () => '心情不错' },
    complete: async args => { calls.push(args); return options.reply ? options.reply(args) : '\u0060\u0060\u0060json\n' + JSON.stringify(plan) + '\n\u0060\u0060\u0060'; } });
  return { dir, clock, calls, s };
}

test('G1: an exhausted budget stops autonomous planning and records the reason, without breaking sync', async t => {
  const meter = meterWith(0.6);
  const budget = createBudgetGate({ getMeter: () => meter, sessionId: 'room-world-test', config: { dailyBudgetCny: 0.6 }, now: () => start() });
  const { calls, s } = serviceSetup(t, budget);
  await s.refresh();
  await s.tool({ target: 'world', action: 'auto', enabled: true });
  await s.sync();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 0, 'no planner model call once the budget is gone');
  const planner = s.world().world.planner;
  assert.equal(planner.lastSkip, 'BUDGET_EXCEEDED');
  assert.match(planner.lastSkipReason, /预算用完/);
  assert.equal((await s.status(false)).syncError, '', 'the tick still succeeds');
  assert.ok(s.budgetState().spentCny >= 0.6);
});

test('G1 control: with budget left the same setup does plan (the gate is not over-blocking)', async t => {
  const budget = createBudgetGate({ getMeter: () => meterWith(0.05), sessionId: 'room-world-test', config: { dailyBudgetCny: 0.6 }, now: () => start() });
  const { calls, s } = serviceSetup(t, budget);
  await s.refresh();
  await s.tool({ target: 'world', action: 'auto', enabled: true });
  await s.sync();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.match(calls[0].sessionId, /^room-world-[0-9a-f]{24}$/, 'the planner call carries the synthetic session id');
  assert.equal(s.world().world.planner.lastSkip || '', '');
});

test('G2: panel replan is refused when the amount is spent, but works when only the count is used up', async t => {
  const broke = createBudgetGate({ getMeter: () => meterWith(0.6), sessionId: 'room-world-test', config: { dailyBudgetCny: 0.6 }, now: () => start() });
  const { calls, s } = serviceSetup(t, broke);
  await s.refresh();
  await assert.rejects(s.planNow('面板重新规划', { by: 'owner' }), e => e.code === 'BUDGET_EXCEEDED');
  assert.equal(calls.length, 0);

  const capOnly = createBudgetGate({ getMeter: () => meterWith(0.1), sessionId: 'room-world-test',
    config: { dailyBudgetCny: 0.6, planMaxPerDay: 1 }, now: () => start() });
  const second = serviceSetup(t, capOnly);
  await second.s.refresh();
  await second.s.tool({ target: 'world', action: 'auto', enabled: true });
  await second.s.sync(); await new Promise(r => setTimeout(r, 20));
  assert.equal(second.calls.length, 1, 'the self-plan used the single budgeted plan');
  await second.s.planNow('面板重新规划', { by: 'owner' });
  assert.equal(second.calls.length, 2, 'the owner exception still plans');
});

test('G4: after the budget is gone the owner gets 3 grace messages, then a friendly refusal', async t => {
  const meter = meterWith(0.6);
  const budget = createBudgetGate({ getMeter: () => meter, sessionId: 'room-world-test', config: { dailyBudgetCny: 0.6, chatGraceMessages: 3 }, now: () => start() });
  const { calls, s } = serviceSetup(t, budget, { reply: () => JSON.stringify({ text: '我在听' }) });
  await s.refresh();
  for (let i = 0; i < 3; i++) {
    const result = await s.chat('在吗 ' + i, 'req-grace-' + i);
    assert.equal(result.ok, true);
  }
  assert.equal(calls.length, 3);
  await assert.rejects(s.chat('第四次', 'req-grace-4'), /预算用完了/);
  assert.equal(calls.length, 3, 'the 4th message never reaches the model');
  const state = s.budgetState();
  assert.equal(state.graceRemaining, 0);
  assert.equal(state.chatsToday, 3);
});
