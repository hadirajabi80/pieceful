import { useEffect, useRef } from 'react'
import type { Game } from '../../engine/Game'

const W = 180

/** Overview of the whole table: board, every loose group (in its colour), and the viewport. */
export function Minimap({ game }: { game: Game }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef(false)

  useEffect(() => {
    let raf = 0
    let last = 0
    const draw = () => {
      raf = 0
      last = performance.now()
      const c = canvas.current
      if (!c) return
      const d = game.minimap()
      const cw = d.content.x1 - d.content.x0
      const chh = d.content.y1 - d.content.y0
      const h = Math.round(Math.min(200, Math.max(80, (W * chh) / cw)))
      const dpr = Math.min(2, devicePixelRatio || 1)
      if (c.width !== W * dpr || c.height !== h * dpr) {
        c.width = W * dpr
        c.height = h * dpr
        c.style.height = h + 'px'
      }
      const s = Math.min(W / cw, h / chh)
      const ox = (W - cw * s) / 2 - d.content.x0 * s
      const oy = (h - chh * s) / 2 - d.content.y0 * s
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, h)
      const css = getComputedStyle(c)
      // board
      ctx.fillStyle = css.getPropertyValue('--mm-board') || 'rgba(0,0,0,.08)'
      ctx.fillRect(ox + d.board.x0 * s, oy + d.board.y0 * s, (d.board.x1 - d.board.x0) * s, (d.board.y1 - d.board.y0) * s)
      if (d.placed) {
        ctx.fillStyle = css.getPropertyValue('--mm-placed') || 'rgba(63,167,150,.35)'
        const frac = d.placed / d.n
        ctx.fillRect(ox, oy + d.board.y1 * s * (1 - frac), d.board.x1 * s, d.board.y1 * s * frac)
      }
      // groups
      for (const r of d.rects) {
        ctx.fillStyle = '#' + r.rgb.toString(16).padStart(6, '0')
        ctx.fillRect(ox + r.x0 * s, oy + r.y0 * s, Math.max(1.5, (r.x1 - r.x0) * s), Math.max(1.5, (r.y1 - r.y0) * s))
      }
      // viewport
      ctx.strokeStyle = css.getPropertyValue('--accent') || '#e26a8a'
      ctx.lineWidth = 1.5
      ctx.strokeRect(ox + d.view.x0 * s, oy + d.view.y0 * s, (d.view.x1 - d.view.x0) * s, (d.view.y1 - d.view.y0) * s)
      ;(c as HTMLCanvasElement & { _map?: { s: number; ox: number; oy: number } })._map = { s, ox, oy }
    }
    const schedule = () => {
      if (raf) return
      const wait = Math.max(0, 120 - (performance.now() - last))
      raf = window.setTimeout(() => requestAnimationFrame(draw), wait) as unknown as number
    }
    draw()
    const offs = [game.on('camera', schedule), game.on('layout', schedule), game.on('progress', schedule)]
    return () => {
      offs.forEach((f) => f())
      clearTimeout(raf)
    }
  }, [game])

  const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget as HTMLCanvasElement & { _map?: { s: number; ox: number; oy: number } }
    const m = c._map
    if (!m) return
    const r = c.getBoundingClientRect()
    game.centerOn({ x: (e.clientX - r.left - m.ox) / m.s, y: (e.clientY - r.top - m.oy) / m.s })
  }

  return (
    <div className="minimap glass" aria-label="Minimap">
      <canvas
        ref={canvas}
        width={W}
        height={120}
        onPointerDown={(e) => {
          drag.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          jump(e)
        }}
        onPointerMove={(e) => drag.current && jump(e)}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
      />
    </div>
  )
}
