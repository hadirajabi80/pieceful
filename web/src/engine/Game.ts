import { sfx } from '../audio/sfx'
import { loadPuzzleImage, sampleColors, type LoadedImage } from '../images/loader'
import { deleteSave, getSave, putSave, recordDone, saveId } from '../storage/db'
import { Camera } from './camera'
import { kmeans, oklabToRgb, zoneCount } from './color'
import { Confetti } from './confetti'
import type { CutParams } from './geometry'
import { GlRenderer, tableColors, type TableColors } from './gl/GlRenderer'
import { Z_MAX } from './gl/shaders'
import { Input } from './Input'
import {
  colorZonesLayout,
  edgesOutLayout,
  gatherLayout,
  makeGrid,
  scatterLayout,
  tidyLayout,
  type LayoutCtx,
  type LayoutItem,
  type Placement,
  type Zone,
} from './layout'
import { Puzzle } from './Puzzle'
import { mulberry32, newSeed } from './rng'
import { isEdgePiece } from './shapes'
import { GF, type GeometryBuffers, type Grid, type Rect, type SaveSettings, type SaveV2, type Vec } from './types'

export interface GameStats {
  placed: number
  total: number
  moves: number
  elapsedMs: number
  completed: boolean
  loose: number
  hints: number
  bestCombo: number
}

export interface ViewState {
  ghost: boolean
  edgesOnly: boolean
  hidePlaced: boolean
  zone: number
  selectMode: boolean
  paused: boolean
}

export interface CompleteEvent {
  hints: number
  bestCombo: number
  elapsedMs: number
  moves: number
  total: number
  bestMs: number
  isBest: boolean
}

export interface LoadProgress {
  stage: 'download' | 'cut' | 'prepare'
  done: number
  total: number
}

export interface Appearance {
  table: { table: string; slot: string; line: string }
  accent: string
  mint: string
  amber: string
  bevel: number
  ghostOpacity: number
  haptics: boolean
}

type Events = {
  progress: GameStats
  view: ViewState
  selection: { groups: number; pieces: number }
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  zones: Zone[] | null
  camera: void
  layout: void
  /** while dragging with the board off-screen: where to point the 'board' arrow (screen px) */
  boardHint: { x: number; y: number; angle: number } | null
  /** consecutive snaps in quick succession */
  combo: { count: number; x: number; y: number }
  /** progress crossed 25 / 50 / 75 / 90 % */
  milestone: number
  /** a hint was requested: whether one could be shown */
  hint: boolean
  complete: CompleteEvent
}

interface Tween {
  fx: number
  fy: number
  tx: number
  ty: number
  t0: number
  dur: number
  done?: () => void
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const hexRgb = (h: string): [number, number, number] => {
  const m = /#?([0-9a-f]{6})/i.exec(h.trim())
  const v = m ? parseInt(m[1], 16) : 0xe26a8a
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Runs the geometry worker (falls back to the main thread if workers fail). */
function cut(params: CutParams, onProgress: (d: number, t: number) => void): Promise<GeometryBuffers> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      import('./geometry').then((m) => resolve(m.buildGeometry(params, onProgress)), reject)
      return
    }
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress(msg.done, msg.total)
      else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.geo)
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Geometry worker failed'))
    }
    worker.postMessage({ type: 'cut', params }, [params.colors!.data.buffer])
  })
}

/**
 * The puzzle session: loads the image, cuts pieces in a worker, and wires the rules (Puzzle),
 * the WebGL renderer and input together. Owns snapping animation, selection, sorting,
 * timer and autosave.
 */
export class Game {
  readonly camera = new Camera()
  readonly view: ViewState = { ghost: false, edgesOnly: false, hidePlaced: false, zone: -1, selectMode: false, paused: false }
  readonly selected = new Set<number>()
  zones: Zone[] | null = null
  preview: SaveSettings['preview'] = null

  private renderer: GlRenderer
  private input: Input
  private ro: ResizeObserver
  private listeners: { [K in keyof Events]?: ((v: Events[K]) => void)[] } = {}
  private tweens = new Map<number, Tween>()
  private colorClass: Uint8Array
  private rand: () => number
  private fx: CanvasRenderingContext2D | null
  private confetti = new Confetti()

  private dragging: number[] = []
  private draggingSet = new Set<number>()
  private dragStart = new Map<number, Vec>()
  private grabWorld: Vec = { x: 0, y: 0 }
  private liftT0 = 0
  private liftDown = false
  private target: { kind: 'board' | 'group'; target: number } | null = null
  private popT0 = 0
  private popGroup = -1
  private flashT0 = 0
  private revealT0 = 0

  private hintsUsed: number
  private bestCombo: number
  private combo = 0
  private lastSnapT = 0
  private hintGroup = -1
  private hintUntil = 0
  private hintDest: Vec = { x: 0, y: 0 }
  private camTween: { s0: number; tx0: number; ty0: number; s1: number; tx1: number; ty1: number; t0: number; dur: number } | null = null
  private zoomAnim: { target: number; anchor: Vec; t: number } | null = null
  private elapsedBase: number
  private runningSince: number | null = null
  private saveTimer = 0
  private firstDirty = 0
  private destroyed = false
  private readonly createdAt: number
  private appearance: Appearance | null = null
  private haptics = true
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  private constructor(
    wrapper: HTMLElement,
    canvas: HTMLCanvasElement,
    fxCanvas: HTMLCanvasElement | null,
    readonly imageId: string,
    readonly image: LoadedImage,
    readonly grid: Grid,
    private seed: number,
    private geo: GeometryBuffers,
    readonly puzzle: Puzzle,
    save: SaveV2 | undefined,
    edgeStart: boolean,
  ) {
    this.createdAt = save?.createdAt ?? Date.now()
    this.elapsedBase = save?.elapsedMs ?? 0
    this.hintsUsed = save?.hints ?? 0
    this.bestCombo = save?.bestCombo ?? 0
    this.rand = mulberry32((seed ^ 0x9e3779b9) + (save?.moves ?? 0))
    this.colorClass = save?.colorClass ? new Uint8Array(save.colorClass) : new Uint8Array(puzzle.n)
    this.fx = fxCanvas?.getContext('2d') ?? null

    const r = wrapper.getBoundingClientRect()
    this.camera.setViewport(r.width, r.height)
    this.renderer = new GlRenderer(canvas, grid, geo, image.bitmap, this.camera)
    this.renderer.onFrame = this.onFrame
    this.renderer.onContextRestored = () => this.syncAll()
    this.resize(r.width, r.height)

    if (save) {
      Object.assign(this.view, {
        ghost: save.settings.ghost,
        edgesOnly: save.settings.edgesOnly,
        hidePlaced: save.settings.hidePlaced,
        zone: save.settings.zone,
      })
      this.preview = save.settings.preview
    } else {
      const items = this.items()
      const ctx = this.layoutCtx()
      const placement = edgeStart ? edgesOutLayout(items, (g) => !!puzzle.hasEdge[g], ctx) : scatterLayout(items, ctx)
      for (const [g, v] of placement) {
        puzzle.ox[g] = v.x
        puzzle.oy[g] = v.y
      }
      // Random stacking order.
      for (const g of [...puzzle.loose].sort(() => this.rand() - 0.5)) puzzle.bringToFront(g)
    }
    this.syncAll()
    this.updateContent()
    if (save?.settings.camera) Object.assign(this.camera, save.settings.camera)
    else this.fit()
    this.camera.clamp()

    this.input = new Input(canvas, this.camera, {
      hit: (w) => puzzle.hitTest(w, this.pickable),
      pickUp: this.pickUp,
      dragTo: this.dragTo,
      drop: this.drop,
      toggleSelect: this.toggleSelect,
      marquee: this.marquee,
      clickEmpty: () => {
        if (!this.view.selectMode) this.clearSelection()
      },
      cameraChanged: this.cameraChanged,
      doubleTapEmpty: () => this.fit(),
      zoomBy: this.zoomBy,
    })

    this.ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      this.camera.setViewport(width, height)
      this.updateZoomLimits()
      this.camera.clamp()
      this.resize(width, height)
      this.emit('camera', undefined)
    })
    this.ro.observe(wrapper)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.flushSave)
    if (!puzzle.completed && document.visibilityState === 'visible') this.runningSince = performance.now()
    if (!save) this.scheduleSave()
  }

  static async create(opts: {
    wrapper: HTMLElement
    canvas: HTMLCanvasElement
    fxCanvas: HTMLCanvasElement | null
    imageId: string
    cols: number
    rows: number
    edgeStart: boolean
    onProgress: (p: LoadProgress) => void
    signal?: AbortSignal
  }): Promise<Game> {
    if (!GlRenderer.supported()) throw new Error('WEBGL2_UNAVAILABLE')
    const { cols, rows } = opts
    const image = await loadPuzzleImage(opts.imageId, cols * rows, (d, t) => opts.onProgress({ stage: 'download', done: d, total: t }), opts.signal)
    try {
      const grid = makeGrid(cols, rows, image.width, image.height)
      // Never let a stuck IndexedDB (e.g. blocked by another tab) hang the loading screen.
      let save = await Promise.race([
        getSave(saveId(opts.imageId, cols, rows)).catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000)),
      ])
      if (save && (save.cw !== grid.cw || save.ch !== grid.ch || save.n !== cols * rows || save.completed)) save = undefined
      const seed = save?.seed ?? newSeed()
      opts.onProgress({ stage: 'cut', done: 0, total: cols * rows })
      const mobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900
      const geo = await cut(
        { seed, cols, rows, cw: grid.cw, ch: grid.ch, mobile, colors: sampleColors(image.bitmap, cols, rows) },
        (d, t) => opts.onProgress({ stage: 'cut', done: d, total: t }),
      )
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      opts.onProgress({ stage: 'prepare', done: 0, total: 1 })
      const puzzle = new Puzzle(grid, { pts: geo.outlinePts, start: geo.outlineStart })
      if (save) puzzle.restore(save)
      return new Game(opts.wrapper, opts.canvas, opts.fxCanvas, opts.imageId, image, grid, seed, geo, puzzle, save, opts.edgeStart)
    } catch (e) {
      image.bitmap.close()
      image.revoke?.()
      throw e
    }
  }

  // ---------- events ----------

  on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void): () => void {
    const list = (this.listeners[ev] ??= []) as ((v: Events[K]) => void)[]
    list.push(fn)
    return () => {
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  private emit<K extends keyof Events>(ev: K, v: Events[K]) {
    for (const fn of (this.listeners[ev] ?? []) as ((v: Events[K]) => void)[]) fn(v)
  }

  get id() {
    return saveId(this.imageId, this.grid.cols, this.grid.rows)
  }

  stats(): GameStats {
    return {
      placed: this.puzzle.placed,
      total: this.puzzle.n,
      moves: this.puzzle.moves,
      elapsedMs: this.elapsed(),
      completed: this.puzzle.completed,
      loose: this.puzzle.loose.size,
      hints: this.hintsUsed,
      bestCombo: this.bestCombo,
    }
  }

  elapsed(): number {
    return this.elapsedBase + (this.runningSince !== null ? performance.now() - this.runningSince : 0)
  }

  private pauseTimer() {
    if (this.runningSince !== null) {
      this.elapsedBase += performance.now() - this.runningSince
      this.runningSince = null
    }
  }

  private resumeTimer() {
    if (this.runningSince === null && !this.puzzle.completed && !this.view.paused && document.visibilityState === 'visible')
      this.runningSince = performance.now()
  }

  // ---------- appearance ----------

  setAppearance(a: Appearance) {
    this.appearance = a
    const r = this.renderer
    r.table = tableColors(a.table) as TableColors
    r.accent = hexRgb(a.accent)
    r.mint = hexRgb(a.mint)
    r.amber = hexRgb(a.amber)
    r.bevelStrength = a.bevel
    r.ghostAlpha = this.view.ghost ? a.ghostOpacity : 0
    this.haptics = a.haptics
    r.requestRender()
  }

  private resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.resize(w, h, dpr)
    if (this.fx) {
      const c = this.fx.canvas
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      this.fx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  // ---------- state sync to the renderer ----------

  private flagsOf(g: number): number {
    let f = 0
    if (g === this.puzzle.boardGroup) f |= GF.LOCKED
    if (this.selected.has(g)) f |= GF.SELECTED
    if (this.draggingSet.has(g) || g === this.popGroup) f |= GF.LIFTED
    return f
  }

  private pieceFlags(p: number): number {
    return (isEdgePiece(p, this.grid.cols, this.grid.rows) ? 1 : 0) | (this.colorClass[p] << 1)
  }

  private syncGroup(g: number) {
    const p = this.puzzle
    this.renderer.setGroup(g, p.ox[g], p.oy[g], g === p.boardGroup ? 0 : p.z[g], this.flagsOf(g))
  }

  /** Full upload of every mirror (start, restore, context restore). */
  private syncAll() {
    const p = this.puzzle
    for (let i = 0; i < p.n; i++) {
      this.renderer.setPieceGroup(i, p.pieceGroup[i])
      this.renderer.setPieceFlags(i, this.pieceFlags(i))
    }
    for (let e = 0; e < p.edgeCount; e++) this.renderer.setEdgeJoined(e, p.edgeJoined[e])
    for (const g of p.members.keys()) this.syncGroup(g)
    this.applyView()
  }

  private applyView() {
    const r = this.renderer
    r.ghostAlpha = this.view.ghost ? (this.appearance?.ghostOpacity ?? 0.25) : 0
    r.dimEdges = this.view.edgesOnly
    r.zone = this.view.zone
    r.hideMask = GF.HIDDEN | (this.view.hidePlaced ? GF.LOCKED : 0)
    r.requestRender()
  }

  private pickable = (g: number): boolean => {
    if (this.view.edgesOnly && !this.puzzle.hasEdge[g]) return false
    // Colour classes are assigned per group, so the head piece speaks for the group.
    if (this.view.zone >= 0 && this.colorClass[g] !== this.view.zone + 1) return false
    return true
  }

  // ---------- camera ----------

  private updateContent() {
    const p = this.puzzle
    const { W, H, cw, ch, m } = this.grid
    const b: Rect = { x0: 0, y0: 0, x1: W, y1: H }
    for (const g of p.loose) {
      const r = p.worldBbox(g)
      if (r.x0 - m < b.x0) b.x0 = r.x0 - m
      if (r.y0 - m < b.y0) b.y0 = r.y0 - m
      if (r.x1 + m > b.x1) b.x1 = r.x1 + m
      if (r.y1 + m > b.y1) b.y1 = r.y1 + m
    }
    this.camera.content = { x0: b.x0 - cw * 0.5, y0: b.y0 - ch * 0.5, x1: b.x1 + cw * 0.5, y1: b.y1 + ch * 0.5 }
    this.updateZoomLimits()
  }

  private updateZoomLimits() {
    const fitAll = this.camera.fitScale(this.camera.content)
    this.camera.minScale = fitAll * 0.5
    this.camera.maxScale = Math.max(fitAll * 3, 420 / Math.min(this.grid.cw, this.grid.ch))
  }

  fit(boardOnly = false) {
    const board = { x0: 0, y0: 0, x1: this.grid.W, y1: this.grid.H }
    this.camera.fit(this.puzzle.completed || boardOnly ? board : this.camera.content)
    this.cameraChanged()
  }

  zoom(factor: number) {
    this.zoomBy({ x: this.camera.vw / 2, y: this.camera.vh / 2 }, factor)
  }

  zoomTo(scale: number) {
    this.zoomAnim = null
    this.camera.zoomAt({ x: this.camera.vw / 2, y: this.camera.vh / 2 }, scale / this.camera.scale)
    this.cameraChanged()
  }

  /** Smooth zoom: eases toward a target scale (repeated wheel notches accumulate). */
  zoomBy = (anchor: Vec, factor: number) => {
    const c = this.camera
    this.camTween = null
    const base = this.zoomAnim?.target ?? c.scale
    const target = Math.min(c.maxScale, Math.max(c.minScale, base * factor))
    if (this.reducedMotion) {
      c.zoomAt(anchor, target / c.scale)
      this.cameraChanged()
      return
    }
    this.zoomAnim = { target, anchor, t: performance.now() }
    this.renderer.requestRender()
  }

  /** Glide the camera so a world rect is in view. */
  private glideTo(r: Rect, maxPiecePx: number) {
    const c = this.camera
    const L = Math.min(this.grid.cw, this.grid.ch)
    const s1 = Math.max(c.minScale, Math.min(c.fitScale(r, 60, 120, 150), maxPiecePx / L, c.maxScale))
    const cx = (r.x0 + r.x1) / 2
    const cy = (r.y0 + r.y1) / 2
    const tx1 = c.vw / 2 - cx * s1
    const ty1 = c.vh / 2 + 10 - cy * s1
    this.zoomAnim = null
    if (this.reducedMotion) {
      Object.assign(c, { scale: s1, tx: tx1, ty: ty1 })
      this.cameraChanged()
      return
    }
    this.camTween = { s0: c.scale, tx0: c.tx, ty0: c.ty, s1, tx1, ty1, t0: performance.now(), dur: 520 }
    this.renderer.requestRender()
  }

  /** Centre the camera on a world point (minimap). */
  centerOn(p: Vec) {
    this.camera.tx = this.camera.vw / 2 - p.x * this.camera.scale
    this.camera.ty = this.camera.vh / 2 - p.y * this.camera.scale
    this.camera.clamp()
    this.cameraChanged()
  }

  private cameraChanged = () => {
    this.renderer.requestRender()
    this.emit('camera', undefined)
    this.scheduleSave(true)
  }

  // ---------- animation ----------

  private tweenGroup(g: number, from: Vec, to: Vec, dur: number, done?: () => void) {
    if (this.reducedMotion || dur <= 0 || (Math.abs(from.x - to.x) < 0.25 && Math.abs(from.y - to.y) < 0.25)) {
      this.renderer.setGroupPos(g, to.x, to.y)
      done?.()
      return
    }
    this.tweens.set(g, { fx: from.x, fy: from.y, tx: to.x, ty: to.y, t0: performance.now(), dur, done })
    this.renderer.setGroupPos(g, from.x, from.y)
    this.renderer.requestRender()
  }

  /** Completes every running tween immediately (before new interactions). */
  private flushTweens() {
    const list = [...this.tweens]
    this.tweens.clear()
    for (const [g, t] of list) {
      this.renderer.setGroupPos(g, t.tx, t.ty)
      t.done?.()
    }
  }

  private onFrame = (now: number): boolean => {
    let animating = false
    const r = this.renderer
    now = performance.now()

    for (const [g, t] of this.tweens) {
      const k = Math.min(1, (now - t.t0) / t.dur)
      const e = ease(k)
      r.setGroupPos(g, t.fx + (t.tx - t.fx) * e, t.fy + (t.ty - t.fy) * e)
      if (k >= 1) {
        this.tweens.delete(g)
        t.done?.()
      } else animating = true
    }

    if (this.autoPan(now)) animating = true

    if (this.zoomAnim) {
      const z = this.zoomAnim
      const dt = Math.min(64, now - z.t)
      z.t = now
      const k = 1 - Math.exp(-dt / 110)
      const c = this.camera
      let sc = c.scale + (z.target - c.scale) * k
      if (Math.abs(sc - z.target) / z.target < 0.003) {
        sc = z.target
        this.zoomAnim = null
      }
      c.zoomAt(z.anchor, sc / c.scale)
      this.emit('camera', undefined)
      if (this.zoomAnim) animating = true
      else this.scheduleSave(true)
    }

    if (this.camTween) {
      const t = this.camTween
      const k = Math.min(1, (now - t.t0) / t.dur)
      const e = ease(k)
      const c = this.camera
      // Log-scale zoom and a straight path between the start and end view centres.
      const sc = Math.exp(Math.log(t.s0) + (Math.log(t.s1) - Math.log(t.s0)) * e)
      const cx0 = (c.vw / 2 - t.tx0) / t.s0
      const cy0 = (c.vh / 2 - t.ty0) / t.s0
      const cx1 = (c.vw / 2 - t.tx1) / t.s1
      const cy1 = (c.vh / 2 - t.ty1) / t.s1
      c.scale = sc
      c.tx = c.vw / 2 - (cx0 + (cx1 - cx0) * e) * sc
      c.ty = c.vh / 2 - (cy0 + (cy1 - cy0) * e) * sc
      this.emit('camera', undefined)
      if (k >= 1) this.camTween = null
      else animating = true
    }

    if (this.hintGroup >= 0) {
      if (now > this.hintUntil || !this.puzzle.loose.has(this.hintGroup)) this.clearHint()
      else {
        const g = this.hintGroup
        r.hint = { dx: this.hintDest.x - this.puzzle.ox[g], dy: this.hintDest.y - this.puzzle.oy[g], pulse: 0.5 + 0.5 * Math.sin(now / 160) }
        animating = true
      }
    }

    // Lift (pick-up scale + shadow) or settle back.
    if (this.dragging.length || this.liftDown) {
      const k = this.reducedMotion ? 1 : Math.min(1, (now - this.liftT0) / 120)
      const lift = this.liftDown ? 1 - ease(k) : ease(k)
      r.lift = { x: this.grabWorld.x, y: this.grabWorld.y, scale: 1 + 0.03 * lift }
      const zs = this.dragging.map((g) => this.puzzle.z[g])
      r.shadow = zs.length ? { z: Math.min(...zs), offset: (this.target ? 4 : 8) * lift, alpha: 0.3 * lift } : null
      if (k < 1) animating = true
      else if (this.liftDown) {
        this.liftDown = false
        r.lift = null
        r.shadow = null
        r.setEffect('lift', null)
      }
    } else if (this.popGroup >= 0) {
      const k = (now - this.popT0) / 170
      if (k >= 1 || this.reducedMotion) {
        const g = this.popGroup
        this.popGroup = -1
        r.lift = null
        if (this.puzzle.members.has(g)) this.syncGroup(g)
      } else {
        const b = this.puzzle.worldBbox(this.popGroup)
        r.lift = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scale: 1 + 0.045 * Math.sin(k * Math.PI) }
        animating = true
      }
    }

    if (this.flashT0) {
      const k = (now - this.flashT0) / 280
      r.flashAlpha = k < 0 ? 0 : 0.5 * (1 - k)
      if (k >= 1) {
        this.flashT0 = 0
        r.setEffect('flash', null)
      } else animating = true
    }

    if (this.target) {
      r.targetPulse = 0.5 + 0.5 * Math.sin(now / 100)
      animating = true
    }

    if (this.revealT0) {
      const k = Math.min(1, (now - this.revealT0) / 900)
      r.revealAlpha = k < 0 ? 0 : ease(k)
      if (k < 1) animating = true
    }

    if (this.fx && (this.confetti.active || this.fxDirty)) {
      const c = this.fx.canvas
      this.fx.clearRect(0, 0, c.width, c.height)
      this.fxDirty = this.confetti.step(this.fx, now, this.camera.vh)
      if (this.fxDirty) animating = true
    }
    return animating
  }
  private fxDirty = false

  // ---------- dragging ----------

  private pickUp = (g: number, world: Vec) => {
    if (this.view.paused || this.puzzle.completed) return
    this.flushTweens()
    this.camTween = null
    if (this.hintGroup >= 0 && g !== this.hintGroup) this.clearHint()
    if (!this.puzzle.loose.has(g)) return
    const groups = this.selected.has(g) ? [...this.selected].filter((s) => this.puzzle.loose.has(s)) : [g]
    // Keep relative stacking: lift in current z order.
    groups.sort((a, b) => this.puzzle.z[a] - this.puzzle.z[b])
    if (this.puzzle.zCounter > Z_MAX - groups.length - 16) this.renumber()
    this.dragging = groups
    this.draggingSet = new Set(groups)
    this.dragStart.clear()
    for (const d of groups) {
      this.puzzle.bringToFront(d)
      this.dragStart.set(d, { x: this.puzzle.ox[d], y: this.puzzle.oy[d] })
      this.syncGroup(d)
    }
    this.grabWorld = world
    this.liftT0 = performance.now()
    this.liftDown = false
    this.renderer.setEffect('lift', groups.flatMap((d) => this.puzzle.members.get(d)!))
    sfx.pickup()
    this.renderer.requestRender()
  }

  private grabOrigin: Vec | null = null
  private dragScreen: Vec | null = null
  private autoPanT = 0

  private dragTo = (world: Vec, screen?: Vec) => {
    if (!this.dragging.length) return
    if (screen) {
      this.dragScreen = screen
      // Start the edge auto-pan loop when the pointer enters an edge zone.
      if (!this.autoPanT && this.edgeVelocity()) {
        this.autoPanT = performance.now()
        this.renderer.requestRender()
      }
    }
    if (!this.grabOrigin) this.grabOrigin = this.grabWorld
    const c = this.camera.content
    const { cw, ch } = this.grid
    const wx = Math.min(c.x1 + cw, Math.max(c.x0 - cw, world.x))
    const wy = Math.min(c.y1 + ch, Math.max(c.y0 - ch, world.y))
    const dx = wx - this.grabOrigin.x
    const dy = wy - this.grabOrigin.y
    for (const g of this.dragging) {
      const s = this.dragStart.get(g)!
      this.puzzle.ox[g] = s.x + dx
      this.puzzle.oy[g] = s.y + dy
      this.renderer.setGroupPos(g, s.x + dx, s.y + dy)
    }
    this.grabWorld = { x: wx, y: wy }
    this.previewSnap()
    this.updateBoardHint()
    this.renderer.requestRender()
  }

  /**
   * Edge auto-pan: while a piece is held near the screen edge, the table scrolls toward that
   * edge (faster the closer you get), keeping the piece under the pointer — so a piece can be
   * carried anywhere, e.g. from a far corner of the table onto the board.
   */
  private edgeVelocity(): Vec | null {
    const s = this.dragScreen
    if (!s) return null
    const { vw, vh } = this.camera
    const z = Math.min(90, Math.max(48, Math.min(vw, vh) * 0.1))
    const ramp = (d: number, zone: number) => (d < zone ? Math.pow(1 - Math.max(0, d) / zone, 1.5) : 0)
    // The top bar and the dock sit over the top/bottom edges, so those zones are deeper.
    const x = ramp(vw - s.x, z) - ramp(s.x, z)
    const y = ramp(vh - s.y, z + 50) - ramp(s.y, z + 46)
    return x || y ? { x, y } : null
  }

  private autoPan(now: number): boolean {
    if (!this.dragging.length || !this.dragScreen) {
      this.autoPanT = 0
      return false
    }
    const v = this.edgeVelocity()
    if (!v) {
      this.autoPanT = 0
      return false
    }
    const dt = Math.min(50, now - (this.autoPanT || now))
    this.autoPanT = now
    const speed = 720 // css px per second at the very edge
    const { tx, ty } = this.camera
    this.camera.panBy(-v.x * speed * dt / 1000, -v.y * speed * dt / 1000)
    if (this.camera.tx !== tx || this.camera.ty !== ty) {
      this.dragTo(this.camera.toWorld(this.dragScreen))
      this.emit('camera', undefined)
    }
    return true
  }

  private updateBoardHint() {
    const cam = this.camera
    const a = cam.toScreen({ x: 0, y: 0 })
    const b = cam.toScreen({ x: this.grid.W, y: this.grid.H })
    const visible = b.x > 0 && a.x < cam.vw && b.y > 0 && a.y < cam.vh
    if (!this.dragging.length || visible || this.puzzle.completed) {
      if (this.hintShown) {
        this.hintShown = false
        this.emit('boardHint', null)
      }
      return
    }
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    const ox = cam.vw / 2
    const oy = cam.vh / 2
    const angle = Math.atan2(cy - oy, cx - ox)
    // Where the ray from the screen centre to the board leaves the (inset) viewport.
    const ix = cam.vw / 2 - 44
    const iy = cam.vh / 2 - 96
    const t = Math.min(ix / Math.abs(Math.cos(angle) || 1e-6), iy / Math.abs(Math.sin(angle) || 1e-6))
    this.hintShown = true
    this.emit('boardHint', { x: ox + Math.cos(angle) * t, y: oy + Math.sin(angle) * t, angle })
  }
  private hintShown = false

  /** While held: highlight the neighbour (or board) the piece would snap to. */
  private previewSnap() {
    const primary = this.dragging[this.dragging.length - 1]
    const c = this.dragging.length <= 24 ? this.puzzle.bestSnap(primary, this.camera.scale) : null
    const key = c ? `${c.kind}:${c.target}` : ''
    const prev = this.target ? `${this.target.kind}:${this.target.target}` : ''
    if (key === prev) return
    this.target = c ? { kind: c.kind, target: c.target } : null
    this.renderer.boardGlow = c?.kind === 'board' ? 1 : 0
    this.renderer.setEffect('target', c?.kind === 'group' ? this.puzzle.members.get(c.target)! : null)
  }

  private drop = () => {
    const groups = this.dragging
    if (!groups.length) return
    const dropScreen = this.dragScreen ?? this.camera.toScreen(this.grabWorld)
    const pctBefore = this.puzzle.placed / this.puzzle.n
    this.dragging = []
    this.draggingSet.clear()
    this.grabOrigin = null
    this.dragScreen = null
    this.autoPanT = 0
    this.updateBoardHint()
    this.target = null
    this.renderer.boardGlow = 0
    this.renderer.setEffect('target', null)
    this.liftDown = true
    this.liftT0 = performance.now()

    const puzzle = this.puzzle
    let anyMerge = false
    let anyLock = false
    let completed = false
    const flash: number[] = []
    // Drop the grabbed group last so it wins snaps against its own selection.
    for (const g of groups) {
      if (!puzzle.members.has(g) || !puzzle.loose.has(g)) continue
      const moving = puzzle.members.get(g)!.slice()
      const res = puzzle.drop(g, this.dragStart.get(g)!, this.camera.scale)
      const final = res.group
      if (res.merged || res.locked) {
        anyMerge ||= res.merged
        anyLock ||= res.locked
        completed ||= res.completed
        flash.push(...moving)
        // Glide the dropped pieces (still mapped to their old texel) into the exact spot,
        // then relabel them on the GPU so the seam disappears.
        const to = { x: puzzle.ox[final], y: puzzle.oy[final] }
        const dur = res.lockFrom ? 420 : 110
        this.renderer.setGroupFlags(g, this.flagsOf(g) & ~GF.LIFTED)
        this.tweenGroup(g, res.start, to, dur, () => {
          for (let k = 0; k < res.relabeled.length; k += 2) this.renderer.setPieceGroup(res.relabeled[k], res.relabeled[k + 1])
          for (const e of res.joined) this.renderer.setEdgeJoined(e, 1)
          if (puzzle.members.has(final)) this.syncGroup(final)
          if (g !== final && puzzle.members.has(g)) this.syncGroup(g)
          this.renderer.requestRender()
        })
        if (final !== puzzle.boardGroup) {
          this.popGroup = final
          this.popT0 = performance.now() + dur
        }
      } else {
        this.syncGroup(g)
      }
    }
    // Keep selection pointing at surviving loose groups.
    const sel = [...this.selected]
    this.selected.clear()
    for (const s of sel) {
      const head = puzzle.pieceGroup[s]
      if (puzzle.loose.has(head)) this.selected.add(head)
    }
    for (const s of this.selected) this.syncGroup(s)
    if (sel.length) this.emitSelection()

    if (flash.length) {
      this.renderer.setEffect('flash', flash)
      this.flashT0 = performance.now() + 110
    }
    if (anyLock || anyMerge) {
      const now = performance.now()
      this.combo = now - this.lastSnapT < 4500 ? this.combo + 1 : 1
      this.lastSnapT = now
      if (this.combo > this.bestCombo) this.bestCombo = this.combo
      if (this.combo >= 2) this.emit('combo', { count: this.combo, x: dropScreen.x, y: dropScreen.y })
      if (this.hintGroup >= 0 && !this.puzzle.loose.has(this.hintGroup)) this.clearHint()
    }
    const pitch = 1 + 0.06 * Math.min(Math.max(0, this.combo - 1), 8)
    if (anyLock) {
      sfx.lock()
      if (this.haptics) navigator.vibrate?.(12)
    } else if (anyMerge) {
      sfx.snap(pitch)
      if (this.haptics) navigator.vibrate?.(8)
    } else sfx.drop()

    // Milestones (completion has its own celebration).
    const pctAfter = this.puzzle.placed / this.puzzle.n
    if (!completed)
      for (const m of [0.25, 0.5, 0.75, 0.9])
        if (pctBefore < m && pctAfter >= m) {
          this.emit('milestone', Math.round(m * 100))
          sfx.milestone()
          if (!this.reducedMotion && this.fx) {
            const b = this.camera.toScreen({ x: this.grid.W / 2, y: this.grid.H / 2 })
            this.confetti.burst(Math.min(this.camera.vw - 40, Math.max(40, b.x)), Math.min(this.camera.vh - 120, Math.max(120, b.y)), 60, 1.1)
            this.fxDirty = true
          }
        }

    this.updateContent()
    this.renderer.requestRender()
    this.emit('progress', this.stats())
    this.emit('layout', undefined)
    if (completed) void this.complete()
    else this.scheduleSave()
  }

  private renumber() {
    for (const g of this.puzzle.renumberZ()) this.syncGroup(g)
  }

  // ---------- hints ----------

  /**
   * Finds a move that works right now and shows it: the piece glows and a translucent copy
   * appears exactly where it belongs, and the camera glides to show both. Prefers pieces that
   * fit onto the board, then whatever is closest to the current view.
   */
  hint(): boolean {
    if (this.puzzle.completed || this.view.paused) return false
    this.clearHint()
    const p = this.puzzle
    const view = this.camera.toWorld({ x: this.camera.vw / 2, y: this.camera.vh / 2 })
    let best: { g: number; dest: Vec; score: number } | null = null
    const nb: number[] = []
    // Empty board: start like a real puzzler — with a corner.
    if (p.boardGroup < 0) {
      const { cols, rows } = this.grid
      const corner = [0, cols - 1, (rows - 1) * cols, cols * rows - 1].map((i) => p.pieceGroup[i]).find((g) => p.loose.has(g) && this.pickable(g))
      if (corner !== undefined) best = { g: corner, dest: { x: 0, y: 0 }, score: -1 }
    }
    if (!best) for (const g of p.loose) {
      if (!this.pickable(g)) continue
      const b = p.worldBbox(g)
      const dView = Math.hypot((b.x0 + b.x1) / 2 - view.x, (b.y0 + b.y1) / 2 - view.y)
      for (const i of p.members.get(g)!) {
        for (const q of p.neighbors(i, nb)) {
          const h = p.pieceGroup[q]
          if (h === g) continue
          let dest: Vec
          let score: number
          if (h === p.boardGroup) {
            dest = { x: 0, y: 0 }
            score = dView
          } else {
            // Show the smaller group moving to the larger one; the closest pair is easiest to follow.
            if (p.size(g) > p.size(h) || !this.pickable(h)) continue
            dest = { x: p.ox[h], y: p.oy[h] }
            score = 1e9 + Math.hypot(dest.x - p.ox[g], dest.y - p.oy[g]) + dView * 0.25
          }
          if (!best || score < best.score) best = { g, dest, score }
        }
      }
    }
    if (!best) {
      // Nothing joined yet: start with a corner (or any edge) piece on the board.
      const { cols, rows } = this.grid
      const corners = [0, cols - 1, (rows - 1) * cols, cols * rows - 1]
      const pick =
        corners.map((i) => p.pieceGroup[i]).find((g) => p.loose.has(g) && this.pickable(g)) ?? [...p.loose].find((g) => p.hasEdge[g] && this.pickable(g))
      if (pick !== undefined) best = { g: pick, dest: { x: 0, y: 0 }, score: 0 }
    }
    if (!best) {
      this.emit('hint', false)
      return false
    }
    const g = best.g
    this.hintGroup = g
    this.hintDest = best.dest
    this.hintUntil = performance.now() + 9000
    this.puzzle.bringToFront(g)
    this.syncGroup(g)
    this.renderer.setEffect('hint', p.members.get(g)!)
    this.hintsUsed++
    sfx.hint()
    const b = p.worldBbox(g)
    const m = this.grid.m
    const dx = best.dest.x - p.ox[g]
    const dy = best.dest.y - p.oy[g]
    this.glideTo({ x0: Math.min(b.x0, b.x0 + dx) - m, y0: Math.min(b.y0, b.y0 + dy) - m, x1: Math.max(b.x1, b.x1 + dx) + m, y1: Math.max(b.y1, b.y1 + dy) + m }, 260)
    this.emit('hint', true)
    this.emit('progress', this.stats())
    this.scheduleSave()
    return true
  }

  private clearHint() {
    if (this.hintGroup < 0) return
    this.hintGroup = -1
    this.renderer.hint = null
    this.renderer.setEffect('hint', null)
  }

  // ---------- selection ----------

  private toggleSelect = (g: number) => {
    if (!this.puzzle.loose.has(g)) return
    if (this.selected.has(g)) this.selected.delete(g)
    else this.selected.add(g)
    this.syncGroup(g)
    sfx.pickup()
    this.refreshSelectionEffect()
  }

  private marquee = (rect: { a: Vec; b: Vec } | null, done: boolean) => {
    if (!rect) {
      this.emit('marquee', null)
      return
    }
    const x0 = Math.min(rect.a.x, rect.b.x)
    const x1 = Math.max(rect.a.x, rect.b.x)
    const y0 = Math.min(rect.a.y, rect.b.y)
    const y1 = Math.max(rect.a.y, rect.b.y)
    if (!done) {
      const a = this.camera.toScreen({ x: x0, y: y0 })
      const b = this.camera.toScreen({ x: x1, y: y1 })
      this.emit('marquee', { x0: a.x, y0: a.y, x1: b.x, y1: b.y })
      return
    }
    this.emit('marquee', null)
    const p = this.puzzle
    const { cw, ch } = this.grid
    let added = 0
    for (const g of p.loose) {
      if (this.selected.has(g) || !this.pickable(g)) continue
      for (const i of p.members.get(g)!) {
        const cx = p.ox[g] + p.cellX(i) + cw / 2
        const cy = p.oy[g] + p.cellY(i) + ch / 2
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
          this.selected.add(g)
          this.syncGroup(g)
          added++
          break
        }
      }
    }
    if (added) sfx.pickup()
    this.refreshSelectionEffect()
  }

  selectAllLoose() {
    for (const g of this.puzzle.loose) {
      if (!this.pickable(g)) continue
      this.selected.add(g)
      this.syncGroup(g)
    }
    this.refreshSelectionEffect()
  }

  clearSelection() {
    if (!this.selected.size) return
    const sel = [...this.selected]
    this.selected.clear()
    for (const g of sel) if (this.puzzle.members.has(g)) this.syncGroup(g)
    this.refreshSelectionEffect()
  }

  private refreshSelectionEffect() {
    this.renderer.setEffect('select', this.selected.size ? [...this.selected].flatMap((g) => this.puzzle.members.get(g) ?? []) : null)
    this.emitSelection()
    this.renderer.requestRender()
  }

  private emitSelection() {
    let pieces = 0
    for (const g of this.selected) pieces += this.puzzle.size(g)
    this.emit('selection', { groups: this.selected.size, pieces })
  }

  // ---------- view toggles ----------

  setView(patch: Partial<ViewState>) {
    Object.assign(this.view, patch)
    if (patch.selectMode !== undefined) this.input.selectMode = patch.selectMode
    if (patch.paused !== undefined) {
      this.input.enabled = !patch.paused
      if (patch.paused) {
        this.input.cancel()
        this.pauseTimer()
        this.flushSave()
      } else this.resumeTimer()
    }
    if (patch.edgesOnly !== undefined || patch.zone !== undefined) {
      // Filtered-out pieces can't stay selected.
      for (const g of [...this.selected])
        if (!this.pickable(g)) {
          this.selected.delete(g)
          this.syncGroup(g)
        }
      this.refreshSelectionEffect()
    }
    this.applyView()
    this.emit('view', { ...this.view })
    this.scheduleSave()
  }

  // ---------- sorting ----------

  private items(groups: Iterable<number> = this.puzzle.loose): LayoutItem[] {
    const p = this.puzzle
    const out: LayoutItem[] = []
    for (const g of groups) {
      const b = g * 4
      out.push({ id: g, bx0: p.bbox[b], by0: p.bbox[b + 1], bx1: p.bbox[b + 2], by1: p.bbox[b + 3] })
    }
    return out
  }

  private layoutCtx(): LayoutCtx {
    return { grid: this.grid, portrait: this.camera.vw < this.camera.vh, rand: this.rand }
  }

  private applyPlacement(pl: Placement, dur = 520) {
    this.flushTweens()
    const p = this.puzzle
    for (const [g, v] of pl) {
      const from = { x: p.ox[g], y: p.oy[g] }
      p.ox[g] = Math.round(v.x * 4) / 4
      p.oy[g] = Math.round(v.y * 4) / 4
      this.tweenGroup(g, from, { x: p.ox[g], y: p.oy[g] }, dur)
    }
    p.moves++
    this.updateContent()
    // Bring the result into view if it outgrew the screen.
    const vr = this.camera.viewRect()
    const c = this.camera.content
    if (c.x0 < vr.x0 || c.y0 < vr.y0 || c.x1 > vr.x1 || c.y1 > vr.y1) this.fit()
    sfx.snap()
    this.renderer.requestRender()
    this.emit('progress', this.stats())
    this.emit('layout', undefined)
    this.scheduleSave()
  }

  private setZones(z: Zone[] | null) {
    this.zones = z
    if (!z && this.view.zone >= 0) this.setView({ zone: -1 })
    this.emit('zones', z)
  }

  sortEdgesOut() {
    this.setZones(null)
    this.applyPlacement(edgesOutLayout(this.items(), (g) => !!this.puzzle.hasEdge[g], this.layoutCtx()))
  }

  sortTidy() {
    this.setZones(null)
    this.applyPlacement(tidyLayout(this.items(), this.layoutCtx()))
  }

  sortScatter() {
    this.setZones(null)
    this.applyPlacement(scatterLayout(this.items(), this.layoutCtx()))
  }

  sortByColor() {
    const p = this.puzzle
    const groups = [...p.loose]
    if (!groups.length) return
    const pts = new Float32Array(groups.length * 3)
    groups.forEach((g, k) => {
      const m = p.members.get(g)!
      for (const i of m) for (let d = 0; d < 3; d++) pts[k * 3 + d] += this.geo.avgLab[i * 3 + d] / m.length
    })
    const k = Math.min(zoneCount(p.n), groups.length)
    const { cls, centroids } = kmeans(pts, k, this.seed)
    const groupCls = new Map<number, number>()
    const groupL = new Map<number, number>()
    groups.forEach((g, j) => {
      groupCls.set(g, cls[j])
      groupL.set(g, pts[j * 3])
      for (const i of p.members.get(g)!) {
        this.colorClass[i] = cls[j] + 1
        this.renderer.setPieceFlags(i, this.pieceFlags(i))
      }
    })
    const colors = [...Array(k).keys()].map((j) => oklabToRgb(centroids[j * 3], centroids[j * 3 + 1], centroids[j * 3 + 2]))
    const { placement, zones } = colorZonesLayout(
      this.items(groups),
      (g) => groupCls.get(g)!,
      (g) => groupL.get(g)!,
      colors,
      (g) => p.size(g),
      this.layoutCtx(),
    )
    this.setZones(zones)
    this.applyPlacement(placement, 620)
  }

  gatherSelection() {
    const groups = [...this.selected].filter((g) => this.puzzle.loose.has(g))
    if (!groups.length) return
    const at = this.camera.toWorld({ x: this.camera.vw / 2, y: this.camera.vh / 2 })
    for (const g of groups) this.puzzle.bringToFront(g)
    this.applyPlacement(gatherLayout(this.items(groups), at, this.layoutCtx()), 420)
    for (const g of groups) this.syncGroup(g)
  }

  // ---------- minimap ----------

  minimap() {
    const p = this.puzzle
    const rects: { x0: number; y0: number; x1: number; y1: number; rgb: number }[] = []
    for (const g of p.loose) {
      const r = p.worldBbox(g)
      const i = g * 3
      rects.push({ ...r, rgb: (this.geo.avgRgb[i] << 16) | (this.geo.avgRgb[i + 1] << 8) | this.geo.avgRgb[i + 2] })
    }
    return { content: this.camera.content, board: { x0: 0, y0: 0, x1: this.grid.W, y1: this.grid.H }, view: this.camera.viewRect(), rects, placed: p.placed, n: p.n }
  }

  // ---------- completion ----------

  private async complete() {
    this.pauseTimer()
    this.clearSelection()
    const elapsedMs = Math.round(this.elapsed())
    clearTimeout(this.saveTimer)
    setTimeout(() => {
      if (this.destroyed) return
      this.revealT0 = performance.now()
      this.camera.fit({ x0: 0, y0: 0, x1: this.grid.W, y1: this.grid.H })
      this.cameraChanged()
      if (!this.reducedMotion) {
        this.confetti.start(this.camera.vw, this.camera.vh)
        this.fxDirty = true
      }
      sfx.complete()
      this.renderer.requestRender()
    }, 480)
    await deleteSave(this.id)
    const rec = await recordDone(this.id, elapsedMs)
    setTimeout(() => {
      if (!this.destroyed)
        this.emit('complete', { hints: this.hintsUsed, bestCombo: this.bestCombo, elapsedMs, moves: this.puzzle.moves, total: this.puzzle.n, bestMs: rec.bestMs, isBest: rec.bestMs === elapsedMs })
    }, 1500)
  }

  // ---------- persistence ----------

  private toSave(): SaveV2 {
    return {
      v: 2,
      id: this.id,
      imageId: this.imageId,
      seed: this.seed,
      cols: this.grid.cols,
      rows: this.grid.rows,
      cw: this.grid.cw,
      ch: this.grid.ch,
      n: this.puzzle.n,
      ...this.puzzle.serialize(),
      colorClass: this.colorClass.some((c) => c) ? this.colorClass.slice().buffer : null,
      hints: this.hintsUsed,
      bestCombo: this.bestCombo,
      elapsedMs: Math.round(this.elapsed()),
      settings: {
        ghost: this.view.ghost,
        edgesOnly: this.view.edgesOnly,
        hidePlaced: this.view.hidePlaced,
        zone: this.view.zone,
        preview: this.preview,
        camera: { scale: this.camera.scale, tx: this.camera.tx, ty: this.camera.ty },
      },
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    }
  }

  setPreview(p: SaveSettings['preview']) {
    this.preview = p
    this.scheduleSave()
  }

  private scheduleSave(lazy = false) {
    if (this.puzzle.completed || this.destroyed) return
    const now = performance.now()
    if (!this.firstDirty) this.firstDirty = now
    clearTimeout(this.saveTimer)
    const wait = now - this.firstDirty > 5000 ? 0 : lazy ? 2500 : 1000
    this.saveTimer = window.setTimeout(this.flushSave, wait)
  }

  flushSave = () => {
    clearTimeout(this.saveTimer)
    this.firstDirty = 0
    if (this.puzzle.completed || this.destroyed) return
    this.flushTweens()
    void putSave(this.toSave())
  }

  async restart() {
    clearTimeout(this.saveTimer)
    this.destroyed = true
    await deleteSave(this.id)
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.input.cancel()
      this.pauseTimer()
      this.flushSave()
    } else this.resumeTimer()
  }

  private torn = false
  destroy() {
    if (this.torn) return
    this.torn = true
    this.pauseTimer()
    if (!this.destroyed) this.flushSave()
    this.destroyed = true
    clearTimeout(this.saveTimer)
    this.input.destroy()
    this.ro.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('pagehide', this.flushSave)
    this.renderer.destroy()
    this.image.bitmap.close()
    this.image.revoke?.()
    this.listeners = {}
  }
}
