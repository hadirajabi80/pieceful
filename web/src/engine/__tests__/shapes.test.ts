import { describe, expect, it } from 'vitest'
import { makeGrid } from '../layout'
import { generateEdges, pieceOutline, toSvgPath } from '../shapes'

describe('shapes', () => {
  const grid = makeGrid(6, 4, 1600, 1200)

  it('is deterministic for a seed', () => {
    const a = generateEdges(42, 6, 4)
    const b = generateEdges(42, 6, 4)
    for (let i = 0; i < 24; i++) expect(toSvgPath(pieceOutline(i, grid, a))).toBe(toSvgPath(pieceOutline(i, grid, b)))
  })

  it('differs between seeds', () => {
    const a = toSvgPath(pieceOutline(7, grid, generateEdges(1, 6, 4)))
    const b = toSvgPath(pieceOutline(7, grid, generateEdges(2, 6, 4)))
    expect(a).not.toBe(b)
  })

  it('corner pieces have two flat sides', () => {
    const p = pieceOutline(0, grid, generateEdges(3, 6, 4))
    expect(p.filter((c) => c[0] === 'L')).toHaveLength(2)
  })

  it('neighbours share the exact same edge curve', () => {
    const edges = generateEdges(9, 6, 4)
    const { cw, m } = grid
    // Piece 0's right edge (forward: p1 p2 p3 | p4 p5 p6 | p7 p8 p9) vs piece 1's left edge (reversed).
    const toWorld = (pts: number[], dx: number) => pts.map((v, k) => (k % 2 === 0 ? v + dx - m : v - m))
    const right = pieceOutline(0, grid, edges).slice(2, 5).map((c) => toWorld(c.slice(1) as number[], 0))
    const left = pieceOutline(1, grid, edges).slice(-3).map((c) => toWorld(c.slice(1) as number[], cw))
    // forward segment k == reversed segment (2-k) with control points swapped
    for (let k = 0; k < 3; k++) {
      const f = right[k]
      const r = left[2 - k]
      expect(f[0]).toBeCloseTo(r[2])
      expect(f[1]).toBeCloseTo(r[3])
      expect(f[2]).toBeCloseTo(r[0])
      expect(f[3]).toBeCloseTo(r[1])
    }
  })
})
