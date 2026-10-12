import { describe, expect, it } from 'vitest'
import { buildGeometry, FILL_STRIDE } from '../geometry'
import { chooseGrid, makeGrid } from '../layout'

describe('geometry', () => {
  it('cuts 5000 pieces with shared, watertight edges', () => {
    const { cols, rows } = chooseGrid(5000, 4 / 3)
    const g = makeGrid(cols, rows, 3840, 2880)
    const geo = buildGeometry({ seed: 7, cols, rows, cw: g.cw, ch: g.ch, mobile: false })
    expect(geo.n).toBe(cols * rows)
    expect(geo.fillIdx.length % 3).toBe(0)
    expect(geo.stats.ms).toBeLessThan(4000)
    // Piece 0's right edge points must equal piece 1's left edge points (board space).
    const f = new Float32Array(geo.fillVBO)
    const pts = (i: number) => {
      const out: string[] = []
      for (let k = geo.outlineStart[i]; k < geo.outlineStart[i + 1]; k++) out.push(`${f[k * (FILL_STRIDE / 4)]},${f[k * (FILL_STRIDE / 4) + 1]}`)
      return new Set(out)
    }
    const a = pts(0)
    const b = pts(1)
    const shared = [...a].filter((p) => b.has(p))
    expect(shared.length).toBeGreaterThan(10)
  })
})
