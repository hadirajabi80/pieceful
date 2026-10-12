import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { Game } from '../../engine/Game'

/** Floating reference image ("box lid"): drag by its header, resize from the corner. */
export function PreviewPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  const saved = game.preview
  const vw = window.innerWidth
  const defW = vw < 720 ? Math.round(vw * 0.5) : 280
  const [box, setBox] = useState(() => {
    const w = saved && saved.w > 0 ? saved.w : defW
    const x = saved && saved.x >= 0 ? Math.min(saved.x, vw - 80) : vw - w - 16
    const y = saved && saved.y >= 0 ? Math.min(saved.y, window.innerHeight - 80) : 76
    return { x, y, w }
  })
  const op = useRef<{ kind: 'move' | 'size'; sx: number; sy: number; box: typeof box } | null>(null)
  const aspect = game.grid.W / game.grid.H

  useEffect(() => {
    const t = setTimeout(() => game.setPreview({ open: true, ...box }), 300)
    return () => clearTimeout(t)
  }, [box, game])

  const start = (kind: 'move' | 'size') => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    op.current = { kind, sx: e.clientX, sy: e.clientY, box }
  }
  const move = (e: React.PointerEvent) => {
    const o = op.current
    if (!o) return
    const dx = e.clientX - o.sx
    const dy = e.clientY - o.sy
    if (o.kind === 'move') setBox({ ...o.box, x: Math.max(-o.box.w + 60, Math.min(window.innerWidth - 60, o.box.x + dx)), y: Math.max(0, Math.min(window.innerHeight - 40, o.box.y + dy)) })
    else setBox({ ...o.box, w: Math.max(160, Math.min(window.innerWidth * 0.7, o.box.w + dx)) })
  }
  const end = () => (op.current = null)
  const cycle = () => setBox((b) => ({ ...b, w: b.w < 240 ? 300 : b.w < 400 ? 460 : 180 }))

  return (
    <section className="preview-panel glass" style={{ left: box.x, top: box.y, width: box.w }} aria-label="Preview image">
      <header className="preview-head" onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={cycle}>
        <span>Preview</span>
        <button className="btn btn-icon btn-xs" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label="Close preview">
          <Icon name="close" size={16} />
        </button>
      </header>
      <img src={game.image.preview} alt={game.image.title} style={{ aspectRatio: String(aspect) }} draggable={false} />
      <span className="preview-resize" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />
    </section>
  )
}
