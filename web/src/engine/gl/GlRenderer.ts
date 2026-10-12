import type { Camera } from '../camera'
import { FILL_STRIDE, STRIP_STRIDE } from '../geometry'
import type { GeometryBuffers, Grid } from '../types'
import { BG_FS, BG_VS, PIECES_FS, PIECES_VS, QUAD_FS, QUAD_VS, TEX_W, Z_MAX } from './shaders'

type Rgb = [number, number, number]

export interface TableColors {
  table: Rgb
  slot: Rgb
  line: Rgb
}

export type EffectKind = 'lift' | 'select' | 'target' | 'flash' | 'hint'

interface Effect {
  fill: WebGLBuffer | null
  strip: WebGLBuffer | null
  fillCount: number
  stripCount: number
}

interface Program {
  prog: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

/** A CPU mirror of a data texture with a dirty element range. */
class DataTex<T extends Float32Array | Uint32Array | Uint8Array> {
  tex: WebGLTexture | null = null
  lo = Infinity
  hi = -1
  constructor(
    readonly data: T,
    readonly comps: number,
    readonly internal: number,
    readonly format: number,
    readonly type: number,
  ) {}
  get rows() {
    return Math.max(1, Math.ceil(this.data.length / this.comps / TEX_W))
  }
  mark(i: number) {
    if (i < this.lo) this.lo = i
    if (i > this.hi) this.hi = i
  }
  create(gl: WebGL2RenderingContext) {
    this.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, this.internal, TEX_W, this.rows, 0, this.format, this.type, this.data)
    this.lo = Infinity
    this.hi = -1
  }
  upload(gl: WebGL2RenderingContext) {
    if (this.hi < 0) return
    const r0 = Math.floor(this.lo / TEX_W)
    const r1 = Math.floor(this.hi / TEX_W)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    const per = TEX_W * this.comps
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, TEX_W, r1 - r0 + 1, this.format, this.type, this.data, r0 * per)
    this.lo = Infinity
    this.hi = -1
  }
}

const hex = (h: string): Rgb => {
  const v = parseInt(h.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
export const tableColors = (t: { table: string; slot: string; line: string }): TableColors => ({ table: hex(t.table), slot: hex(t.slot), line: hex(t.line) })

/**
 * WebGL2 renderer: one image texture, static piece meshes, and small state textures
 * (group offsets/z/flags, piece→group, piece flags, joined edges). Moving a group of any
 * size writes one texel. Nothing is drawn while idle.
 */
export class GlRenderer {
  readonly gl: WebGL2RenderingContext
  private pieces!: Program
  private bg!: Program
  private quad!: Program
  private fillVAO: WebGLVertexArrayObject | null = null
  private stripVAO: WebGLVertexArrayObject | null = null
  private fillIBO: WebGLBuffer | null = null
  private stripIBO: WebGLBuffer | null = null
  private bufs: WebGLBuffer[] = []
  private imageTex: WebGLTexture | null = null
  private groups: DataTex<Float32Array>
  private pieceGroup: DataTex<Uint32Array>
  private pieceFlags: DataTex<Uint8Array>
  private edgeJoined: DataTex<Uint8Array>
  private effects: Record<EffectKind, Effect> = {
    lift: { fill: null, strip: null, fillCount: 0, stripCount: 0 },
    select: { fill: null, strip: null, fillCount: 0, stripCount: 0 },
    target: { fill: null, strip: null, fillCount: 0, stripCount: 0 },
    flash: { fill: null, strip: null, fillCount: 0, stripCount: 0 },
    hint: { fill: null, strip: null, fillCount: 0, stripCount: 0 },
  }
  private effectPieces: Record<EffectKind, number[] | null> = { lift: null, select: null, target: null, flash: null, hint: null }
  private scheduled = false
  private lost = false
  private dpr = 1
  private cssW = 1
  private cssH = 1
  private slowFrames = 0
  private imgW = 1
  private imgH = 1

  // ---- render state (set by Game) ----
  table: TableColors = tableColors({ table: '#E9E2D6', slot: '#DFD6C8', line: '#B9AE9F' })
  accent: Rgb = hex('#E26A8A')
  mint: Rgb = hex('#3FA796')
  amber: Rgb = hex('#D99A2B')
  /** hint: offset (world px) from the hinted group to where it belongs, and a 0..1 pulse */
  hint: { dx: number; dy: number; pulse: number } | null = null
  ghostAlpha = 0
  revealAlpha = 0
  bevelStrength = 0.9
  hideMask = 16 // HIDDEN
  dimEdges = false
  zone = -1
  boardGlow = 0
  targetPulse = 0
  flashAlpha = 0
  lift: { x: number; y: number; scale: number } | null = null
  shadow: { z: number; offset: number; alpha: number } | null = null
  /** Called at the start of every frame; return true to keep animating. */
  onFrame?: (now: number) => boolean
  onContextRestored?: () => void

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly grid: Grid,
    private geo: GeometryBuffers,
    private image: TexImageSource,
    private camera: Camera,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WEBGL2_UNAVAILABLE')
    this.gl = gl
    const n = geo.n
    this.groups = new DataTex(new Float32Array(Math.ceil(n / TEX_W) * TEX_W * 4), 4, gl.RGBA32F, gl.RGBA, gl.FLOAT)
    this.pieceGroup = new DataTex(new Uint32Array(Math.ceil(n / TEX_W) * TEX_W), 1, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT)
    this.pieceFlags = new DataTex(new Uint8Array(Math.ceil(n / TEX_W) * TEX_W), 1, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE)
    this.edgeJoined = new DataTex(new Uint8Array(Math.max(1, Math.ceil(geo.edgeCount / TEX_W)) * TEX_W), 1, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.init()
  }

  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2')
    } catch {
      return false
    }
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
  }

  // ---------- setup ----------

  private init() {
    const gl = this.gl
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.pieces = this.program(PIECES_VS, PIECES_FS, [
      'u_cam', 'u_view', 'u_board', 'u_tex', 'u_zMax', 'u_stripW', 'u_offset', 'u_zOverride', 'u_zBias', 'u_lift', 'u_hideMask',
      'u_groups', 'u_pieceGroup', 'u_pieceFlags', 'u_edgeJoined', 'u_image', 'u_mode', 'u_table', 'u_accent', 'u_bevelFade',
      'u_bevelStrength', 'u_dimEdges', 'u_zone', 'u_alpha', 'u_texel', 'u_sharpen',
    ])
    this.bg = this.program(BG_VS, BG_FS, ['u_view', 'u_dpr', 'u_cam', 'u_table', 'u_slot', 'u_line', 'u_glow', 'u_board', 'u_boardGlow', 'u_showSlot'])
    this.quad = this.program(QUAD_VS, QUAD_FS, ['u_cam', 'u_view', 'u_board', 'u_image', 'u_alpha', 'u_uvMax'])

    const geo = this.geo
    // Fill: pos f32x2 @0, piece u16 @8
    const fillVBO = this.buffer(gl.ARRAY_BUFFER, geo.fillVBO)
    this.fillIBO = this.buffer(gl.ELEMENT_ARRAY_BUFFER, geo.fillIdx)
    this.fillVAO = gl.createVertexArray()
    gl.bindVertexArray(this.fillVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, fillVBO)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FILL_STRIDE, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, FILL_STRIDE, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIBO)
    gl.bindVertexArray(null)

    // Strip: pos f32x2 @0, norm f32x2 @8, piece u16 @16, edge u16 @18, t u8n @20
    const stripVBO = this.buffer(gl.ARRAY_BUFFER, geo.stripVBO)
    this.stripIBO = this.buffer(gl.ELEMENT_ARRAY_BUFFER, geo.stripIdx)
    this.stripVAO = gl.createVertexArray()
    gl.bindVertexArray(this.stripVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, stripVBO)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIP_STRIDE, 0)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIP_STRIDE, 8)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, STRIP_STRIDE, 16)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_SHORT, STRIP_STRIDE, 18)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 1, gl.UNSIGNED_BYTE, true, STRIP_STRIDE, 20)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.stripIBO)
    gl.bindVertexArray(null)

    // Image
    this.imageTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.image)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    this.imgW = (this.image as { width: number }).width
    this.imgH = (this.image as { height: number }).height

    for (const t of [this.groups, this.pieceGroup, this.pieceFlags, this.edgeJoined]) t.create(gl)
    for (const k of Object.keys(this.effects) as EffectKind[]) {
      this.effects[k] = { fill: gl.createBuffer(), strip: gl.createBuffer(), fillCount: 0, stripCount: 0 }
      if (this.effectPieces[k]) this.setEffect(k, this.effectPieces[k])
    }
    this.requestRender()
  }

  private program(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('Shader: ' + gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Link: ' + gl.getProgramInfoLog(prog))
    const u: Program['u'] = {}
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name)
    return { prog, u }
  }

  private buffer(target: number, data: ArrayBuffer | ArrayBufferView): WebGLBuffer {
    const gl = this.gl
    const b = gl.createBuffer()!
    gl.bindBuffer(target, b)
    gl.bufferData(target, data, gl.STATIC_DRAW)
    this.bufs.push(b)
    return b
  }

  // ---------- state ----------

  setGroup(g: number, x: number, y: number, z: number, flags: number) {
    const d = this.groups.data
    d[g * 4] = x
    d[g * 4 + 1] = y
    d[g * 4 + 2] = z
    d[g * 4 + 3] = flags
    this.groups.mark(g)
  }

  setGroupPos(g: number, x: number, y: number) {
    const d = this.groups.data
    if (d[g * 4] === Math.fround(x) && d[g * 4 + 1] === Math.fround(y)) return
    d[g * 4] = x
    d[g * 4 + 1] = y
    this.groups.mark(g)
  }

  setGroupZ(g: number, z: number) {
    this.groups.data[g * 4 + 2] = z
    this.groups.mark(g)
  }

  groupFlags(g: number) {
    return this.groups.data[g * 4 + 3]
  }

  setGroupFlags(g: number, flags: number) {
    if (this.groups.data[g * 4 + 3] === flags) return
    this.groups.data[g * 4 + 3] = flags
    this.groups.mark(g)
  }

  groupPos(g: number): [number, number] {
    return [this.groups.data[g * 4], this.groups.data[g * 4 + 1]]
  }

  setPieceGroup(p: number, g: number) {
    this.pieceGroup.data[p] = g
    this.pieceGroup.mark(p)
  }

  setPieceFlags(p: number, f: number) {
    this.pieceFlags.data[p] = f
    this.pieceFlags.mark(p)
  }

  setEdgeJoined(e: number, v: number) {
    this.edgeJoined.data[e] = v
    this.edgeJoined.mark(e)
  }

  /** Builds a subset index buffer (fill + strip) for the given pieces. */
  setEffect(kind: EffectKind, pieces: number[] | null) {
    this.effectPieces[kind] = pieces
    const fx = this.effects[kind]
    if (!pieces || !pieces.length) {
      fx.fillCount = fx.stripCount = 0
      this.requestRender()
      return
    }
    const { fillIdx, fillStart, stripIdx, stripStart } = this.geo
    let nf = 0
    let ns = 0
    for (const p of pieces) {
      nf += fillStart[p + 1] - fillStart[p]
      ns += stripStart[p + 1] - stripStart[p]
    }
    const f = new Uint32Array(nf)
    const s = new Uint32Array(ns)
    let a = 0
    let b = 0
    for (const p of pieces) {
      f.set(fillIdx.subarray(fillStart[p], fillStart[p + 1]), a)
      a += fillStart[p + 1] - fillStart[p]
      s.set(stripIdx.subarray(stripStart[p], stripStart[p + 1]), b)
      b += stripStart[p + 1] - stripStart[p]
    }
    const gl = this.gl
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fx.fill)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, f, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fx.strip)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, s, gl.DYNAMIC_DRAW)
    fx.fillCount = nf
    fx.stripCount = ns
    this.requestRender()
  }

  resize(w: number, h: number, dpr: number) {
    this.cssW = Math.max(1, w)
    this.cssH = Math.max(1, h)
    this.dpr = dpr
    this.canvas.width = Math.round(this.cssW * dpr)
    this.canvas.height = Math.round(this.cssH * dpr)
    this.requestRender()
  }

  // ---------- frame loop ----------

  requestRender = () => {
    if (this.scheduled || this.lost) return
    this.scheduled = true
    requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.scheduled = false
    if (this.lost) return
    const t = performance.now()
    const animating = this.onFrame?.(now) ?? false
    this.draw()
    const cost = performance.now() - t
    this.slowFrames = cost > 18 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1)
    if (animating) this.requestRender()
  }

  get struggling() {
    return this.slowFrames > 8
  }

  private draw() {
    const gl = this.gl
    const cam = this.camera
    const { W, H, cw, ch } = this.grid
    for (const t of [this.groups, this.pieceGroup, this.pieceFlags, this.edgeJoined]) t.upload(gl)

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(this.table.table[0], this.table.table[1], this.table.table[2], 1)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // 1. table
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.useProgram(this.bg.prog)
    let u = this.bg.u
    gl.uniform2f(u.u_view, this.cssW, this.cssH)
    gl.uniform1f(u.u_dpr, this.dpr)
    gl.uniform3f(u.u_cam, cam.scale, cam.tx, cam.ty)
    gl.uniform3fv(u.u_table, this.table.table)
    gl.uniform3fv(u.u_slot, this.table.slot)
    gl.uniform3fv(u.u_line, this.table.line)
    gl.uniform3fv(u.u_glow, this.mint)
    gl.uniform2f(u.u_board, W, H)
    gl.uniform1f(u.u_boardGlow, this.boardGlow)
    gl.uniform1f(u.u_showSlot, this.revealAlpha < 1 ? 1 : 0)
    gl.bindVertexArray(null)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2. ghost
    if (this.ghostAlpha > 0 && this.revealAlpha < 1) this.drawQuad(this.ghostAlpha)

    // 3. pieces
    gl.useProgram(this.pieces.prog)
    u = this.pieces.u
    gl.uniform3f(u.u_cam, cam.scale, cam.tx, cam.ty)
    gl.uniform2f(u.u_view, this.cssW, this.cssH)
    gl.uniform2f(u.u_board, W, H)
    gl.uniform2f(u.u_tex, 1 / W, 1 / H)
    gl.uniform1f(u.u_zMax, Z_MAX)
    gl.uniform2f(u.u_offset, 0, 0)
    gl.uniform1f(u.u_zOverride, -1)
    gl.uniform1f(u.u_zBias, 0)
    if (this.lift) gl.uniform4f(u.u_lift, this.lift.x, this.lift.y, this.lift.scale, 1)
    else gl.uniform4f(u.u_lift, 0, 0, 1, 0)
    gl.uniform1ui(u.u_hideMask, this.hideMask)
    gl.uniform3fv(u.u_table, this.table.table)
    gl.uniform3fv(u.u_accent, this.accent)
    gl.uniform1f(u.u_bevelStrength, this.bevelStrength)
    gl.uniform1f(u.u_dimEdges, this.dimEdges ? 1 : 0)
    gl.uniform1i(u.u_zone, this.zone)
    gl.uniform2f(u.u_texel, 1 / this.imgW, 1 / this.imgH)
    // Screen pixels per image texel: sharpen only when the image is magnified.
    const pxPerTexel = (cam.scale * this.dpr * W) / this.imgW
    gl.uniform1f(u.u_sharpen, pxPerTexel > 1.15 && !this.struggling ? Math.min(0.35, (pxPerTexel - 1) * 0.3) : 0)
    this.bindTextures(u)

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)

    // 3a. fills (disabled strip attributes get constants)
    gl.bindVertexArray(this.fillVAO)
    gl.vertexAttrib2f(2, 0, 0)
    gl.vertexAttribI4ui(3, 0xffff, 0, 0, 0)
    gl.vertexAttrib1f(4, 0)
    gl.uniform1i(u.u_mode, 0)
    gl.uniform1f(u.u_stripW, 0)
    gl.drawElements(gl.TRIANGLES, this.geo.fillIdx.length, gl.UNSIGNED_INT, 0)

    // 3b. bevel (skipped when it would be sub-pixel)
    const L = Math.min(cw, ch)
    const bevelW = Math.min(7, Math.max(1.5, 0.07 * L))
    const bevelPx = bevelW * cam.scale
    if (bevelPx >= 0.6 && !this.struggling) {
      gl.bindVertexArray(this.stripVAO)
      gl.uniform1i(u.u_mode, 1)
      gl.uniform1f(u.u_stripW, bevelW)
      gl.uniform1f(u.u_bevelFade, Math.min(1, (bevelPx - 0.6) / 1.2))
      gl.drawElements(gl.TRIANGLES, this.geo.stripIdx.length, gl.UNSIGNED_INT, 0)
    }

    // 4. effects (blended, no depth writes)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)

    const lift = this.effects.lift
    if (this.shadow && lift.fillCount) {
      const off = this.shadow.offset / cam.scale
      gl.uniform2f(u.u_offset, off * 0.65, off)
      gl.uniform1f(u.u_zOverride, this.shadow.z - 0.5)
      gl.uniform1i(u.u_mode, 2)
      gl.uniform1f(u.u_alpha, this.shadow.alpha)
      this.drawEffectFill(lift)
      this.drawEffectStrip(lift, -Math.max(4, 12 / cam.scale))
      gl.uniform2f(u.u_offset, 0, 0)
      gl.uniform1f(u.u_zOverride, -1)
    }

    const sel = this.effects.select
    if (sel.stripCount) {
      gl.uniform1i(u.u_mode, 3)
      gl.uniform3fv(u.u_accent, this.accent)
      gl.uniform1f(u.u_alpha, 0.95)
      gl.uniform1f(u.u_zBias, 0.25)
      this.drawEffectStrip(sel, -3 / cam.scale)
      gl.uniform1f(u.u_zBias, 0)
    }

    const tgt = this.effects.target
    if (tgt.stripCount) {
      gl.uniform1i(u.u_mode, 3)
      gl.uniform3fv(u.u_accent, this.mint)
      gl.uniform1f(u.u_alpha, 0.55 + 0.4 * this.targetPulse)
      gl.uniform1f(u.u_zBias, 0.25)
      this.drawEffectStrip(tgt, -4 / cam.scale)
      gl.uniform1f(u.u_zBias, 0)
    }

    const hf = this.effects.hint
    if (this.hint && hf.fillCount) {
      const pulse = this.hint.pulse
      // glow around the hinted piece
      gl.uniform1i(u.u_mode, 3)
      gl.uniform3fv(u.u_accent, this.amber)
      gl.uniform1f(u.u_alpha, 0.55 + 0.45 * pulse)
      gl.uniform1f(u.u_zBias, 0.25)
      this.drawEffectStrip(hf, -6 / cam.scale)
      gl.uniform1f(u.u_zBias, 0)
      // translucent silhouette where it belongs, drawn above everything
      gl.uniform2f(u.u_offset, this.hint.dx, this.hint.dy)
      gl.uniform1f(u.u_zOverride, Z_MAX - 1)
      gl.uniform1i(u.u_mode, 5)
      gl.uniform1f(u.u_alpha, 0.35 + 0.3 * pulse)
      this.drawEffectFill(hf)
      gl.uniform1i(u.u_mode, 3)
      gl.uniform1f(u.u_alpha, 0.9)
      this.drawEffectStrip(hf, -3 / cam.scale)
      gl.uniform2f(u.u_offset, 0, 0)
      gl.uniform1f(u.u_zOverride, -1)
    }

    const fl = this.effects.flash
    if (fl.fillCount && this.flashAlpha > 0) {
      gl.uniform1i(u.u_mode, 4)
      gl.uniform1f(u.u_alpha, this.flashAlpha)
      gl.uniform1f(u.u_zBias, 0.25)
      this.drawEffectFill(fl)
      gl.uniform1f(u.u_zBias, 0)
    }
    gl.depthMask(true)

    // 5. completion reveal: the clean image over the solved board
    if (this.revealAlpha > 0) {
      gl.disable(gl.DEPTH_TEST)
      this.drawQuad(this.revealAlpha)
    }
    gl.bindVertexArray(null)
  }

  private drawEffectStrip(fx: Effect, width: number) {
    const gl = this.gl
    gl.bindVertexArray(this.stripVAO)
    gl.uniform1f(this.pieces.u.u_stripW, width)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fx.strip)
    gl.drawElements(gl.TRIANGLES, fx.stripCount, gl.UNSIGNED_INT, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.stripIBO)
  }

  /** Effect fills reuse the fill VAO with their own element buffer. */
  private drawEffectFill(fx: Effect) {
    const gl = this.gl
    gl.bindVertexArray(this.fillVAO)
    gl.vertexAttrib2f(2, 0, 0)
    gl.vertexAttribI4ui(3, 0xffff, 0, 0, 0)
    gl.vertexAttrib1f(4, 0)
    gl.uniform1f(this.pieces.u.u_stripW, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fx.fill)
    gl.drawElements(gl.TRIANGLES, fx.fillCount, gl.UNSIGNED_INT, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIBO)
  }

  private bindTextures(u: Program['u']) {
    const gl = this.gl
    const bind = (unit: number, tex: WebGLTexture | null, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(loc, unit)
    }
    bind(0, this.imageTex, u.u_image)
    bind(1, this.groups.tex, u.u_groups)
    bind(2, this.pieceGroup.tex, u.u_pieceGroup)
    bind(3, this.pieceFlags.tex, u.u_pieceFlags)
    bind(4, this.edgeJoined.tex, u.u_edgeJoined)
  }

  private drawQuad(alpha: number) {
    const gl = this.gl
    const cam = this.camera
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(this.quad.prog)
    const u = this.quad.u
    gl.uniform3f(u.u_cam, cam.scale, cam.tx, cam.ty)
    gl.uniform2f(u.u_view, this.cssW, this.cssH)
    gl.uniform2f(u.u_board, this.grid.W, this.grid.H)
    gl.uniform1f(u.u_alpha, alpha)
    gl.uniform2f(u.u_uvMax, 1, 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.uniform1i(u.u_image, 0)
    gl.bindVertexArray(null)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.BLEND)
  }

  // ---------- lifecycle ----------

  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
  }

  private onRestored = () => {
    this.lost = false
    this.bufs = []
    this.init()
    // Mirrors still hold the latest state; init() re-created the textures from them.
    this.onContextRestored?.()
    this.requestRender()
  }

  destroy() {
    const gl = this.gl
    this.onFrame = undefined
    this.lost = true
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    for (const b of this.bufs) gl.deleteBuffer(b)
    for (const fx of Object.values(this.effects)) {
      gl.deleteBuffer(fx.fill)
      gl.deleteBuffer(fx.strip)
    }
    for (const t of [this.groups, this.pieceGroup, this.pieceFlags, this.edgeJoined]) gl.deleteTexture(t.tex)
    gl.deleteTexture(this.imageTex)
    gl.deleteVertexArray(this.fillVAO)
    gl.deleteVertexArray(this.stripVAO)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
