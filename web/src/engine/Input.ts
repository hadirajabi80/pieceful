import type { Camera } from './camera'
import type { Vec } from './types'

export interface InputHandlers {
  /** Topmost pickable loose group under a world point, or -1. */
  hit(world: Vec): number
  pickUp(g: number, world: Vec): void
  /** world = pointer in world space, screen = pointer in css px (for edge auto-pan) */
  dragTo(world: Vec, screen: Vec): void
  drop(): void
  toggleSelect(g: number): void
  marquee(rect: { a: Vec; b: Vec } | null, done: boolean): void
  clickEmpty(): void
  cameraChanged(): void
  doubleTapEmpty(): void
  /** smooth (animated) zoom about a screen point */
  zoomBy(anchor: Vec, factor: number): void
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'press'; id: number; g: number; start: Vec; world: Vec; shift: boolean }
  | { kind: 'drag'; id: number }
  | { kind: 'pan'; id: number; last: Vec; start: Vec; t0: number; moved: boolean }
  | { kind: 'pinch'; ids: [number, number]; mid: Vec; dist: number }
  | { kind: 'marquee'; id: number; start: Vec; last: Vec }

const DRAG_SLOP = 4

/** Pointer, touch, wheel and keyboard-modifier handling for the table. */
export class Input {
  private mode: Mode = { kind: 'idle' }
  private pointers = new Map<number, Vec>()
  private lastTap = { t: 0, x: 0, y: 0 }
  private spaceHeld = false
  /** touch-friendly select mode: dragging on empty table draws a selection box */
  selectMode = false
  enabled = true

  constructor(
    private el: HTMLElement,
    private camera: Camera,
    private h: InputHandlers,
  ) {
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', prevent)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    window.addEventListener('blur', this.cancel)
  }

  destroy() {
    const el = this.el
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onUp)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('contextmenu', prevent)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    window.removeEventListener('blur', this.cancel)
  }

  get busy() {
    return this.mode.kind !== 'idle'
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    this.spaceHeld = e.type === 'keydown'
    this.el.style.cursor = this.spaceHeld ? 'grab' : ''
    if (e.type === 'keydown') e.preventDefault()
  }

  private local(e: PointerEvent | WheelEvent): Vec {
    const r = this.el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return
    const p = this.local(e)
    this.pointers.set(e.pointerId, p)
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic */
    }
    const mode = this.mode

    if (mode.kind === 'idle') {
      const world = this.camera.toWorld(p)
      const isMouse = e.pointerType === 'mouse'
      if (e.button === 1 || this.spaceHeld) {
        this.mode = { kind: 'pan', id: e.pointerId, last: p, start: p, t0: performance.now(), moved: true }
        return
      }
      if (isMouse && e.button === 2) {
        this.mode = { kind: 'marquee', id: e.pointerId, start: p, last: p }
        return
      }
      const g = this.h.hit(world)
      if (g >= 0) {
        this.mode = { kind: 'press', id: e.pointerId, g, start: p, world, shift: e.shiftKey || (this.selectMode && !isMouse) }
      } else if (e.shiftKey || this.selectMode) {
        this.mode = { kind: 'marquee', id: e.pointerId, start: p, last: p }
      } else {
        this.mode = { kind: 'pan', id: e.pointerId, last: p, start: p, t0: performance.now(), moved: false }
      }
    } else if ((mode.kind === 'pan' || mode.kind === 'marquee' || mode.kind === 'press') && this.pointers.size === 2) {
      // A second finger turns anything that hasn't started moving pieces into a pinch.
      if (mode.kind === 'marquee') this.h.marquee(null, false)
      const ids = [...this.pointers.keys()] as [number, number]
      const [a, b] = ids.map((id) => this.pointers.get(id)!)
      this.mode = { kind: 'pinch', ids, mid: mid(a, b), dist: Math.max(1, dist(a, b)) }
    }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    const p = this.local(e)
    this.pointers.set(e.pointerId, p)
    const mode = this.mode

    if (mode.kind === 'press' && e.pointerId === mode.id) {
      if (dist(p, mode.start) < DRAG_SLOP) return
      this.mode = { kind: 'drag', id: mode.id }
      this.h.pickUp(mode.g, mode.world)
      this.h.dragTo(this.camera.toWorld(p), p)
    } else if (mode.kind === 'drag' && e.pointerId === mode.id) {
      this.h.dragTo(this.camera.toWorld(p), p)
    } else if (mode.kind === 'pan' && e.pointerId === mode.id) {
      this.camera.panBy(p.x - mode.last.x, p.y - mode.last.y)
      mode.last = p
      if (dist(p, mode.start) > 6) mode.moved = true
      this.h.cameraChanged()
    } else if (mode.kind === 'marquee' && e.pointerId === mode.id) {
      mode.last = p
      this.h.marquee({ a: this.camera.toWorld(mode.start), b: this.camera.toWorld(p) }, false)
    } else if (mode.kind === 'pinch') {
      const a = this.pointers.get(mode.ids[0])
      const b = this.pointers.get(mode.ids[1])
      if (!a || !b) return
      const m2 = mid(a, b)
      const d2 = Math.max(1, dist(a, b))
      this.camera.panBy(m2.x - mode.mid.x, m2.y - mode.mid.y)
      this.camera.zoomAt(m2, d2 / mode.dist)
      mode.mid = m2
      mode.dist = d2
      this.h.cameraChanged()
    }
  }

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    const p = this.pointers.get(e.pointerId)!
    this.pointers.delete(e.pointerId)
    const mode = this.mode

    if (mode.kind === 'press' && e.pointerId === mode.id) {
      this.mode = { kind: 'idle' }
      if (mode.shift) this.h.toggleSelect(mode.g)
      else {
        // A click on a piece: pick up and drop in place (brings it to front, no move).
        this.h.pickUp(mode.g, mode.world)
        this.h.drop()
      }
    } else if (mode.kind === 'drag' && e.pointerId === mode.id) {
      this.mode = { kind: 'idle' }
      this.h.drop()
    } else if (mode.kind === 'pan' && e.pointerId === mode.id) {
      this.mode = { kind: 'idle' }
      if (!mode.moved && e.type === 'pointerup') {
        this.h.clickEmpty()
        this.tap(p)
      }
    } else if (mode.kind === 'marquee' && e.pointerId === mode.id) {
      this.mode = { kind: 'idle' }
      if (dist(mode.start, mode.last) < DRAG_SLOP) {
        this.h.marquee(null, true)
        this.h.clickEmpty()
      } else this.h.marquee({ a: this.camera.toWorld(mode.start), b: this.camera.toWorld(mode.last) }, true)
    } else if (mode.kind === 'pinch' && mode.ids.includes(e.pointerId)) {
      const rest = mode.ids.find((id) => id !== e.pointerId)!
      const rp = this.pointers.get(rest)
      this.mode = rp ? { kind: 'pan', id: rest, last: rp, start: rp, t0: 0, moved: true } : { kind: 'idle' }
    }
  }

  private tap(p: Vec) {
    const now = performance.now()
    if (now - this.lastTap.t < 320 && dist(p, this.lastTap) < 24) {
      this.lastTap.t = 0
      this.h.doubleTapEmpty()
    } else {
      this.lastTap = { t: now, x: p.x, y: p.y }
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (!this.enabled) return
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    const p = this.local(e)
    if (e.ctrlKey) {
      // Trackpad pinch is continuous, so apply directly (at a gentle rate).
      this.camera.zoomAt(p, Math.pow(1.006, -dy))
      this.h.cameraChanged()
    } else if (dx !== 0) {
      this.camera.panBy(-dx, -dy)
      this.h.cameraChanged()
    } else if (e.shiftKey) {
      this.camera.panBy(-dy, 0)
      this.h.cameraChanged()
    } else {
      // Mouse wheel: about 6% per notch, eased by the game.
      this.h.zoomBy(p, Math.pow(1.06, -Math.max(-300, Math.min(300, dy)) / 100))
    }
  }

  /** Abort any gesture (window blur / tab hidden / modal opened). */
  cancel = () => {
    const mode = this.mode
    this.pointers.clear()
    this.spaceHeld = false
    this.mode = { kind: 'idle' }
    if (mode.kind === 'drag') this.h.drop()
    if (mode.kind === 'marquee') this.h.marquee(null, true)
  }
}

const prevent = (e: Event) => e.preventDefault()
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
