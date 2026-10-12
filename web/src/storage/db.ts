import { createStore, del, get, getMany, keys, set } from 'idb-keyval'
import type { SaveV2 } from '../engine/types'

const store = createStore('pieceful', 'kv')
const defined = <T,>(x: T | undefined): x is T => x !== undefined && x !== null

export interface UserImage {
  id: string
  title: string
  width: number
  height: number
  createdAt: number
  blob: Blob
  thumb: Blob
}

export interface SaveSummary {
  id: string
  imageId: string
  cols: number
  rows: number
  placed: number
  total: number
  elapsedMs: number
  updatedAt: number
}

export interface DoneRecord {
  id: string
  bestMs: number
  count: number
}

export const saveId = (imageId: string, cols: number, rows: number) => `${imageId}|${cols}x${rows}`

/** v1 → v2: drop old-format saves and records of the removed built-in scenes; keep user photos. */
let migrated: Promise<void> | null = null
export function migrate(): Promise<void> {
  migrated ??= (async () => {
    if ((await get<number>('meta:schema', store)) === 2) return
    const ks = (await keys(store)) as string[]
    const saves = ks.filter((k) => k.startsWith('save:'))
    const vals = await getMany<{ v?: number }>(saves, store)
    const drop = saves.filter((_, i) => vals[i]?.v !== 2).concat(ks.filter((k) => k.startsWith('done:builtin:')))
    await Promise.all(drop.map((k) => del(k, store)))
    await set('meta:schema', 2, store)
  })()
  return migrated
}

// ---------- saves ----------

export async function getSave(id: string): Promise<SaveV2 | undefined> {
  await migrate()
  const s = await get<SaveV2>('save:' + id, store)
  return s && s.v === 2 ? s : undefined
}

export const putSave = (s: SaveV2) => set('save:' + s.id, s, store)
export const deleteSave = (id: string) => del('save:' + id, store)

export async function listSaves(): Promise<SaveSummary[]> {
  await migrate()
  const ks = ((await keys(store)) as string[]).filter((k) => k.startsWith('save:'))
  const saves = (await getMany<SaveV2>(ks, store)).filter(defined).filter((s) => s.v === 2 && !s.completed)
  return saves
    .map((s) => ({
      id: s.id,
      imageId: s.imageId,
      cols: s.cols,
      rows: s.rows,
      placed: s.placed,
      total: s.n,
      elapsedMs: s.elapsedMs,
      updatedAt: s.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------- completions ----------

export async function recordDone(id: string, ms: number): Promise<DoneRecord> {
  const prev = await get<DoneRecord>('done:' + id, store)
  const rec = { id, bestMs: prev ? Math.min(prev.bestMs, ms) : ms, count: (prev?.count ?? 0) + 1 }
  await set('done:' + id, rec, store)
  return rec
}

export async function listDone(): Promise<DoneRecord[]> {
  await migrate()
  const ks = ((await keys(store)) as string[]).filter((k) => k.startsWith('done:'))
  return (await getMany<DoneRecord>(ks, store)).filter(defined)
}

// ---------- user images ----------

export const getImage = (id: string) => get<UserImage>('img:' + id, store)
export const putImage = (img: UserImage) => set('img:' + img.id, img, store)

export async function deleteImage(id: string) {
  const imageId = 'user:' + id
  const ks = ((await keys(store)) as string[]).filter(
    (k) => k === 'img:' + id || ((k.startsWith('save:') || k.startsWith('done:')) && k.includes(imageId + '|')),
  )
  await Promise.all(ks.map((k) => del(k, store)))
}

export async function listImages(): Promise<UserImage[]> {
  const ks = ((await keys(store)) as string[]).filter((k) => k.startsWith('img:'))
  const imgs = (await getMany<UserImage>(ks, store)).filter(defined)
  return imgs.sort((a, b) => b.createdAt - a.createdAt)
}
