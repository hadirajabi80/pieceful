import { create } from 'zustand'
import { setMuted } from '../audio/sfx'
import { listDone, listImages, listSaves, type DoneRecord, type SaveSummary } from '../storage/db'
import { applyTheme, loadThemePref, onSystemThemeChange, type ThemePref } from './theme'

export type Route = { name: 'home' } | { name: 'play'; imageId: string; cols: number; rows: number; nonce?: number }

/** Options chosen in the setup sheet for a fresh puzzle (ignored when resuming a save). */
export interface StartOptions {
  edgeStart: boolean
}

export type CategoryFilter = 'all' | 'paintings' | 'landscapes' | 'detailed' | 'japanese' | 'space' | 'mine'

export interface ToastItem {
  id: number
  text: string
  action?: { label: string; run: () => void }
  sticky?: boolean
}

export interface UserImageMeta {
  id: string
  imageId: string
  title: string
  aspect: number
  thumbUrl: string
}

interface State {
  route: Route
  themePref: ThemePref
  theme: 'light' | 'dark'
  muted: boolean
  toasts: ToastItem[]
  userImages: UserImageMeta[]
  saves: Record<string, SaveSummary>
  done: Record<string, DoneRecord>
  category: CategoryFilter
  startOptions: StartOptions
  setCategory: (c: CategoryFilter) => void
  setStartOptions: (o: Partial<StartOptions>) => void
  navigate: (r: Route, replace?: boolean) => void
  cycleTheme: () => void
  toggleMute: () => void
  toast: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
  refresh: () => Promise<void>
}

function routeToUrl(r: Route): string {
  return r.name === 'home' ? '/' : `/play/${encodeURIComponent(r.imageId)}/${r.cols}x${r.rows}`
}

export function urlToRoute(path: string): Route {
  const m = /^\/play\/([^/]+)\/(\d+)x(\d+)\/?$/.exec(path)
  if (m) return { name: 'play', imageId: decodeURIComponent(m[1]), cols: +m[2], rows: +m[3] }
  return { name: 'home' }
}

const MUTE_KEY = 'pieceful-muted'
const initialMuted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()
setMuted(initialMuted)

let toastId = 0
let thumbUrls: string[] = []
const initialTheme = loadThemePref()

export const useStore = create<State>((set, get) => ({
  route: urlToRoute(location.pathname),
  themePref: initialTheme,
  theme: applyTheme(initialTheme),
  muted: initialMuted,
  toasts: [],
  userImages: [],
  saves: {},
  done: {},
  category: 'all',
  startOptions: { edgeStart: false },

  setCategory(category) {
    set({ category })
  },

  setStartOptions(o) {
    set((s) => ({ startOptions: { ...s.startOptions, ...o } }))
  },

  navigate(route, replace = false) {
    const url = routeToUrl(route)
    if (replace) history.replaceState(null, '', url)
    else if (url !== location.pathname) history.pushState(null, '', url)
    set({ route })
    window.scrollTo(0, 0)
  },

  cycleTheme() {
    const order: ThemePref[] = ['system', 'light', 'dark']
    const next = order[(order.indexOf(get().themePref) + 1) % order.length]
    set({ themePref: next, theme: applyTheme(next) })
  },

  toggleMute() {
    const muted = !get().muted
    setMuted(muted)
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ muted })
  },

  toast(t) {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.text !== t.text), { ...t, id }] }))
    if (!t.sticky) setTimeout(() => get().dismiss(id), 3500)
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  async refresh() {
    const [imgs, saves, done] = await Promise.all([listImages(), listSaves(), listDone()])
    thumbUrls.forEach((u) => URL.revokeObjectURL(u))
    const userImages = imgs.map((i) => ({
      id: i.id,
      imageId: 'user:' + i.id,
      title: i.title,
      aspect: i.width / i.height,
      thumbUrl: URL.createObjectURL(i.thumb),
    }))
    thumbUrls = userImages.map((u) => u.thumbUrl)
    set({
      userImages,
      saves: Object.fromEntries(saves.map((s) => [s.id, s])),
      done: Object.fromEntries(done.map((d) => [d.id, d])),
    })
  },
}))

window.addEventListener('popstate', () => useStore.setState({ route: urlToRoute(location.pathname) }))
onSystemThemeChange(() => {
  const { themePref } = useStore.getState()
  if (themePref === 'system') useStore.setState({ theme: applyTheme('system') })
})
