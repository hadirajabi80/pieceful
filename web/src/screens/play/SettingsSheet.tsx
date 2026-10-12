import { resolveTable, TABLES, useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { Sheet } from '../../components/Sheet'

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const theme = useStore((st) => st.theme)
  const auto = resolveTable('auto', theme)

  return (
    <Sheet label="Settings" onClose={onClose} className="settings-sheet">
      <h2>Settings</h2>
      <div className="setting">
        <span className="setting-label">Table</span>
        <div className="swatches" role="radiogroup" aria-label="Table colour">
          <button role="radio" aria-checked={s.table === 'auto'} className={'swatch' + (s.table === 'auto' ? ' is-on' : '')} onClick={() => s.set({ table: 'auto' })} title="Auto (follows theme)">
            <span style={{ background: `linear-gradient(135deg, ${TABLES[0].table} 50%, ${TABLES[1].table} 50%)` }} />
            <small>Auto</small>
          </button>
          {TABLES.map((t) => (
            <button key={t.id} role="radio" aria-checked={s.table === t.id} className={'swatch' + (s.table === t.id ? ' is-on' : '')} onClick={() => s.set({ table: t.id })} title={t.label}>
              <span style={{ background: t.table }} />
              <small>{t.label}</small>
            </button>
          ))}
        </div>
        {s.table === 'auto' && <p className="setting-hint muted">Using {auto.label} for the {theme} theme.</p>}
      </div>
      <div className="setting">
        <span className="setting-label">Piece edges</span>
        <Segmented label="Bevel strength" value={s.bevel} onChange={(v) => s.set({ bevel: v })} options={[{ v: 0.6, label: 'Subtle' }, { v: 0.9, label: 'Normal' }, { v: 1.25, label: 'Strong' }]} />
      </div>
      <div className="setting">
        <span className="setting-label">Ghost image</span>
        <Segmented label="Ghost opacity" value={s.ghostOpacity} onChange={(v) => s.set({ ghostOpacity: v })} options={[{ v: 0.15, label: 'Faint' }, { v: 0.25, label: 'Soft' }, { v: 0.4, label: 'Clear' }]} />
      </div>
      <label className="setting toggle">
        <span className="setting-label">Calm music</span>
        <input type="checkbox" checked={s.music} onChange={(e) => s.set({ music: e.target.checked })} />
      </label>
      <label className="setting toggle">
        <span className="setting-label">Show timer (off = zen mode)</span>
        <input type="checkbox" checked={s.showTimer} onChange={(e) => s.set({ showTimer: e.target.checked })} />
      </label>
      <label className="setting toggle">
        <span className="setting-label">Minimap</span>
        <input type="checkbox" checked={s.minimap} onChange={(e) => s.set({ minimap: e.target.checked })} />
      </label>
      <label className="setting toggle">
        <span className="setting-label">Vibration on snap</span>
        <input type="checkbox" checked={s.haptics} onChange={(e) => s.set({ haptics: e.target.checked })} />
      </label>
      <button className="btn btn-ghost btn-sm" onClick={() => s.set({ guideSeen: false })}>
        Show the welcome tour again
      </button>
      <div className="sheet-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}
