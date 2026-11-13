import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAdapter, describeMood } from '../lib/adapters.js';

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

test('mood keeps working for the legacy heart schema and reports dims plus top drives', () => {
  const text = describeMood({ fatigue: 80, joy: 50, stress: 10, curiosity: 30, attachment: 40, social: 20 },
    { play: 0.61, care: 0.29, connect: 0.2 });
  assert.match(text, /^有点累，想歇歇/);
  assert.match(text, /疲惫80/);
  assert.match(text, /最想要：玩61%、关心主人29%/);
  assert.ok(text.length <= 200);
});

test('mood uses surfcore emotion text and drives when the file has no heart block', () => {
  const drives = { play: 0.2155, learn: 0.12, install: 0.17, connect: 0.6211, care: 0.29, share: 0.2607, identity: 0.1485, create: 0.05, consume: 0.05 };
  const text = describeMood(undefined, drives, { lastEmotion: 'content', lastEmotionText: '有点惦记他，别的倒没什么' });
  assert.match(text, /^有点惦记他，别的倒没什么/);
  assert.match(text, /最想要：陪主人62%、关心主人29%/);
  assert.doesNotMatch(text, /平静/);
  assert.ok(text.length <= 200);
  assert.equal(describeMood(undefined, drives, { lastEmotion: 'worried' }), '担心；最想要：陪主人62%、关心主人29%');
  assert.equal(describeMood(null, null), '');
  assert.match(describeMood({}, {}), /^平静/);
});

test('bot adapter mood reads purpose-outreach.json without touching it', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'room-mood-')); t.after(() => fs.rmSync(home, { recursive: true }));
  const root = path.join(home, 'src', 'my-bot');
  const dir = path.join(home, 'my-bot', 'characters', 'fish');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(home, 'my-bot', 'characters', 'current.json'), JSON.stringify({ id: 'fish' }));
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ name: '小鱼' }));
  fs.writeFileSync(path.join(dir, 'persona.md'), '你是小鱼。');
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ ownerQQ: '10001' }));
  fs.writeFileSync(path.join(root, 'state', 'sessions.json'), JSON.stringify({ sessions: { 'private:10001': 's-1' } }));
  const moodFile = path.join(dir, 'purpose-outreach.json');
  fs.writeFileSync(moodFile, JSON.stringify({ drives: { connect: 0.62, care: 0.29 }, lastEmotion: 'content', lastEmotionText: '有点惦记他' }));
  const before = fs.statSync(moodFile).mtimeMs;

  const adapter = resolveAdapter({ adapter: 'bot', botName: 'my-bot', botRoot: root, dshHome: home });
  assert.equal(await adapter.mood(), '');
  await adapter.context();
  assert.equal(await adapter.mood(), '有点惦记他；最想要：陪主人62%、关心主人29%');
  assert.equal(fs.statSync(moodFile).mtimeMs, before);
});

test('bot adapter needs a bot name; unknown adapters are rejected', () => {
  assert.throws(() => resolveAdapter({ adapter: 'bot' }), /botName/);
  assert.throws(() => resolveAdapter({ adapter: 'nope' }), /未注册/);
  assert.equal(typeof resolveAdapter({}).context, 'function');
});
