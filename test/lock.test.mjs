import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireInstanceLock, releaseInstanceLock } from '../lib/lock.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a live instance keeps other profiles out of the same state folder', t => {
  const dir = tempDir(t);
  const first = acquireInstanceLock(dir, { pid: process.pid, now: () => 1 });
  assert.equal(first.ok, true);
  // Same pid may re-acquire (the plugin reload); another live pid is rejected.
  assert.equal(acquireInstanceLock(dir, { pid: process.pid }).ok, true);
  const blocked = acquireInstanceLock(dir, { pid: process.ppid, now: () => 2 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.holder.pid, process.pid);
  assert.equal(JSON.parse(fs.readFileSync(first.file, 'utf8')).pid, process.pid);
});

test('a stale lock is taken over and release only removes our own lock', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'instance.lock'), JSON.stringify({ pid: 2147483646, startedAt: 1 }));
  assert.equal(acquireInstanceLock(dir, { pid: process.pid }).ok, true);
  releaseInstanceLock(dir, { pid: 123456 });
  assert.equal(fs.existsSync(path.join(dir, 'instance.lock')), true, 'another pid cannot release it');
  releaseInstanceLock(dir, { pid: process.pid });
  assert.equal(fs.existsSync(path.join(dir, 'instance.lock')), false);
});
