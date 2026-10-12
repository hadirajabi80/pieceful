import { mulberry32, range } from './rng'
import type { Edge, Edges, Grid, PathCmd, Vec } from './types'

/** Edge id used for board-border (flat) edges. */
export const BORDER_EDGE = 0xffff

/** Tab size and jitter, as fractions of the smaller cell side. */
const T = 0.1
const J = 0.04

/** Max perpendicular reach of a tab, as a fraction of the smaller cell side. */
export const TAB_REACH = 3 * T + J

export function margin(cw: number, ch: number): number {
  return Math.ceil(TAB_REACH * Math.min(cw, ch)) + 2
}

/** Generates every interior edge, deterministically from `seed`. */
export function generateEdges(seed: number, cols: number, rows: number): Edges {
  const rand = mulberry32(seed)
  const line = (n: number): Edge[] => {
    const out: Edge[] = []
    let prev: Edge | null = null
    for (let k = 0; k < n; k++) {
      const flip: 1 | -1 = rand() < 0.5 ? 1 : -1
      // Keep the curve smooth across segment joints: the first control point mirrors the
      // previous segment's last one (in real, unflipped space).
      const a = prev ? -prev.e * prev.flip * flip : range(rand, -J, J)
      const e: Edge = { flip, a, b: range(rand, -J, J), c: range(rand, -J, J), d: range(rand, -J, J), e: range(rand, -J, J) }
      out.push(e)
      prev = e
    }
    return out
  }
  const h: Edge[][] = []
  for (let r = 1; r < rows; r++) h[r] = line(cols)
  const v: Edge[][] = []
  for (let c = 1; c < cols; c++) v[c] = line(rows)
  return { h, v }
}

/** Canonical control points (u along edge 0..1, v perpendicular before flip). */
function edgePoints(e: Edge): [number, number][] {
  const { a, b, c, d } = e
  return [
    [0, 0],
    [0.2, a],
    [0.5 + b + d, -T + c],
    [0.5 - T + b, T + c],
    [0.5 - 2 * T + b - d, 3 * T + c],
    [0.5 + 2 * T + b - d, 3 * T + c],
    [0.5 + T + b, T + c],
    [0.5 + b + d, -T + c],
    [0.8, e.e],
    [1, 0],
  ]
}

/**
 * Appends the bezier commands of an edge (excluding the initial point) to `out`.
 * `from`/`to` are in canonical direction; `reversed` traverses to→from.
 */
function pushEdge(out: PathCmd[], e: Edge, from: Vec, to: Vec, normal: Vec, L: number, reversed: boolean) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const map = ([u, v]: [number, number]): [number, number] => {
    const pv = v * e.flip * L
    return [from.x + u * dx + pv * normal.x, from.y + u * dy + pv * normal.y]
  }
  const p = edgePoints(e).map(map)
  if (!reversed) {
    out.push(['C', ...p[1], ...p[2], ...p[3]])
    out.push(['C', ...p[4], ...p[5], ...p[6]])
    out.push(['C', ...p[7], ...p[8], ...p[9]])
  } else {
    out.push(['C', ...p[8], ...p[7], ...p[6]])
    out.push(['C', ...p[5], ...p[4], ...p[3]])
    out.push(['C', ...p[2], ...p[1], ...p[0]])
  }
}

/** Outline of piece i in bitmap-local coords (cell top-left at (m, m)), clockwise. */
export function pieceOutline(i: number, grid: Grid, edges: Edges): PathCmd[] {
  const { cols, rows, cw, ch, m } = grid
  const col = i % cols
  const row = (i / cols) | 0
  const L = Math.min(cw, ch)
  const tl = { x: m, y: m }
  const tr = { x: m + cw, y: m }
  const br = { x: m + cw, y: m + ch }
  const bl = { x: m, y: m + ch }
  const down = { x: 0, y: 1 }
  const right = { x: 1, y: 0 }
  const out: PathCmd[] = [['M', tl.x, tl.y]]

  if (row === 0) out.push(['L', tr.x, tr.y])
  else pushEdge(out, edges.h[row][col], tl, tr, down, L, false)

  if (col === cols - 1) out.push(['L', br.x, br.y])
  else pushEdge(out, edges.v[col + 1][row], tr, br, right, L, false)

  if (row === rows - 1) out.push(['L', bl.x, bl.y])
  else pushEdge(out, edges.h[row + 1][col], bl, br, down, L, true)

  if (col === 0) out.push(['L', tl.x, tl.y])
  else pushEdge(out, edges.v[col][row], tl, bl, right, L, true)

  return out
}

export function toSvgPath(cmds: PathCmd[]): string {
  return cmds.map(([k, ...n]) => k + n.map((x) => +x.toFixed(2)).join(' ')).join('') + 'Z'
}

export function toPath2D(cmds: PathCmd[]): Path2D {
  const p = new Path2D()
  for (const c of cmds) {
    if (c[0] === 'M') p.moveTo(c[1], c[2])
    else if (c[0] === 'L') p.lineTo(c[1], c[2])
    else p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6])
  }
  p.closePath()
  return p
}

export function isEdgePiece(i: number, cols: number, rows: number): boolean {
  const col = i % cols
  const row = (i / cols) | 0
  return row === 0 || col === 0 || row === rows - 1 || col === cols - 1
}

// ---------- shared, flattened edge geometry (used by the geometry worker and hit testing) ----------

export const edgeCount = (cols: number, rows: number) => (rows - 1) * cols + (cols - 1) * rows

/** Horizontal edge on top of row r (r in 1..rows-1), column c. */
export const hEdgeId = (r: number, c: number, cols: number) => (r - 1) * cols + c

/** Vertical edge left of column c (c in 1..cols-1), row r. */
export const vEdgeId = (c: number, r: number, cols: number, rows: number) => (rows - 1) * cols + (c - 1) * rows + r

/** Id of the edge shared by neighbouring pieces p and q (q = p+1 or p+cols). */
export function edgeBetween(p: number, q: number, cols: number, rows: number): number {
  const a = Math.min(p, q)
  const b = Math.max(p, q)
  const col = a % cols
  const row = (a / cols) | 0
  return b === a + 1 ? vEdgeId(col + 1, row, cols, rows) : hEdgeId(row + 1, col, cols)
}

/** Samples per cubic segment for a given cell size. */
export const samplesPerCubic = (L: number, mobile = false) =>
  mobile ? Math.min(12, Math.max(5, Math.ceil(L / 9))) : Math.min(18, Math.max(8, Math.ceil(L / 6)))

/**
 * Flattens an interior edge into a board-space polyline (canonical direction, 3n+1 points as x,y pairs).
 * Computed once per edge so both neighbouring pieces share bit-identical vertices.
 */
export function flattenEdge(e: Edge, from: Vec, to: Vec, normal: Vec, L: number, n: number): Float64Array {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const p = edgePoints(e).map(([u, v]) => {
    const pv = v * e.flip * L
    return [from.x + u * dx + pv * normal.x, from.y + u * dy + pv * normal.y]
  })
  const out = new Float64Array((3 * n + 1) * 2)
  out[0] = p[0][0]
  out[1] = p[0][1]
  let k = 2
  for (let seg = 0; seg < 3; seg++) {
    const [a, b, c, d] = [p[seg * 3], p[seg * 3 + 1], p[seg * 3 + 2], p[seg * 3 + 3]]
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const mt = 1 - t
      const w0 = mt * mt * mt
      const w1 = 3 * mt * mt * t
      const w2 = 3 * mt * t * t
      const w3 = t * t * t
      out[k++] = w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0]
      out[k++] = w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]
    }
  }
  // Pin the exact endpoints (grid corners) so all pieces meet at integer corners.
  out[0] = from.x
  out[1] = from.y
  out[out.length - 2] = to.x
  out[out.length - 1] = to.y
  return out
}
