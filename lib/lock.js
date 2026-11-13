import fs from 'node:fs';
import path from 'node:path';

/**
 * One room-world state can only be driven by one DSH process. Two profiles of the same DSH_HOME load
 * the plugin into the same ~/.dsh/room-world folder and both tick the world, so the last writer wins and
 * plans/chat logs interleave. The lock lives outside world.json so a stale process never corrupts saves.
 */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === 'EPERM'; }
}

export function acquireInstanceLock(stateDir, { pid = process.pid, now = Date.now } = {}) {
  const file = path.join(stateDir, 'instance.lock');
  try {
    const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (holder?.pid !== pid && alive(holder?.pid)) return { ok: false, file, holder };
  } catch {}
  fs.mkdirSync(stateDir, { recursive: true });
  const holder = { pid, startedAt: now() };
  fs.writeFileSync(file, JSON.stringify(holder));
  return { ok: true, file, holder };
}

export function releaseInstanceLock(stateDir, { pid = process.pid } = {}) {
  const file = path.join(stateDir, 'instance.lock');
  try {
    const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (holder?.pid === pid) fs.rmSync(file, { force: true });
  } catch {}
}
