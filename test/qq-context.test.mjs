import test from 'node:test';
import assert from 'node:assert/strict';
import { createQqContextHook, createContextMessage } from '../lib/qq-context.js';
const facts = { ok: true, context: '【房间实时状态】正在看书，状态在线', recentDesktop: [], brief: '现在白天，你在小屋，贝壳 60。' };
const original = { kind: 'enter', startsRequestSeries: true, messages: [{ role: 'user', content: [{ type: 'text', text: '房间接进去了，你能看到吗' }] }] };
const message = async input => ({ ...input, id: 'fixture-message', role: 'user' });
test('QQ receives fresh room facts without model choosing a tool, only in owner session', async () => {
  let reads = 0;
  const hook = createQqContextHook({ adapter: { matchesSession: a => a.session.id === 'owner' },
    service: { async tool() { reads++; return facts; } }, createMessage: message, now: () => 1000 });
  const owner = await hook.handler({ agent: { session: { id: 'owner' } }, step: 1 }, async () => original);
  assert.equal(owner.messages.length, 2); assert.equal(owner.startsRequestSeries, true);
  assert.match(owner.messages[1].content[0].text, /正在看书/);
  assert.match(owner.messages[1].content[0].text, /没有截图流/);
  assert.equal(hook.status().lastInjectedAt, 1000);
  await hook.handler({ agent: { session: { id: 'owner' } }, step: 1, dryRun: true }, async () => original);
  assert.equal(hook.status().injections, 1, 'dry run must not claim a real QQ injection');
  const other = await hook.handler({ agent: { session: { id: 'another-chat' } }, step: 1 }, async () => original);
  assert.equal(other, original); assert.equal(reads, 2);
  const dedup = await hook.handler({ agent: { session: { id: 'owner' } }, step: 1 }, async () => owner);
  assert.equal(dedup, owner);
});
test('offline/read failure is explicit, reject and empty first steps are preserved', async () => {
  const hook = createQqContextHook({ adapter: { matchesSession: () => true },
    service: { async tool() { throw new Error('fixture disk failure'); } }, createMessage: message });
  const result = await hook.handler({ agent: {}, step: 1 }, async () => original);
  assert.match(result.messages.at(-1).content[0].text, /无法确认当前动作/); assert.ok(hook.status().lastError);
  const reject = { kind: 'reject' }; assert.equal(await hook.handler({ agent: {}, step: 1 }, async () => reject), reject);
  const empty = { kind: 'enter', messages: [] }; assert.equal(await hook.handler({ agent: {}, step: 1 }, async () => empty), empty);
});
test('context messages use DSH public immutable identified UserMessage shape', () => {
  const input = { content: [{ type: 'text', text: '事实' }], source: { kind: 'room-world' } };
  const message = createContextMessage(input);
  assert.match(message.id, /^[0-9a-f-]{36}$/); assert.equal(message.role, 'user');
  assert.ok(Object.isFrozen(message) && Object.isFrozen(message.content) && Object.isFrozen(message.content[0]) && Object.isFrozen(message.source));
  input.content[0].text = 'changed'; assert.equal(message.content[0].text, '事实');
});
