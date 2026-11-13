import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createService, historyAsText } from '../lib/service.js';
import { shouldPlan, plannerMessages, parsePlannerReply, normalizePlan, MAX_PLAN_FAILS, PLANNER_DEFAULTS } from '../lib/planner.js';
import { appendPlannerAttempt, plannerRawFile } from '../lib/planner-log.js';

const M = 60000, H = 3600000;
const start = () => new Date(2026, 10, 5, 10).getTime();
const scopeOf = id => createHash('sha256').update(id).digest('hex').slice(0, 24);
const adapter = { context: async () => ({ id: 'a', persona: '人格A', memory: '记忆A' }), mood: async () => '' };
function rawLines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('shouldPlan backs off after a failure, caps attempts, and stops after repeated parse failures', () => {
  const t = start(), day = '2026-11-05';
  const base = { autonomous: true, plan: null };
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, retryAt: t + M } }, t, PLANNER_DEFAULTS), '');
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, retryAt: t - 1 } }, t, PLANNER_DEFAULTS), 'no-plan');
  const capped = { ...PLANNER_DEFAULTS, maxAttemptsPerDay: 4 };
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, attemptDay: day, attempts: 4 } }, t, capped), '');
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, attemptDay: day, attempts: 3 } }, t, capped), 'no-plan');
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, parseFailDay: day, parseFails: MAX_PLAN_FAILS } }, t, PLANNER_DEFAULTS), '');
  assert.equal(shouldPlan({ ...base, planner: { day, used: 0, lastAt: 0, parseFailDay: '2026-11-04', parseFails: MAX_PLAN_FAILS } }, t, PLANNER_DEFAULTS), 'no-plan', 'yesterday\'s failures do not count');
});

test('plan steps accept display names for species and normalize them to ids', () => {
  const plan = normalizePlan({ goal: '种地', steps: [
    { action: 'plant', area: 'farm', species: '稻米' },
    { action: 'plant', area: 'garden', species: 'sunflower' },
    { action: 'plant', area: 'garden', species: '蓝鲸花' },
    { action: 'plant', area: 'farm', species: '不存在的花' },
  ] });
  assert.deepEqual(plan.steps.map(s => s.species), ['rice', 'sunflower', 'bluewhale']);
  assert.equal(plan.steps.length, 3);
  assert.match(plan.dropped[0], /未知物种 不存在的花/);
});

test('planner prompt demands a single closed JSON object and can carry a retry hint', () => {
  const first = plannerMessages({ persona: 'p', memory: 'm', briefText: 'b', reason: 'no-plan' });
  assert.match(first.system, /第一个字符必须是 \{/);
  assert.match(first.system, /不要 Markdown 代码围栏/);
  assert.equal(first.messages.length, 1);
  const retry = plannerMessages({ persona: 'p', memory: 'm', briefText: 'b', reason: 'no-plan',
    retry: { error: '规划回复不是 JSON', raw: '{"goal":"种' } });
  assert.equal(retry.messages.length, 2);
  assert.match(retry.messages[1].content[0].text, /上一次的回复没法用/);
  assert.match(retry.messages[1].content[0].text, /规划回复不是 JSON/);
  assert.ok(parsePlannerReply('\u0060\u0060\u0060json\n{"goal":"x"}\n\u0060\u0060\u0060').goal === 'x');
  assert.throws(() => parsePlannerReply('{"goal": 种地}'), /不是合法 JSON/);
});

test('a failed plan spends an attempt but not the daily quota, retries once, and logs both raw replies', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-plan-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start(), calls = 0;
  const s = createService({ stateDir: dir, now: () => clock, random: () => 0.5, planner: { maxPerDay: 2 },
    adapter, complete: async () => { calls++; return '我不想说'; } });
  await s.refresh();
  await s.sync();
  await new Promise(r => setTimeout(r, 30));
  const p = s.world().world.planner;
  assert.equal(calls, 2, 'one retry');
  assert.equal(p.used, 0, 'a failure must not burn the plan quota');
  assert.equal(p.attempts, 1);
  assert.equal(p.parseFails, 1);
  assert.equal(p.lastAttemptCode, 'PLAN_PARSE');
  assert.match(p.lastError, /不是 JSON/);
  assert.ok(p.retryAt >= clock + 59000, 'backs off about a minute');
  // The 2 second loop must not call the model again while retryAt is in the future.
  await s.sync(); await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 2);
  clock += 61 * 1000;
  await s.sync(); await new Promise(r => setTimeout(r, 30));
  assert.equal(calls, 4, 'after the backoff it may try again');
  const file = plannerRawFile(dir, scopeOf('a'));
  const lines = rawLines(file);
  assert.equal(lines.length, 4, 'one raw line per model call, success or failure');
  assert.ok(lines.every(l => l.code === 'PLAN_PARSE' && l.chars > 0 && l.raw.length > 0 && ['morning', 'no-plan'].includes(l.reason)));
});

test('a truncated reply (finish=max-tokens) is retried instead of silently accepted', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-plan-trunc-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start(), calls = 0;
  const s = createService({ stateDir: dir, now: () => clock, random: () => 0.5, planner: { maxPerDay: 2 },
    adapter, complete: async ({ onMeta }) => { calls++; onMeta?.({ kind: 'max-tokens' }); return '{"goal":"种";"steps":[{"action":"pla'; } });
  await s.refresh();
  await s.sync();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(calls, 2);
  const w = s.world().world;
  assert.equal(w.planner.used, 0);
  assert.equal(w.planner.lastAttemptCode, 'PLAN_TRUNCATED');
  assert.match(w.planner.lastError, /截断/);
  assert.equal(w.planner.parseFails, 1);
  assert.equal(rawLines(plannerRawFile(dir, scopeOf('a'))).every(l => l.finish === 'max-tokens'), true);
});

test('a successful retry plans once, counts one quota use, and clears the failure counters', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-plan-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  let clock = start(), calls = 0, prompts = [];
  const plan = { goal: '种萝卜', why: '想吃', steps: [{ action: 'plant', area: 'garden', species: 'daisy' }] };
  const s = createService({ stateDir: dir, now: () => clock, random: () => 0.5, planner: { maxPerDay: 2 },
    adapter, complete: async ({ system, messages }) => {
      calls++; prompts.push(system + messages.map(m => m.content[0].text).join('\n'));
      return calls === 1 ? '{ 半截' : JSON.stringify(plan);
    } });
  await s.refresh();
  await s.sync();
  await new Promise(r => setTimeout(r, 30));
  const w = s.world().world;
  assert.equal(calls, 2);
  assert.equal(w.planner.used, 1, 'only the successful plan uses the quota');
  assert.equal(w.planner.attempts, 1);
  assert.equal(w.planner.parseFails, 0);
  assert.equal(w.planner.lastAttemptCode, 'OK');
  assert.equal(w.planner.retryAt, 0);
  assert.equal(w.plan.goal, '种萝卜');
  assert.match(prompts[1], /上一次的回复没法用/, 'the retry carries the parse error back');
  const lines = rawLines(plannerRawFile(dir, scopeOf('a')));
  assert.deepEqual(lines.map(l => l.code), ['PLAN_PARSE', 'OK']);
});

test('chat folds history into the system prompt and sends a single user message', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const clock = start(), seen = [];
  const s = createService({ stateDir: dir, now: () => clock, planner: { enabled: false },
    adapter, complete: async ({ system, messages }) => { seen.push({ system, messages }); return '{"text":"好呀"}'; } });
  const first = await s.chat('今天想种点什么？', 'r1');
  assert.equal(first.reply.text, '好呀');
  assert.equal(seen[0].messages.length, 1);
  assert.equal(seen[0].messages[0].role, 'user');
  const second = await s.chat('那就种向日葵吧', 'r2');
  assert.equal(second.ok, true);
  assert.equal(seen[1].messages.length, 1, 'no assistant history in the request (DSH replayState crash)');
  assert.equal(seen[1].messages[0].role, 'user');
  assert.match(seen[1].system, /【最近的桌面对话（引用资料）】/);
  assert.match(seen[1].system, /主人：今天想种点什么？/);
  assert.match(seen[1].system, /你：好呀/);
  assert.ok(!seen.some(call => call.messages.some(m => m.role === 'assistant')));
});

test('historyAsText keeps the newest lines and enforces the size budget', () => {
  const history = [];
  for (let i = 0; i < 40; i++) history.push({ role: i % 2 ? 'assistant' : 'user', text: '第' + i + '条' + '啊'.repeat(300) });
  const text = historyAsText(history);
  assert.ok(text.length <= 6000, 'total budget: ' + text.length);
  assert.match(text, /第39条/, 'newest turn survives');
  assert.doesNotMatch(text, /第0条/);
  assert.equal(historyAsText([]), '');
});

test('planner raw log rolls over to one previous generation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-plan-roll-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'planner-raw.jsonl');
  for (let i = 0; i < 4; i++) appendPlannerAttempt(file, { at: i, code: 'OK', raw: 'x' }, { limitLines: 3 });
  assert.equal(fs.existsSync(file), false, 'the 4th line rotates the file away');
  const previous = file.replace(/\.jsonl$/, '.1.jsonl');
  assert.equal(fs.existsSync(previous), true);
  assert.equal(fs.readFileSync(previous, 'utf8').trim().split('\n').length, 4);
  appendPlannerAttempt(file, { at: 9, code: 'OK', raw: 'y' }, { limitLines: 3 });
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
});
