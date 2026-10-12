export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'pieceful-theme'
const mq = matchMedia('(prefers-color-scheme: dark)')

export function loadThemePref(): ThemePref {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref
}

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  try {
    localStorage.setItem(KEY, JSON.stringify(pref))
  } catch {
    /* private mode */
  }
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  return resolved
}

export function onSystemThemeChange(fn: () => void): () => void {
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
