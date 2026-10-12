import { create } from 'zustand'
import { CATALOG, catalogById } from '../catalog/catalog'
import type { IconName } from '../components/Icon'
import { chooseGrid } from '../engine/layout'

/** Lifetime stats, achievements and the daily-puzzle streak (persisted in localStorage). */
export interface Profile {
  completed: number
  piecesPlaced: number
  playMs: number
  biggest: number
  fastest100: number | null
  bestCombo: number
  hintsUsed: number
  artworks: string[]
  categories: string[]
  sorted: string[]
  noHintBig: number
  daily: { last: string | null; streak: number; best: number }
  achievements: Record<string, number>
}

const KEY = 'pieceful-profile'
const EMPTY: Profile = {
  completed: 0,
  piecesPlaced: 0,
  playMs: 0,
  biggest: 0,
  fastest100: null,
  bestCombo: 0,
  hintsUsed: 0,
  artworks: [],
  categories: [],
  sorted: [],
  noHintBig: 0,
  daily: { last: null, streak: 0, best: 0 },
  achievements: {},
}

function load(): Profile {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v ? { ...EMPTY, ...v, daily: { ...EMPTY.daily, ...v.daily } } : EMPTY
  } catch {
    return EMPTY
  }
}

// ---------- achievements ----------

export interface Achievement {
  id: string
  title: string
  desc: string
  icon: IconName
  test: (p: Profile) => boolean
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', title: 'First masterpiece', desc: 'Finish your first puzzle', icon: 'sparkle', test: (p) => p.completed >= 1 },
  { id: 'five', title: 'Gallery regular', desc: 'Finish 5 puzzles', icon: 'pieces', test: (p) => p.completed >= 5 },
  { id: 'collector', title: 'Collector', desc: 'Finish 10 different artworks', icon: 'grid', test: (p) => p.artworks.length >= 10 },
  { id: 'explorer', title: 'Explorer', desc: 'Finish a puzzle in every category', icon: 'map', test: (p) => ['paintings', 'detailed', 'japanese', 'landscapes', 'space'].every((c) => p.categories.includes(c)) },
  { id: 'k1', title: 'Thousand pieces', desc: 'Finish a 1000-piece puzzle', icon: 'layers', test: (p) => p.biggest >= 1000 },
  { id: 'k3', title: 'Epic', desc: 'Finish a 3000-piece puzzle', icon: 'layers', test: (p) => p.biggest >= 3000 },
  { id: 'k5', title: 'Legend', desc: 'Finish a 5000-piece puzzle', icon: 'sparkle', test: (p) => p.biggest >= 5000 },
  { id: 'speed', title: 'Quick hands', desc: 'Finish 100+ pieces in under 10 minutes', icon: 'timer', test: (p) => p.fastest100 !== null && p.fastest100 < 10 * 60_000 },
  { id: 'pure', title: 'No peeking', desc: 'Finish 300+ pieces without a hint', icon: 'eyeOff', test: (p) => p.noHintBig >= 1 },
  { id: 'combo5', title: 'On a roll', desc: 'Snap a 5× combo', icon: 'fire', test: (p) => p.bestCombo >= 5 },
  { id: 'combo10', title: 'Unstoppable', desc: 'Snap a 10× combo', icon: 'fire', test: (p) => p.bestCombo >= 10 },
  { id: 'sorter', title: 'Organised', desc: 'Use every sorting tool', icon: 'sort', test: (p) => ['edges', 'color', 'tidy'].every((k) => p.sorted.includes(k)) },
  { id: 'pieces10k', title: 'Ten thousand', desc: 'Place 10,000 pieces in total', icon: 'hand', test: (p) => p.piecesPlaced >= 10_000 },
  { id: 'daily3', title: 'Daily habit', desc: 'Keep a 3-day daily streak', icon: 'calendar', test: (p) => p.daily.best >= 3 },
  { id: 'daily7', title: 'Devoted', desc: 'Keep a 7-day daily streak', icon: 'calendar', test: (p) => p.daily.best >= 7 },
]

// ---------- daily puzzle ----------

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const DAILY_PIECES = 200

/** Today's puzzle: same for everyone on a given day. */
export function dailyPuzzle(d = new Date()) {
  const key = dayKey(d)
  const art = CATALOG[hash('pieceful:' + key) % CATALOG.length]
  const g = chooseGrid(DAILY_PIECES, art.width / art.height)
  return { key, art, cols: g.cols, rows: g.rows, count: g.count }
}

const yesterday = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dayKey(d)
}

// ---------- store ----------

interface ProfileState extends Profile {
  /** records a finished puzzle; returns newly unlocked achievements */
  recordCompletion: (e: { imageId: string; cols: number; rows: number; total: number; elapsedMs: number; hints: number; bestCombo: number }) => Achievement[]
  recordSort: (kind: 'edges' | 'color' | 'tidy') => Achievement[]
  recordCombo: (n: number) => Achievement[]
  /** effective streak (0 if the chain is broken) */
  streak: () => number
}

function unlock(p: Profile): { next: Profile; fresh: Achievement[] } {
  const fresh = ACHIEVEMENTS.filter((a) => !p.achievements[a.id] && a.test(p))
  if (!fresh.length) return { next: p, fresh }
  const achievements = { ...p.achievements }
  for (const a of fresh) achievements[a.id] = Date.now()
  return { next: { ...p, achievements }, fresh }
}

const persist = (p: Profile) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode */
  }
}

const profileOf = (s: ProfileState): Profile => {
  const { recordCompletion: _a, recordSort: _b, recordCombo: _c, streak: _d, ...p } = s
  return p
}

export const useProfile = create<ProfileState>((set, get) => {
  const apply = (mut: (p: Profile) => Profile): Achievement[] => {
    const { next, fresh } = unlock(mut(profileOf(get())))
    persist(next)
    set(next)
    return fresh
  }
  return {
    ...load(),
    recordCompletion(e) {
      return apply((p) => {
        const art = catalogById(e.imageId)
        const daily = dailyPuzzle()
        let d = p.daily
        if (e.imageId === daily.art.id && e.cols === daily.cols && e.rows === daily.rows && d.last !== daily.key) {
          const streak = d.last === yesterday() ? d.streak + 1 : 1
          d = { last: daily.key, streak, best: Math.max(d.best, streak) }
        }
        return {
          ...p,
          completed: p.completed + 1,
          piecesPlaced: p.piecesPlaced + e.total,
          playMs: p.playMs + e.elapsedMs,
          biggest: Math.max(p.biggest, e.total),
          fastest100: e.total >= 100 ? Math.min(p.fastest100 ?? Infinity, e.elapsedMs) : p.fastest100,
          bestCombo: Math.max(p.bestCombo, e.bestCombo),
          hintsUsed: p.hintsUsed + e.hints,
          artworks: art && !p.artworks.includes(art.id) ? [...p.artworks, art.id] : p.artworks,
          categories: art && !p.categories.includes(art.category) ? [...p.categories, art.category] : p.categories,
          noHintBig: e.hints === 0 && e.total >= 300 ? p.noHintBig + 1 : p.noHintBig,
          daily: d,
        }
      })
    },
    recordSort(kind) {
      if (get().sorted.includes(kind)) return []
      return apply((p) => ({ ...p, sorted: [...p.sorted, kind] }))
    },
    recordCombo(n) {
      if (n <= get().bestCombo) return []
      return apply((p) => ({ ...p, bestCombo: n }))
    },
    streak() {
      const d = get().daily
      return d.last === dayKey() || d.last === yesterday() ? d.streak : 0
    },
  }
})

export const isDailyDone = (p: Profile) => p.daily.last === dayKey()
