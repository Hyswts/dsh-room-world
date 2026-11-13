import fs from 'node:fs';
import path from 'node:path';

/** Where the planner keeps the raw model replies for this character (diagnostics only, never uploaded). */
export const PLANNER_RAW_LIMIT_BYTES = 512 * 1024;
export const PLANNER_RAW_LIMIT_LINES = 500;
export function plannerRawFile(stateDir, scope) {
  return path.join(stateDir, 'characters', scope, 'planner-raw.jsonl');
}
const counts = new Map();
/**
 * Append one planner attempt ({ at, reason, round, code, error, finish, chars, ms, raw }).
 * Rolling keeps at most one previous generation (planner-raw.1.jsonl); failures are swallowed:
 * diagnostics must never break planning.
 */
export function appendPlannerAttempt(file, entry, { limitBytes = PLANNER_RAW_LIMIT_BYTES, limitLines = PLANNER_RAW_LIMIT_LINES } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    const lines = (counts.get(file) || 0) + 1;
    counts.set(file, lines);
    const size = fs.statSync(file).size;
    if (size > limitBytes || lines > limitLines) {
      const previous = file.replace(/\.jsonl$/, '.1.jsonl');
      try { fs.rmSync(previous, { force: true }); } catch {}
      try { fs.renameSync(file, previous); } catch {}
      counts.set(file, 0);
      return { ok: true, rotated: true };
    }
    return { ok: true, rotated: false, lines, size };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}
