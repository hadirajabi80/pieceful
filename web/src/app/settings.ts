import { create } from 'zustand'

export interface TablePreset {
  id: string
  label: string
  table: string
  slot: string
  line: string
}

export const TABLES: TablePreset[] = [
  { id: 'linen', label: 'Linen', table: '#E9E2D6', slot: '#DFD6C8', line: '#B9AE9F' },
  { id: 'slate', label: 'Slate', table: '#3A3F4B', slot: '#30343E', line: '#5B6170' },
  { id: 'felt', label: 'Felt', table: '#2F5D4A', slot: '#27503F', line: '#4E8068' },
  { id: 'walnut', label: 'Walnut', table: '#5A4034', slot: '#4C352B', line: '#7D5B4B' },
  { id: 'charcoal', label: 'Charcoal', table: '#1F2126', slot: '#191B1F', line: '#3A3D44' },
  { id: 'navy', label: 'Navy', table: '#243249', slot: '#1D293D', line: '#3D5070' },
]

export const tableById = (id: string) => TABLES.find((t) => t.id === id) ?? TABLES[0]

export interface Settings {
  /** table preset id; 'auto' = linen in light, slate in dark */
  table: string
  bevel: number
  ghostOpacity: number
  haptics: boolean
  minimap: boolean
  /** whether the first-run guide was completed/dismissed */
  guideSeen: boolean
  /** calm generated background music while playing */
  music: boolean
  /** zen mode hides the timer */
  showTimer: boolean
}

const KEY = 'pieceful-settings'
const DEFAULTS: Settings = { table: 'auto', bevel: 0.9, ghostOpacity: 0.25, haptics: true, minimap: true, guideSeen: false, music: false, showTimer: true }

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    const { set: _omit, ...rest } = { ...get(), ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(rest))
    } catch {
      /* private mode */
    }
  },
}))

export function resolveTable(id: string, theme: 'light' | 'dark'): TablePreset {
  if (id === 'auto') return tableById(theme === 'dark' ? 'slate' : 'linen')
  return tableById(id)
}
