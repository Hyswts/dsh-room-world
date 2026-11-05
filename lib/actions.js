export const HOME_ALIASES = ['go_home', 'return_home', 'back_home'];
/** Models often guess these names for looking around; treat them as observe. */
export const OBSERVE_ALIASES = ['status', 'look', 'check', 'state', 'view', 'inspect'];
export function roomAction(action) { return HOME_ALIASES.includes(action) ? 'home' : action; }
export function worldArgs(args) {
  if (HOME_ALIASES.includes(args.action) || args.action === 'home') return { ...args, action: 'visit', area: 'room' };
  if (['move', 'go_to'].includes(args.action)) {
    if (!args.area) throw Object.assign(new Error('移动时需要指定 area：room、farm、garden 或 pond'),
      { code: 'WORLD_AREA_REQUIRED', hint: '回房间使用 {target:"world",action:"visit",area:"room"}。' });
    return { ...args, action: 'visit' };
  }
  return args;
}
