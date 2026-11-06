// DSH web client module: a settings section for 「大肥鱼 · 房间与小天地」.
// Values are stored in the plugin's own config namespace (declared by `Config` in config.js);
// DSH reloads the plugin after saving, so changes take effect right away.
window.__ModuleLoader__.load({
  id: 'dsh-room-world',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-room-world'
    const defaults = {
      qqContext: true, qqWishes: true, persona: '',
      planner: { enabled: true, maxPerDay: 0, minGapMinutes: 120, eventGapMinutes: 20 },
      world: { growthSpeed: 1, tickSeconds: 15, marketMinutes: 30, outingHours: 2, restHomeMinutes: 30, stallRate: 0.8 },
    }
    const merge = (value) => ({
      ...defaults, ...(value || {}),
      planner: { ...defaults.planner, ...(value?.planner || {}) },
      world: { ...defaults.world, ...(value?.world || {}) },
    })
    // [path, label, hint, kind, min, max, step]
    const groups = [
      ['她的规划', [
        [['planner', 'enabled'], '让她自己定打算', '会调用 DSH 默认模型。关掉后她只按固定习惯照料小天地。', 'bool'],
        [['planner', 'maxPerDay'], '每天最多规划几次', '0 为不限。', 'number', 0, 1000, 1],
        [['planner', 'minGapMinutes'], '没有打算时，两次规划至少间隔（分钟）', '', 'number', 5, 1440, 5],
        [['planner', 'eventGapMinutes'], '有新心愿、新纪录时，至少隔多久再规划（分钟）', '', 'number', 1, 1440, 1],
      ]],
      ['小天地节奏', [
        [['world', 'growthSpeed'], '作物生长速度倍率', '1 为默认节奏，2 表示快一倍，0.5 表示慢一半。', 'number', 0.1, 20, 0.1],
        [['world', 'tickSeconds'], '她每隔多少秒做一件事', '', 'number', 5, 300, 1],
        [['world', 'marketMinutes'], '去集市办事最多多少分钟', '', 'number', 5, 240, 5],
        [['world', 'outingHours'], '出门走走默认多少小时', '', 'number', 0.5, 12, 0.5],
        [['world', 'restHomeMinutes'], '叫她回小屋后歇多少分钟', '', 'number', 0, 240, 5],
        [['world', 'stallRate'], '田园小摊价格是集市的几成', '例如 0.8 表示八成。', 'number', 0.3, 1, 0.05],
      ]],
      ['QQ 与人格', [
        [['qqContext'], '在主人 QQ 私聊里补入小屋状态', '', 'bool'],
        [['qqWishes'], '主人 QQ 里说到小天地的话自动记成心愿', '', 'bool'],
        [['persona'], '自带人格设定（仅独立模式）', '留空则使用自带的大肥鱼人格。', 'text'],
      ]],
    ]
    const get = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj)
    const set = (obj, path, value) => {
      const copy = { ...obj }
      if (path.length === 1) copy[path[0]] = value
      else copy[path[0]] = { ...(obj[path[0]] || {}), [path[1]]: value }
      return copy
    }

    function RoomWorldConfig({ view, scope }) {
      const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
      const [draft, setDraft] = React.useState(() => merge(snapshot.value))
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState('')
      React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
      React.useEffect(() => { if (snapshot.status === 'ready') setDraft(merge(snapshot.value)) }, [snapshot.revision, snapshot.status])

      if (view === 'summary') return h('div', null, '大肥鱼的规划、小天地节奏和 QQ 互通设置')
      if (snapshot.status !== 'ready') return h('div', { style: { padding: 16, color: 'var(--dsw-alias-label-secondary)' } },
        snapshot.status === 'loading' ? '正在读取设置…' : '当前 DSH 组合没有提供这个插件的设置。')

      const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.5 }
      const input = { boxSizing: 'border-box', width: '100%', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-surface-primary)', color: 'var(--dsw-alias-label-primary)' }
      const field = ([path, label, hint, kind, min, max, step]) => {
        const value = get(draft, path)
        const key = path.join('.')
        if (kind === 'bool') return h('label', { key, style: { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' } },
          h('input', { type: 'checkbox', checked: value !== false, onChange: (e) => setDraft(set(draft, path, e.target.checked)) }),
          h('span', null, label, hint ? h('div', { style: muted }, hint) : null))
        if (kind === 'text') return h('label', { key, style: { display: 'grid', gap: 6, margin: '12px 0' } },
          h('span', null, label), h('textarea', { style: { ...input, minHeight: 90, resize: 'vertical' }, value: value || '', maxLength: 6000, onChange: (e) => setDraft(set(draft, path, e.target.value)) }),
          hint ? h('span', { style: muted }, hint) : null)
        return h('label', { key, style: { display: 'grid', gap: 6, margin: '12px 0' } },
          h('span', null, label),
          h('input', { style: input, type: 'number', min, max, step, value, onChange: (e) => setDraft(set(draft, path, e.target.value === '' ? '' : Number(e.target.value))) }),
          hint ? h('span', { style: muted }, hint) : null)
      }
      const clamp = (v, [, , , kind, min, max]) => kind === 'number' ? Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v !== '' ? Number(v) : min)) : v
      const save = async () => {
        setBusy(true); setError(''); setSaved('')
        try {
          const ops = []
          for (const [, fields] of groups) for (const spec of fields) {
            const [path, , , kind] = spec
            let value = clamp(get(draft, path), spec)
            if (kind === 'bool') value = value !== false
            if (kind === 'text') value = String(value || '').trim()
            if (path[0] === 'planner' && path[1] === 'maxPerDay') value = Math.floor(value)
            ops.push({ op: 'set', path, value })
          }
          await scope.mutate(ops, snapshot.revision)
          setSaved('已保存，插件会自动重新加载，新设置马上生效。')
        } catch (e) { setError(String(e?.message ?? e)) }
        finally { setBusy(false) }
      }
      const reset = () => setDraft(merge({ persona: draft.persona }))

      return h('div', { style: { padding: 16, maxWidth: 720 } },
        h('h3', { style: { marginTop: 0 } }, '大肥鱼 · 房间与小天地'),
        h('p', { style: { ...muted, fontSize: 13 } }, '小天地里的事都由她自己做。这里调整的是她规划的频率和小天地的节奏，不会替她做决定。'),
        ...groups.map(([title, fields]) => h('section', { key: title, style: { margin: '18px 0', paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)' } },
          h('h4', { style: { margin: '4px 0 6px' } }, title), ...fields.map(field))),
        error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-status-danger)' } }, '保存失败：' + error) : null,
        saved ? h('div', { role: 'status', style: { color: 'var(--dsw-alias-status-success)' } }, saved) : null,
        h('div', { style: { display: 'flex', gap: 10, marginTop: 10 } },
          h('button', { type: 'button', disabled: busy || !snapshot.writable, onClick: save, style: { padding: '8px 16px', border: 0, borderRadius: 8, cursor: busy ? 'wait' : 'pointer' } }, busy ? '保存中…' : snapshot.writable ? '保存设置' : '当前只读'),
          h('button', { type: 'button', disabled: busy, onClick: reset, style: { padding: '8px 16px', border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 8, cursor: 'pointer' } }, '恢复默认（保存后生效）')))
    }

    const inject = ['slots', 'configForms']
    function apply(ctx) {
      const forms = ctx.configForms
      let registration = null
      const contribute = () => {
        if (registration !== null) return
        registration = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: NS, order: 45, label: () => '大肥鱼 · 小天地',
          // DSH publishes the namespace scope only while the config form is served.
          inject: () => ({ scope: forms.get(NS) }),
        }, RoomWorldConfig))
      }
      const withdraw = () => {
        if (registration === null) return
        const dispose = registration
        registration = null
        if (typeof dispose === 'function') dispose()
      }
      ctx.effect(() => forms.whileServed([NS], () => { contribute(); return withdraw }), 'dsh-room-world: 设置入口')
    }
    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
