import earcut from 'earcut'
import { BORDER_EDGE, edgeCount, flattenEdge, generateEdges, hEdgeId, samplesPerCubic, vEdgeId } from './shapes'
import type { GeometryBuffers } from './types'

export interface CutParams {
  seed: number
  cols: number
  rows: number
  cw: number
  ch: number
  mobile: boolean
  /** small RGBA image of the board at cols*4 x rows*4 for per-piece colours */
  colors?: { data: Uint8ClampedArray; w: number; h: number }
}

export const FILL_STRIDE = 12
export const STRIP_STRIDE = 24

/**
 * Builds all static geometry for a puzzle: triangulated piece fills, bevel strips,
 * hit-test outlines and per-piece colours. Pure (no DOM) so it runs in a worker and in tests.
 */
export function buildGeometry(p: CutParams, onProgress?: (done: number, total: number) => void): GeometryBuffers {
  const t0 = performance.now()
  const { cols, rows, cw, ch, seed } = p
  const n = cols * rows
  const L = Math.min(cw, ch)
  const ns = samplesPerCubic(L, p.mobile)
  const edges = generateEdges(seed, cols, rows)
  const ec = edgeCount(cols, rows)

  // 1. Flatten each interior edge once (board space, canonical direction).
  const edgePts: Float64Array[] = new Array(ec)
  for (let r = 1; r < rows; r++)
    for (let c = 0; c < cols; c++)
      edgePts[hEdgeId(r, c, cols)] = flattenEdge(edges.h[r][c], { x: c * cw, y: r * ch }, { x: (c + 1) * cw, y: r * ch }, { x: 0, y: 1 }, L, ns)
  for (let c = 1; c < cols; c++)
    for (let r = 0; r < rows; r++)
      edgePts[vEdgeId(c, r, cols, rows)] = flattenEdge(edges.v[c][r], { x: c * cw, y: r * ch }, { x: c * cw, y: (r + 1) * ch }, { x: 1, y: 0 }, L, ns)

  // Upper bounds for allocation.
  const maxPts = 4 * 3 * ns + 4
  const outline = new Float32Array(n * maxPts * 2)
  const outlineStart = new Uint32Array(n + 1)
  const fillBuf = new ArrayBuffer(n * maxPts * FILL_STRIDE)
  const fillF = new Float32Array(fillBuf)
  const fillU16 = new Uint16Array(fillBuf)
  const fillIdx = new Uint32Array(n * maxPts * 3)
  const fillStart = new Uint32Array(n + 1)
  const stripVerts = n * (maxPts + 4) * 2
  const stripBuf = new ArrayBuffer(stripVerts * STRIP_STRIDE)
  const stripF = new Float32Array(stripBuf)
  const stripU16 = new Uint16Array(stripBuf)
  const stripU8 = new Uint8Array(stripBuf)
  const stripIdx = new Uint32Array(n * (maxPts + 4) * 6)
  const stripStart = new Uint32Array(n + 1)

  let oPts = 0
  let fv = 0
  let fi = 0
  let sv = 0
  let si = 0
  let tris = 0

  const side = new Float64Array(maxPts * 2)
  const pts = new Float64Array(maxPts * 2)
  const nx = new Float64Array(maxPts)
  const ny = new Float64Array(maxPts)
  const local: number[] = []

  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = (i / cols) | 0
    const x0 = col * cw
    const y0 = row * ch
    const x1 = x0 + cw
    const y1 = y0 + ch

    // 2. Assemble the outline clockwise: top →, right ↓, bottom ←, left ↑.
    let P = 0
    const sideStart = [0, 0, 0, 0]
    const sideLen = [0, 0, 0, 0]
    const sideEdge = [BORDER_EDGE, BORDER_EDGE, BORDER_EDGE, BORDER_EDGE]
    const appendSide = (s: number, src: ArrayLike<number> | null, flat: number[], reversed: boolean, edgeId: number) => {
      let len: number
      if (src) {
        len = src.length / 2
        for (let k = 0; k < len; k++) {
          const j = reversed ? len - 1 - k : k
          side[k * 2] = src[j * 2]
          side[k * 2 + 1] = src[j * 2 + 1]
        }
      } else {
        len = flat.length / 2
        for (let k = 0; k < flat.length; k++) side[k] = flat[k]
      }
      sideEdge[s] = edgeId
      // The side's first point is the previous side's last point (except for the first side).
      sideStart[s] = s === 0 ? 0 : P - 1
      sideLen[s] = len
      const from = s === 0 ? 0 : 1
      const to = s === 3 ? len - 1 : len // last side's end point is the outline start
      for (let k = from; k < to; k++) {
        pts[P * 2] = side[k * 2]
        pts[P * 2 + 1] = side[k * 2 + 1]
        P++
      }
    }
    if (row === 0) appendSide(0, null, [x0, y0, x1, y0], false, BORDER_EDGE)
    else appendSide(0, edgePts[hEdgeId(row, col, cols)], [], false, hEdgeId(row, col, cols))
    if (col === cols - 1) appendSide(1, null, [x1, y0, x1, y1], false, BORDER_EDGE)
    else appendSide(1, edgePts[vEdgeId(col + 1, row, cols, rows)], [], false, vEdgeId(col + 1, row, cols, rows))
    if (row === rows - 1) appendSide(2, null, [x1, y1, x0, y1], false, BORDER_EDGE)
    else appendSide(2, edgePts[hEdgeId(row + 1, col, cols)], [], true, hEdgeId(row + 1, col, cols))
    if (col === 0) appendSide(3, null, [x0, y1, x0, y0], false, BORDER_EDGE)
    else appendSide(3, edgePts[vEdgeId(col, row, cols, rows)], [], true, vEdgeId(col, row, cols, rows))

    // 3. Outline (piece-local) for hit tests, fill vertices (board space).
    outlineStart[i] = oPts
    const fBase = fv
    local.length = 0
    for (let k = 0; k < P; k++) {
      const x = pts[k * 2]
      const y = pts[k * 2 + 1]
      outline[(oPts + k) * 2] = x - x0
      outline[(oPts + k) * 2 + 1] = y - y0
      local.push(x - x0, y - y0)
      const o = (fv + k) * 3 // stride 12 bytes = 3 floats
      fillF[o] = x
      fillF[o + 1] = y
      fillU16[(o + 2) * 2] = i
    }
    oPts += P
    fv += P

    // 4. Triangulate.
    fillStart[i] = fi
    const tri = earcut(local)
    for (let k = 0; k < tri.length; k++) fillIdx[fi++] = fBase + tri[k]
    tris += tri.length / 3

    // 5. Mitered outward normals per outline vertex.
    for (let k = 0; k < P; k++) {
      const a = (k - 1 + P) % P
      const b = (k + 1) % P
      let n1x = pts[k * 2 + 1] - pts[a * 2 + 1]
      let n1y = -(pts[k * 2] - pts[a * 2])
      let n2x = pts[b * 2 + 1] - pts[k * 2 + 1]
      let n2y = -(pts[b * 2] - pts[k * 2])
      const l1 = Math.hypot(n1x, n1y) || 1
      const l2 = Math.hypot(n2x, n2y) || 1
      n1x /= l1
      n1y /= l1
      n2x /= l2
      n2y /= l2
      let mx = n1x + n2x
      let my = n1y + n2y
      const ml = Math.hypot(mx, my)
      if (ml < 1e-6) {
        mx = n2x
        my = n2y
      } else {
        mx /= ml
        my /= ml
      }
      const miter = 1 / Math.max(0.5, mx * n1x + my * n1y)
      nx[k] = mx * miter
      ny[k] = my * miter
    }

    // 6. Bevel strip: per side its own vertex pairs (so each carries its edge id).
    stripStart[i] = si
    for (let s = 0; s < 4; s++) {
      const base = sv
      const len = sideLen[s]
      for (let j = 0; j < len; j++) {
        const k = (sideStart[s] + j) % P
        for (let inner = 0; inner < 2; inner++) {
          const o = sv * 6 // 24 bytes = 6 floats
          stripF[o] = pts[k * 2]
          stripF[o + 1] = pts[k * 2 + 1]
          stripF[o + 2] = nx[k]
          stripF[o + 3] = ny[k]
          stripU16[(o + 4) * 2] = i
          stripU16[(o + 4) * 2 + 1] = sideEdge[s]
          stripU8[(o + 5) * 4] = inner ? 255 : 0
          sv++
        }
      }
      for (let j = 0; j < len - 1; j++) {
        const a = base + 2 * j
        stripIdx[si++] = a
        stripIdx[si++] = a + 1
        stripIdx[si++] = a + 2
        stripIdx[si++] = a + 1
        stripIdx[si++] = a + 3
        stripIdx[si++] = a + 2
      }
    }

    if (onProgress && (i + 1) % 250 === 0) onProgress(i + 1, n)
  }
  outlineStart[n] = oPts
  fillStart[n] = fi
  stripStart[n] = si

  // 7. Per-piece average colour.
  const avgLab = new Float32Array(n * 3)
  const avgRgb = new Uint8Array(n * 3)
  if (p.colors) {
    const { data, w, h } = p.colors
    const bw = w / cols
    const bh = h / rows
    for (let i = 0; i < n; i++) {
      const col = i % cols
      const row = (i / cols) | 0
      let r = 0
      let g = 0
      let b = 0
      let lr = 0
      let lg = 0
      let lb = 0
      let cnt = 0
      for (let y = Math.floor(row * bh); y < Math.floor((row + 1) * bh); y++)
        for (let x = Math.floor(col * bw); x < Math.floor((col + 1) * bw); x++) {
          const o = (y * w + x) * 4
          r += data[o]
          g += data[o + 1]
          b += data[o + 2]
          lr += srgbToLinear(data[o])
          lg += srgbToLinear(data[o + 1])
          lb += srgbToLinear(data[o + 2])
          cnt++
        }
      cnt ||= 1
      avgRgb[i * 3] = r / cnt
      avgRgb[i * 3 + 1] = g / cnt
      avgRgb[i * 3 + 2] = b / cnt
      const [L, A, B] = linearToOklab(lr / cnt, lg / cnt, lb / cnt)
      avgLab[i * 3] = L
      avgLab[i * 3 + 1] = A
      avgLab[i * 3 + 2] = B
    }
  }

  return {
    n,
    edgeCount: ec,
    outlinePts: outline.slice(0, oPts * 2),
    outlineStart,
    fillVBO: fillBuf.slice(0, fv * FILL_STRIDE),
    fillIdx: fillIdx.slice(0, fi),
    fillStart,
    stripVBO: stripBuf.slice(0, sv * STRIP_STRIDE),
    stripIdx: stripIdx.slice(0, si),
    stripStart,
    avgLab,
    avgRgb,
    stats: { verts: fv + sv, tris: tris + si / 3, ms: Math.round(performance.now() - t0) },
  }
}

const srgbToLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
