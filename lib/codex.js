import { ALL_SPECIES, GRADES, kindOf, formatSize, label } from './species.js';
/** Permanent records; selling or releasing an item never changes the codex. Returns new milestones. */
export function recordCatch(s, item, context = {}) {
  const at = item.at;
  const entry = s.codex[item.species];
  const milestones = [];
  const grade = GRADES.find(g => g.id === item.grade);
  const best = { size: item.size, grade: item.grade, at, phase: context.phase || null, boost: context.boost || null, by: context.by || 'self' };
  if (!entry) {
    s.codex[item.species] = { kind: kindOf(item.species), first: at, count: 1, best };
    milestones.push({ type: 'new', text: '第一次获得' + label(item.species) + '（' + formatSize(item.species, item.size) + '，' + grade.name + '）' });
  } else {
    entry.count++;
    if (item.size > entry.best.size) {
      entry.best = best;
      milestones.push({ type: 'record', text: label(item.species) + '新纪录：' + formatSize(item.species, item.size) + '（' + grade.name + '）' });
    }
  }
  if (item.grade === 'xl' && !(entry?.giant)) {
    s.codex[item.species].giant = at;
    milestones.push({ type: 'giant', text: '第一次得到巨大的' + label(item.species) + '！' });
  }
  for (const m of milestones) s.milestones.push({ ...m, at, species: item.species, by: best.by });
  s.milestones = s.milestones.slice(-30);
  return milestones;
}
export function codexView(s) {
  const total = Object.keys(ALL_SPECIES).length;
  const entries = Object.entries(ALL_SPECIES).map(([id, sp]) => {
    const e = s.codex[id];
    return { species: id, name: sp.name, kind: kindOf(id), rarity: sp.rarity || null, found: !!e, count: e?.count || 0,
      first: e?.first || null, best: e ? { ...e.best, text: formatSize(id, e.best.size), gradeName: GRADES.find(g => g.id === e.best.grade)?.name } : null,
      giant: !!e?.giant };
  });
  return { found: entries.filter(e => e.found).length, total, entries };
}
