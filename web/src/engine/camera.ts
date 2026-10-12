import type { Rect, Vec } from './types'

/** screen = world * scale + t   (screen in CSS px) */
export class Camera {
  scale = 1
  tx = 0
  ty = 0
  vw = 1
  vh = 1
  minScale = 0.05
  maxScale = 8
  /** world rect that should stay reachable (board + scattered pieces) */
  content: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 }

  setViewport(w: number, h: number) {
    // Keep the world point at the viewport center fixed.
    const c = this.toWorld({ x: this.vw / 2, y: this.vh / 2 })
    this.vw = Math.max(1, w)
    this.vh = Math.max(1, h)
    this.tx = this.vw / 2 - c.x * this.scale
    this.ty = this.vh / 2 - c.y * this.scale
  }

  toWorld(p: Vec): Vec {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale }
  }

  toScreen(p: Vec): Vec {
    return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty }
  }

  /** Scale at which `r` fits the viewport with `pad` CSS px (and extra top/bottom room for toolbars). */
  fitScale(r: Rect, pad = 24, padTop = 72, padBottom = 84): number {
    const w = r.x1 - r.x0
    const h = r.y1 - r.y0
    return Math.min((this.vw - 2 * pad) / w, (this.vh - padTop - padBottom) / h)
  }

  fit(r: Rect, pad = 24, padTop = 72, padBottom = 84) {
    this.scale = this.fitScale(r, pad, padTop, padBottom)
    const cx = (r.x0 + r.x1) / 2
    const cy = (r.y0 + r.y1) / 2
    this.tx = this.vw / 2 - cx * this.scale
    this.ty = padTop + (this.vh - padTop - padBottom) / 2 - cy * this.scale
  }

  /** Zoom by `factor` keeping the world point under `screen` fixed. */
  zoomAt(screen: Vec, factor: number) {
    const w = this.toWorld(screen)
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor))
    this.tx = screen.x - w.x * this.scale
    this.ty = screen.y - w.y * this.scale
    this.clamp()
  }

  panBy(dx: number, dy: number) {
    this.tx += dx
    this.ty += dy
    this.clamp()
  }

  /** Keep at least a chunk of the content on screen. */
  clamp() {
    const keep = 80
    const a = this.toScreen({ x: this.content.x0, y: this.content.y0 })
    const b = this.toScreen({ x: this.content.x1, y: this.content.y1 })
    if (b.x < keep) this.tx += keep - b.x
    if (a.x > this.vw - keep) this.tx -= a.x - (this.vw - keep)
    if (b.y < keep) this.ty += keep - b.y
    if (a.y > this.vh - keep) this.ty -= a.y - (this.vh - keep)
  }

  /** Visible world rect. */
  viewRect(): Rect {
    const a = this.toWorld({ x: 0, y: 0 })
    const b = this.toWorld({ x: this.vw, y: this.vh })
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
  }
}
