import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAdapter } from '../lib/adapters.js';

test('bot adapter reads persona and owner session of the named bot plugin', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'room-bot-')); t.after(() => fs.rmSync(home, { recursive: true }));
  const root = path.join(home, 'src', 'my-bot');
  const dir = path.join(home, 'my-bot', 'characters', 'fish');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(home, 'my-bot', 'characters', 'current.json'), JSON.stringify({ id: 'fish' }));
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ name: '小鱼' }));
  fs.writeFileSync(path.join(dir, 'persona.md'), '你是小鱼。');
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ ownerQQ: '10001' }));
  fs.writeFileSync(path.join(root, 'state', 'sessions.json'), JSON.stringify({ sessions: { 'private:10001': 's-1' } }));

  const adapter = resolveAdapter({ adapter: 'bot', botName: 'my-bot', botRoot: root, dshHome: home });
  const ctx = await adapter.context();
  assert.equal(ctx.name, '小鱼');
  assert.equal(ctx.persona, '你是小鱼。');
  assert.equal(adapter.ownerSessionId(), 's-1');
  assert.equal(adapter.matchesSession({ session: { id: 's-1' } }), true);
  assert.equal(adapter.matchesSession({ session: { id: 'other' } }), false);
});

test('bot adapter needs a bot name; unknown adapters are rejected', () => {
  assert.throws(() => resolveAdapter({ adapter: 'bot' }), /botName/);
  assert.throws(() => resolveAdapter({ adapter: 'nope' }), /未注册/);
  assert.equal(typeof resolveAdapter({}).context, 'function');
});
