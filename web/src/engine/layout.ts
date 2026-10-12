import { margin } from './shapes'
import { shuffle } from './rng'
import type { Grid, Rect, Vec } from './types'

/** Piece-count presets offered in the setup sheet. */
export const PIECE_COUNTS = [100, 300, 500, 1000, 2000, 3000, 5000]
export const MIN_PIECES = 50
export const MAX_PIECES = 5000

/** Picks a cols x rows grid close to `n` pieces with roughly square cells. */
export function chooseGrid(n: number, aspect: number): { cols: number; rows: number; count: number } {
  let best = { cols: 2, rows: 2, count: 4 }
  let bestScore = Infinity
  for (let rows = 2; rows <= n; rows++) {
    const cols = Math.max(2, Math.round(n / rows))
    // Prefer the exact count, then cells close to square.
    const cellAspect = aspect * (rows / cols)
    const score = (Math.abs(cols * rows - n) / n) * 3 + Math.abs(Math.log(cellAspect))
    if (score < bestScore) {
      bestScore = score
      best = { cols, rows, count: cols * rows }
    }
    if (cols === 2) break
  }
  return best
}

/** Board grid for a source image. Board size is snapped so cells are whole pixels. */
export function makeGrid(cols: number, rows: number, srcW: number, srcH: number): Grid {
  const cw = Math.max(8, Math.round(srcW / cols))
  const ch = Math.max(8, Math.round(srcH / rows))
  return { cols, rows, cw, ch, W: cols * cw, H: rows * ch, m: margin(cw, ch) }
}

// ---------- arranging groups on the table ----------

/** A loose group to place: its cell bbox in group-local coordinates. */
export interface LayoutItem {
  id: number
  bx0: number
  by0: number
  bx1: number
  by1: number
}

export type Placement = Map<number, Vec>

const itemW = (it: LayoutItem, tab: number) => it.bx1 - it.bx0 + 2 * tab
const itemH = (it: LayoutItem, tab: number) => it.by1 - it.by0 + 2 * tab

/**
 * Shelf packing into a region, left→right then top→bottom. Items that don't fit vertically
 * are returned in `rest`. Positions are group origins.
 */
export function packShelves(items: LayoutItem[], region: Rect, gap: number, tab: number, out: Placement): LayoutItem[] {
  let x = region.x0
  let y = region.y0
  let shelf = 0
  const rest: LayoutItem[] = []
  for (const it of items) {
    const w = itemW(it, tab)
    const h = itemH(it, tab)
    if (x + w > region.x1 && x > region.x0) {
      x = region.x0
      y += shelf + gap
      shelf = 0
    }
    if (y + h > region.y1 || w > region.x1 - region.x0) {
      rest.push(it)
      continue
    }
    out.set(it.id, { x: x + tab - it.bx0, y: y + tab - it.by0 })
    x += w + gap
    shelf = Math.max(shelf, h)
  }
  return rest
}

/** The four bands around `inner` at a given depth (top/bottom span the corners). */
function bands(inner: Rect, gap: number, depth: number, portrait: boolean): Rect[] {
  const top = { x0: inner.x0 - gap - depth, y0: inner.y0 - gap - depth, x1: inner.x1 + gap + depth, y1: inner.y0 - gap }
  const bottom = { x0: inner.x0 - gap - depth, y0: inner.y1 + gap, x1: inner.x1 + gap + depth, y1: inner.y1 + gap + depth }
  const left = { x0: inner.x0 - gap - depth, y0: inner.y0 - gap, x1: inner.x0 - gap, y1: inner.y1 + gap }
  const right = { x0: inner.x1 + gap, y0: inner.y0 - gap, x1: inner.x1 + gap + depth, y1: inner.y1 + gap }
  return portrait ? [top, bottom, left, right] : [left, right, top, bottom]
}

/**
 * Fills bands around `inner` (never covering it), growing the band depth until everything fits.
 * Returns the outer rect actually used.
 */
export function fillBands(items: LayoutItem[], inner: Rect, gap: number, tab: number, portrait: boolean, out: Placement): Rect {
  if (!items.length) return inner
  let area = 0
  let maxSide = 0
  for (const it of items) {
    const w = itemW(it, tab) + gap
    const h = itemH(it, tab) + gap
    area += w * h
    maxSide = Math.max(maxSide, w, h)
  }
  const S = inner.x1 - inner.x0 + inner.y1 - inner.y0 + 4 * gap
  let depth = Math.max(maxSide, (-2 * S + Math.sqrt(4 * S * S + 16 * area * 1.2)) / 8)
  for (let iter = 0; iter < 200; iter++) {
    const trial: Placement = new Map()
    let rest = items
    for (const b of bands(inner, gap, depth, portrait)) rest = packShelves(rest, b, gap, tab, trial)
    if (!rest.length) {
      for (const [k, v] of trial) out.set(k, v)
      return { x0: inner.x0 - gap - depth, y0: inner.y0 - gap - depth, x1: inner.x1 + gap + depth, y1: inner.y1 + gap + depth }
    }
    depth += maxSide * 0.5
  }
  return inner
}

export interface LayoutCtx {
  grid: Grid
  portrait: boolean
  rand: () => number
}

const tabOf = (g: Grid) => g.m - 2
const gapOf = (g: Grid) => Math.round(Math.min(g.cw, g.ch) * 0.22)
const boardRect = (g: Grid): Rect => ({ x0: 0, y0: 0, x1: g.W, y1: g.H })

/** Neat grid around the board, multi-piece groups nearest the board. */
export function tidyLayout(items: LayoutItem[], c: LayoutCtx): Placement {
  const out: Placement = new Map()
  const sorted = [...items].sort((a, b) => b.by1 - b.by0 - (a.by1 - a.by0) || b.bx1 - b.bx0 - (a.bx1 - a.bx0))
  fillBands(sorted, boardRect(c.grid), gapOf(c.grid), tabOf(c.grid), c.portrait, out)
  return out
}

/** Random order, slight jitter — a fresh, un-sorted table that still never overlaps. */
export function scatterLayout(items: LayoutItem[], c: LayoutCtx): Placement {
  const out: Placement = new Map()
  const gap = gapOf(c.grid)
  fillBands(shuffle([...items], c.rand), boardRect(c.grid), gap * 1.6, tabOf(c.grid), c.portrait, out)
  for (const v of out.values()) {
    v.x += (c.rand() - 0.5) * gap
    v.y += (c.rand() - 0.5) * gap
  }
  return out
}

/** Edge pieces in a ring hugging the board, interior pieces outside the ring. */
export function edgesOutLayout(items: LayoutItem[], isEdge: (id: number) => boolean, c: LayoutCtx): Placement {
  const out: Placement = new Map()
  const edge = shuffle(items.filter((it) => isEdge(it.id)), c.rand)
  const inner = shuffle(items.filter((it) => !isEdge(it.id)), c.rand)
  const gap = gapOf(c.grid)
  const ring = fillBands(edge, boardRect(c.grid), gap, tabOf(c.grid), c.portrait, out)
  fillBands(inner, ring, gap * 3, tabOf(c.grid), c.portrait, out)
  return out
}

export interface Zone {
  cls: number
  rect: Rect
  color: [number, number, number]
  count: number
}

/** Each colour class packed into its own zone; zones arranged around the board. */
export function colorZonesLayout(
  items: LayoutItem[],
  classOf: (id: number) => number,
  lightness: (id: number) => number,
  colors: [number, number, number][],
  pieceCount: (id: number) => number,
  c: LayoutCtx,
): { placement: Placement; zones: Zone[] } {
  const tab = tabOf(c.grid)
  const gap = gapOf(c.grid)
  const byCls = new Map<number, LayoutItem[]>()
  for (const it of items) {
    const k = classOf(it.id)
    if (!byCls.has(k)) byCls.set(k, [])
    byCls.get(k)!.push(it)
  }
  // Pack each class into a near-square zone at the origin, then place zones as big items.
  const local = new Map<number, Placement>()
  const zoneItems: LayoutItem[] = []
  for (const [k, list] of byCls) {
    list.sort((a, b) => lightness(b.id) - lightness(a.id))
    let area = 0
    for (const it of list) area += (itemW(it, tab) + gap) * (itemH(it, tab) + gap)
    const maxW = Math.max(...list.map((it) => itemW(it, tab)))
    const w = Math.max(maxW, Math.sqrt(area) * 1.15)
    const p: Placement = new Map()
    packShelves(list, { x0: 0, y0: 0, x1: w, y1: Infinity }, gap, tab, p)
    let x1 = 0
    let y1 = 0
    for (const it of list) {
      const o = p.get(it.id)!
      x1 = Math.max(x1, o.x + it.bx1 + tab)
      y1 = Math.max(y1, o.y + it.by1 + tab)
    }
    local.set(k, p)
    zoneItems.push({ id: k, bx0: 0, by0: 0, bx1: x1, by1: y1 })
  }
  const zonePos: Placement = new Map()
  fillBands(zoneItems, boardRect(c.grid), gap * 4, 0, c.portrait, zonePos)
  const placement: Placement = new Map()
  const zones: Zone[] = []
  for (const z of zoneItems) {
    const at = zonePos.get(z.id) ?? { x: 0, y: -z.by1 - gap * 4 }
    for (const [id, v] of local.get(z.id)!) placement.set(id, { x: v.x + at.x, y: v.y + at.y })
    const list = byCls.get(z.id)!
    zones.push({
      cls: z.id,
      rect: { x0: at.x, y0: at.y, x1: at.x + z.bx1, y1: at.y + z.by1 },
      color: colors[z.id] ?? [128, 128, 128],
      count: list.reduce((s, it) => s + pieceCount(it.id), 0),
    })
  }
  zones.sort((a, b) => a.cls - b.cls)
  return { placement, zones }
}

/** Packs the given groups tightly around a point. */
export function gatherLayout(items: LayoutItem[], at: Vec, c: LayoutCtx): Placement {
  const tab = tabOf(c.grid)
  const gap = Math.round(gapOf(c.grid) * 0.5)
  let area = 0
  for (const it of items) area += (itemW(it, tab) + gap) * (itemH(it, tab) + gap)
  const maxW = Math.max(...items.map((it) => itemW(it, tab)))
  const w = Math.max(maxW, Math.sqrt(area) * 1.3)
  const h = area / w
  const out: Placement = new Map()
  packShelves(items, { x0: at.x - w / 2, y0: at.y - h / 2, x1: at.x + w / 2, y1: Infinity }, gap, tab, out)
  return out
}
