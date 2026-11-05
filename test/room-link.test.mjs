import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRoomLink, parseRoomCommand } from '../lib/room-link.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'room-link-test-'));
let clock = 100000;
const link = createRoomLink({ stateDir: temp, characterId: 'role-a', now: () => clock });
try {
  assert.equal(link.room().online, false);
  const invalid = link.updateRoom({ activity: 'injected instruction' });
  assert.equal(invalid.code, 'ROOM_STATE_INVALID');
  assert.ok(invalid.hint);
  assert.equal(link.updateRoom({ activity: 'rice', phase: 'day', autonomous: true, position: { x: 77, y: 76 } }).ok, true);
  assert.match(link.context(), /正在吃最喜欢的白米饭/);
  assert.equal(link.room().autonomous, true);
  clock += 31000;
  assert.match(link.context(), /状态已过期/);
  clock = 100000;

  for (const [text, action] of [
    ['大肥鱼，去吃白米饭吧', 'rice'], ['你去看书', 'read'], ['请开灯', 'lamp-on'],
    ['自己玩吧', 'auto'], ['回来吧', 'home'], ['先别动', 'pause'],
    ['不要去吃白米饭', ''], ['我去吃饭', ''], ['你在吃白米饭吗？', ''],
    ['他说去睡觉', ''], ['如果你去睡觉', ''],
  ]) assert.equal(parseRoomCommand(text), action, text);

  const bad = link.recordQq({ key: 'group:1', ownerQQ: '123', role: 'user', text: '去睡觉', messageId: 'bad' });
  assert.equal(bad.ignored, true);
  assert.equal(link.recordQq({ key: 'private:456', ownerQQ: '123', text: '去睡觉' }).ignored, true);
  assert.equal(link.recordQq({ key: 'private:123', ownerQQ: '', text: '去睡觉' }).ignored, true);
  assert.equal(link.recordQq({ key: 'private:123', ownerQQ: '123', text: '去吃白米饭', messageId: 'u1' }).ok, true);
  assert.equal(link.recordQq({ key: 'private:123', ownerQQ: '123', text: '去吃白米饭', messageId: 'u1' }).duplicate, true);
  const first = link.events(0);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].action, 'rice');
  const commandId = first.events[0].commandId;
  assert.match(link.context(), /尚未确认执行/);
  link.updateRoom({ activity: 'walk', phase: 'day', position: { x: 68, y: 70 },
    lastCommand: { id: commandId, action: 'rice', status: 'accepted' } });
  assert.match(link.context(), /accepted/);
  link.updateRoom({ activity: 'rice', phase: 'day', position: { x: 77, y: 76 },
    lastCommand: { id: commandId, action: 'rice', status: 'arrived' } });
  assert.match(link.context(), /arrived/);
  link.recordQq({ key: 'private:123', ownerQQ: '123', role: 'assistant', text: '去睡觉', messageId: 'a1' });
  const reply = link.events(1).events[0];
  assert.equal(reply.role, 'assistant');
  assert.equal(reply.action, undefined);
  assert.match(link.qqContext(), /你在 QQ 已回复/);
  assert.equal(link.qqMessages()[0].channel, 'qq');
  assert.deepEqual(link.events().events, []);
  assert.equal(link.events(9999).events.length, 0);

  const other = createRoomLink({ stateDir: temp, characterId: 'role-b', now: () => clock });
  assert.equal(other.qqMessages().length, 0);
  assert.equal(other.room().online, false);
  const historyDir = path.join(temp, 'characters', createHash('sha256').update('role-a').digest('hex').slice(0, 24));
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'chat.json'),
    JSON.stringify([{ role: 'assistant', text: '房间专属回答', at: clock }]));
  assert.match(link.qqPromptContext(), /房间专属回答/);
  assert.equal(link.events(0).events.some(event => event.text === '房间专属回答'), false,
    'reading desktop context must never enqueue QQ delivery');

  const file = path.join(temp, 'file-instead-of-directory');
  fs.writeFileSync(file, 'fixture');
  const blocked = createRoomLink({ stateDir: file });
  const error = blocked.updateRoom({ activity: 'idle', phase: 'day', position: { x: 50, y: 77 } });
  assert.equal(error.code, 'ROOM_STATE_WRITE_FAILED');
  assert.ok(error.hint);
  const recordError = blocked.recordQq({ key: 'private:123', ownerQQ: '123', text: '在吗' });
  assert.equal(recordError.code, 'ROOM_QQ_WRITE_FAILED');
  assert.ok(recordError.hint);
  console.log('PASS room awareness, QQ owner-only input, command acknowledgement, deduplication, role isolation and one-way delivery');
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('room-link-test-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
