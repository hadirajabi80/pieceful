import { edgeBetween, edgeCount, isEdgePiece } from './shapes'
import type { Grid, Rect, SaveV2, Vec } from './types'

export interface SnapCandidate {
  kind: 'board' | 'group'
  /** group id to merge with (kind = 'group') */
  target: number
  d: number
  /** exact origin the dropped group should land on */
  x: number
  y: number
}

export interface DropResult {
  /** surviving group id containing the dropped pieces */
  group: number
  merged: boolean
  locked: boolean
  completed: boolean
  /** origin of the dropped group before snapping */
  start: Vec
  /** set when a fully assembled group was auto-locked from far away */
  lockFrom?: Vec
  /** pieces whose group id changed: [piece, newGroup] pairs flattened */
  relabeled: number[]
  /** edge ids that became internal seams */
  joined: number[]
}

/** Pieces stay hit-testable via their outline polygons (piece-local, relative to the cell's top-left). */
export interface Outlines {
  pts: Float32Array
  start: Uint32Array
}

/**
 * Puzzle rules with a structure-of-arrays layout that scales to thousands of pieces.
 *
 * Group ids are piece ids (the id of one member, the "head"). A piece's world position is
 * `origin[group] + cell(piece)`; grouped pieces are always correctly placed relative to each
 * other, so a group is solved iff its origin is exactly (0, 0).
 */
export class Puzzle {
  readonly n: number
  readonly edgeCount: number
  pieceGroup: Int32Array
  members = new Map<number, number[]>()
  ox: Float64Array
  oy: Float64Array
  z: Uint32Array
  bbox: Int32Array
  hasEdge: Uint8Array
  edgeJoined: Uint8Array
  loose = new Set<number>()
  boardGroup = -1
  zCounter = 0
  placed = 0
  moves = 0
  completed = false

  constructor(
    readonly grid: Grid,
    private outlines: Outlines | null = null,
  ) {
    const n = (this.n = grid.cols * grid.rows)
    this.edgeCount = edgeCount(grid.cols, grid.rows)
    this.pieceGroup = new Int32Array(n)
    this.ox = new Float64Array(n)
    this.oy = new Float64Array(n)
    this.z = new Uint32Array(n)
    this.bbox = new Int32Array(4 * n)
    this.hasEdge = new Uint8Array(n)
    this.edgeJoined = new Uint8Array(this.edgeCount)
    for (let i = 0; i < n; i++) {
      this.pieceGroup[i] = i
      this.members.set(i, [i])
      this.z[i] = ++this.zCounter
      this.setBboxFor(i, [i])
      this.hasEdge[i] = isEdgePiece(i, grid.cols, grid.rows) ? 1 : 0
      this.loose.add(i)
    }
  }

  setOutlines(o: Outlines) {
    this.outlines = o
  }

  // ---------- geometry helpers ----------

  cellX(i: number) {
    return (i % this.grid.cols) * this.grid.cw
  }

  cellY(i: number) {
    return ((i / this.grid.cols) | 0) * this.grid.ch
  }

  private setBboxFor(g: number, pieces: number[]) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of pieces) {
      const x = this.cellX(p)
      const y = this.cellY(p)
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x + this.grid.cw > x1) x1 = x + this.grid.cw
      if (y + this.grid.ch > y1) y1 = y + this.grid.ch
    }
    this.bbox.set([x0, y0, x1, y1], g * 4)
  }

  /** World bbox of a group's cells (tabs excluded). */
  worldBbox(g: number): Rect {
    const b = g * 4
    return { x0: this.ox[g] + this.bbox[b], y0: this.oy[g] + this.bbox[b + 1], x1: this.ox[g] + this.bbox[b + 2], y1: this.oy[g] + this.bbox[b + 3] }
  }

  size(g: number) {
    return this.members.get(g)?.length ?? 0
  }

  isLocked(g: number) {
    return g === this.boardGroup
  }

  neighbors(i: number, out: number[]): number[] {
    const { cols, rows } = this.grid
    const col = i % cols
    const row = (i / cols) | 0
    out.length = 0
    if (col > 0) out.push(i - 1)
    if (col < cols - 1) out.push(i + 1)
    if (row > 0) out.push(i - cols)
    if (row < rows - 1) out.push(i + cols)
    return out
  }

  // ---------- hit testing ----------

  /** Topmost loose group under a world point. `pickable` filters out dimmed/hidden groups. */
  hitTest(p: Vec, pickable: (g: number) => boolean = () => true): number {
    const { cols, rows, cw, ch, m } = this.grid
    let best = -1
    let bestZ = -1
    for (const g of this.loose) {
      if (this.z[g] <= bestZ) continue
      const lx = p.x - this.ox[g]
      const ly = p.y - this.oy[g]
      const b = g * 4
      if (lx < this.bbox[b] - m || lx > this.bbox[b + 2] + m || ly < this.bbox[b + 1] - m || ly > this.bbox[b + 3] + m) continue
      if (!pickable(g)) continue
      const col = Math.floor(lx / cw)
      const row = Math.floor(ly / ch)
      for (let k = 0; k < 5; k++) {
        const c = col + (k === 1 ? 1 : k === 2 ? -1 : 0)
        const r = row + (k === 3 ? 1 : k === 4 ? -1 : 0)
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue
        const i = r * cols + c
        if (this.pieceGroup[i] !== g) continue
        if (this.pointInPiece(i, lx - c * cw, ly - r * ch)) {
          best = g
          bestZ = this.z[g]
          break
        }
      }
    }
    return best
  }

  private pointInPiece(i: number, x: number, y: number): boolean {
    if (!this.outlines) return x >= 0 && y >= 0 && x <= this.grid.cw && y <= this.grid.ch
    const { pts, start } = this.outlines
    let inside = false
    const a = start[i]
    const b = start[i + 1]
    for (let k = a, j = b - 1; k < b; j = k++) {
      const xi = pts[k * 2]
      const yi = pts[k * 2 + 1]
      const xj = pts[j * 2]
      const yj = pts[j * 2 + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  // ---------- z-order ----------

  bringToFront(g: number) {
    this.z[g] = ++this.zCounter
  }

  /** Called by the renderer owner when z values approach the depth range limit. */
  renumberZ(): number[] {
    const ids = [...this.loose].sort((a, b) => this.z[a] - this.z[b])
    ids.forEach((g, k) => (this.z[g] = k + 1))
    this.zCounter = ids.length
    return ids
  }

  // ---------- snapping ----------

  /** Generous but never ambiguous: neighbouring cells are a full cell apart. */
  tolerance(scale: number): number {
    const L = Math.min(this.grid.cw, this.grid.ch)
    return Math.min(Math.max(0.28 * L, 18 / scale), 0.45 * L)
  }

  /** Closest snap target for a loose group, or null if none within tolerance. */
  bestSnap(g: number, scale: number): SnapCandidate | null {
    const tol = this.tolerance(scale)
    const gx = this.ox[g]
    const gy = this.oy[g]
    let best: SnapCandidate | null = null
    const dBoard = Math.hypot(gx, gy)
    if (dBoard <= tol) best = { kind: 'board', target: this.boardGroup, d: dBoard, x: 0, y: 0 }
    const nb: number[] = []
    const seen = new Set<number>()
    for (const p of this.members.get(g)!) {
      for (const q of this.neighbors(p, nb)) {
        const h = this.pieceGroup[q]
        if (h === g || seen.has(h) || h === this.boardGroup) continue
        seen.add(h)
        const d = Math.hypot(this.ox[h] - gx, this.oy[h] - gy)
        if (d <= tol && (!best || d < best.d)) best = { kind: 'group', target: h, d, x: this.ox[h], y: this.oy[h] }
      }
    }
    return best
  }

  /**
   * Finishes a drag: applies the closest snap (board or neighbour), then cascades — a piece
   * dropped into a gap joins every touching neighbour at once.
   */
  drop(g: number, from: Vec, scale: number): DropResult {
    const start = { x: this.ox[g], y: this.oy[g] }
    if (Math.hypot(start.x - from.x, start.y - from.y) > 0.5) this.moves++
    const res: DropResult = { group: g, merged: false, locked: false, completed: false, start, relabeled: [], joined: [] }

    // Loose drops land on quarter pixels so float32 storage is exact (no shimmer).
    this.ox[g] = Math.round(this.ox[g] * 4) / 4
    this.oy[g] = Math.round(this.oy[g] * 4) / 4

    for (let guard = 0; guard < 64; guard++) {
      const c = this.bestSnap(g, scale)
      if (!c) break
      if (c.kind === 'board') {
        g = this.lock(g, res)
        res.locked = true
        break
      }
      // The first snap moves the dropped group onto its target. In a cascade the dropped
      // group is already anchored, so the larger side stays put and the smaller one comes to it.
      if (!res.merged || this.size(c.target) > this.size(g)) g = this.merge(g, c.target, res)
      else g = this.merge(c.target, g, res)
      res.merged = true
    }
    if (!res.locked && this.size(g) === this.n) {
      res.lockFrom = { x: this.ox[g], y: this.oy[g] }
      g = this.lock(g, res)
      res.locked = true
    }
    res.group = g
    return res
  }

  /** Merges g into h's position (h is stationary). Union by size; returns the surviving id. */
  merge(g: number, h: number, res?: DropResult): number {
    const mg = this.members.get(g)!
    const mh = this.members.get(h)!
    const s = mg.length >= mh.length ? g : h
    const o = s === g ? h : g
    const ms = this.members.get(s)!
    const mo = this.members.get(o)!
    const { cols, rows } = this.grid
    const nb: number[] = []
    for (const p of mo) {
      for (const q of this.neighbors(p, nb)) {
        if (this.pieceGroup[q] === s) {
          const e = edgeBetween(p, q, cols, rows)
          if (!this.edgeJoined[e]) {
            this.edgeJoined[e] = 1
            res?.joined.push(e)
          }
        }
      }
    }
    for (const p of mo) {
      this.pieceGroup[p] = s
      res?.relabeled.push(p, s)
    }
    for (const p of mo) ms.push(p)
    this.members.delete(o)
    // Adopt the stationary group's origin exactly (no arithmetic → bit-identical).
    this.ox[s] = this.ox[h]
    this.oy[s] = this.oy[h]
    const bs = s * 4
    const bo = o * 4
    this.bbox[bs] = Math.min(this.bbox[bs], this.bbox[bo])
    this.bbox[bs + 1] = Math.min(this.bbox[bs + 1], this.bbox[bo + 1])
    this.bbox[bs + 2] = Math.max(this.bbox[bs + 2], this.bbox[bo + 2])
    this.bbox[bs + 3] = Math.max(this.bbox[bs + 3], this.bbox[bo + 3])
    this.hasEdge[s] |= this.hasEdge[o]
    this.loose.delete(o)
    if (o === this.boardGroup || s === this.boardGroup) {
      this.boardGroup = s
      this.loose.delete(s)
      this.z[s] = 0
    } else {
      this.z[s] = ++this.zCounter
    }
    return s
  }

  /** Puts a group on the board (merging it into the board group). Returns the board group id. */
  private lock(g: number, res: DropResult): number {
    this.ox[g] = 0
    this.oy[g] = 0
    let s: number
    if (this.boardGroup < 0) {
      this.boardGroup = g
      this.loose.delete(g)
      this.z[g] = 0
      s = g
    } else {
      s = this.merge(g, this.boardGroup, res)
    }
    this.placed = this.size(s)
    if (this.placed === this.n && !this.completed) {
      this.completed = true
      res.completed = true
    }
    return s
  }

  // ---------- persistence ----------

  serialize(): Pick<SaveV2, 'pieceGroup' | 'origin' | 'z' | 'boardGroup' | 'zCounter' | 'placed' | 'moves' | 'completed'> {
    const origin = new Float32Array(this.n * 2)
    for (let i = 0; i < this.n; i++) {
      origin[i * 2] = this.ox[i]
      origin[i * 2 + 1] = this.oy[i]
    }
    return {
      pieceGroup: this.pieceGroup.slice().buffer,
      origin: origin.buffer,
      z: this.z.slice().buffer,
      boardGroup: this.boardGroup,
      zCounter: this.zCounter,
      placed: this.placed,
      moves: this.moves,
      completed: this.completed,
    }
  }

  restore(s: Pick<SaveV2, 'pieceGroup' | 'origin' | 'z' | 'boardGroup' | 'zCounter' | 'moves'>) {
    const pg = new Int32Array(s.pieceGroup)
    const origin = new Float32Array(s.origin)
    const z = new Uint32Array(s.z)
    if (pg.length !== this.n || origin.length !== this.n * 2 || z.length !== this.n) throw new Error('save does not match puzzle size')
    this.pieceGroup.set(pg)
    this.z.set(z)
    this.members.clear()
    this.loose.clear()
    for (let i = 0; i < this.n; i++) {
      const g = pg[i]
      let list = this.members.get(g)
      if (!list) this.members.set(g, (list = []))
      list.push(i)
    }
    for (const [g, list] of this.members) {
      this.ox[g] = origin[g * 2]
      this.oy[g] = origin[g * 2 + 1]
      this.setBboxFor(g, list)
      this.hasEdge[g] = list.some((p) => isEdgePiece(p, this.grid.cols, this.grid.rows)) ? 1 : 0
    }
    this.boardGroup = s.boardGroup >= 0 && this.members.has(s.boardGroup) ? s.boardGroup : -1
    for (const g of this.members.keys()) if (g !== this.boardGroup) this.loose.add(g)
    this.edgeJoined.fill(0)
    const { cols, rows } = this.grid
    for (let i = 0; i < this.n; i++) {
      if ((i % cols) < cols - 1 && pg[i] === pg[i + 1]) this.edgeJoined[edgeBetween(i, i + 1, cols, rows)] = 1
      if (i + cols < this.n && pg[i] === pg[i + cols]) this.edgeJoined[edgeBetween(i, i + cols, cols, rows)] = 1
    }
    this.zCounter = Math.max(s.zCounter, ...[...this.loose].map((g) => this.z[g]), 0)
    this.moves = s.moves
    this.placed = this.boardGroup >= 0 ? this.size(this.boardGroup) : 0
    this.completed = this.placed === this.n
  }
}
