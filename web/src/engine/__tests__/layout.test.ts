import { describe, expect, it } from 'vitest'
import { chooseGrid, makeGrid } from '../layout'

describe('chooseGrid', () => {
  it('yields exact counts for 4:3 scenes', () => {
    expect([12, 24, 48, 96, 150].map((n) => chooseGrid(n, 4 / 3).count)).toEqual([12, 24, 48, 96, 150])
  })

  it('handles portrait photos', () => {
    const g = chooseGrid(48, 3 / 4)
    expect(g.rows).toBeGreaterThan(g.cols)
    expect(Math.abs(g.count - 48)).toBeLessThanOrEqual(4)
  })

  it('snaps the board to whole-pixel cells', () => {
    const g = makeGrid(15, 10, 1600, 1200)
    expect(Number.isInteger(g.cw) && Number.isInteger(g.ch)).toBe(true)
    expect(g.W).toBe(15 * g.cw)
  })
})
