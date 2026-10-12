import { describe, expect, it } from 'vitest'
import { makeGrid } from '../layout'
import { Puzzle } from '../Puzzle'

// 3 x 2 grid of 100 x 100 cells; no outlines → rectangular hit tests.
const setup = () => {
  const p = new Puzzle(makeGrid(3, 2, 300, 200))
  for (let g = 0; g < p.n; g++) {
    p.ox[g] = 1000 + g * 500
    p.oy[g] = 1000
  }
  return p
}

const place = (p: Puzzle, g: number, x: number, y: number) => {
  p.ox[g] = x
  p.oy[g] = y
}

describe('Puzzle (SoA)', () => {
  it('hit-tests the topmost group', () => {
    const p = setup()
    place(p, 1, p.ox[0] - 100, p.oy[0]) // piece 1 now covers piece 0's spot
    const at = { x: p.ox[0] + 50, y: p.oy[0] + 50 }
    expect(p.hitTest(at)).toBe(p.z[1] > p.z[0] ? 1 : 0)
    p.bringToFront(0)
    expect(p.hitTest(at)).toBe(0)
  })

  it('magnetically merges neighbours and adopts the exact origin', () => {
    const p = setup()
    place(p, 1, p.ox[0] + 17.3, p.oy[0] - 9.1) // within 28% of a cell
    const r = p.drop(1, { x: 0, y: 0 }, 1)
    expect(r.merged).toBe(true)
    const g = p.pieceGroup[0]
    expect(p.pieceGroup[1]).toBe(g)
    expect(p.ox[g]).toBe(1000)
    expect(p.oy[g]).toBe(1000)
    expect(p.loose.size).toBe(5)
    expect(r.joined).toHaveLength(1)
    expect(p.moves).toBe(1)
  })

  it('ignores drops outside tolerance and non-neighbours', () => {
    const p = setup()
    place(p, 1, p.ox[0] + 40, p.oy[0])
    expect(p.drop(1, { x: 0, y: 0 }, 1).merged).toBe(false)
    place(p, 5, p.ox[0], p.oy[0])
    expect(p.drop(5, { x: 0, y: 0 }, 1).merged).toBe(false)
  })

  it('picks the closest candidate', () => {
    const p = setup()
    place(p, 0, 0 + 3000, 3000)
    place(p, 2, 3000 + 20, 3000)
    place(p, 1, 3000 + 5, 3000) // between 0 (d=5) and 2 (d=15)
    const r = p.drop(1, { x: 0, y: 0 }, 1)
    // cascade: joins 0 first (closest), then 2 is within tolerance of the merged group too
    expect(r.merged).toBe(true)
    expect(p.pieceGroup[1]).toBe(p.pieceGroup[0])
    expect(p.pieceGroup[2]).toBe(p.pieceGroup[0])
    expect(p.ox[p.pieceGroup[0]]).toBe(3000)
  })

  it('unions by size: the smaller group is relabelled', () => {
    const p = setup()
    place(p, 1, p.ox[0], p.oy[0])
    p.drop(1, { x: 0, y: 0 }, 1)
    const big = p.pieceGroup[0]
    place(p, 2, p.ox[big], p.oy[big])
    const r = p.drop(2, { x: 0, y: 0 }, 1)
    expect(r.group).toBe(big)
    expect(r.relabeled).toEqual([2, big])
  })

  it('locks onto the board and completes exactly once', () => {
    const p = setup()
    let completions = 0
    for (let i = 0; i < p.n; i++) {
      const g = p.pieceGroup[i]
      if (p.isLocked(g)) continue
      place(p, g, 4, -6)
      const r = p.drop(g, { x: 999, y: 999 }, 1)
      expect(r.locked).toBe(true)
      if (r.completed) completions++
    }
    expect(p.placed).toBe(6)
    expect(p.completed).toBe(true)
    expect(completions).toBe(1)
    expect(p.loose.size).toBe(0)
  })

  it('auto-completes a fully assembled group off the board', () => {
    const p = setup()
    for (let i = 1; i < p.n; i++) {
      const g = p.pieceGroup[i]
      const h = p.pieceGroup[0]
      place(p, g, p.ox[h], p.oy[h])
      p.drop(g, { x: 0, y: 0 }, 1)
    }
    expect(p.completed).toBe(true)
  })

  it('round-trips through serialize/restore and rebuilds joined edges', () => {
    const p = setup()
    place(p, 1, p.ox[0], p.oy[0])
    p.drop(1, { x: 0, y: 0 }, 1)
    place(p, 5, 0, 0)
    p.drop(5, { x: 0, y: 0 }, 1)
    const s = p.serialize()
    const q = new Puzzle(makeGrid(3, 2, 300, 200))
    q.restore({ ...s })
    expect([...q.pieceGroup]).toEqual([...p.pieceGroup])
    expect(q.loose.size).toBe(p.loose.size)
    expect([...q.edgeJoined]).toEqual([...p.edgeJoined])
    expect(q.placed).toBe(1)
    expect(q.moves).toBe(1) // the second drop started at its final spot
  })
})
