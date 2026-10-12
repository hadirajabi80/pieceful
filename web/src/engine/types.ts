export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One interior edge shared by two neighbouring pieces. Values are in canonical edge space. */
export interface Edge {
  flip: 1 | -1
  a: number
  b: number
  c: number
  d: number
  e: number
}

export interface Edges {
  /** h[r][c] for r in 1..rows-1: horizontal edge on top of row r (normal = +y). */
  h: Edge[][]
  /** v[c][r] for c in 1..cols-1: vertical edge left of column c (normal = +x). */
  v: Edge[][]
}

export interface Grid {
  cols: number
  rows: number
  /** cell width / height in world px (integers) */
  cw: number
  ch: number
  /** board size in world px (= cols*cw, rows*ch) */
  W: number
  H: number
  /** max reach of a tab outside its cell, world px */
  m: number
}

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number]

/** Group flag bits, mirrored into the renderer's group texture. */
export const GF = {
  LOCKED: 1,
  LIFTED: 2,
  SELECTED: 4,
  TARGET: 8,
  HIDDEN: 16,
} as const

/** Output of the geometry worker (all buffers transferable). */
export interface GeometryBuffers {
  n: number
  edgeCount: number
  /** piece-local outline points (relative to the cell's top-left), x,y pairs */
  outlinePts: Float32Array
  /** prefix offsets into outlinePts, in points (n + 1) */
  outlineStart: Uint32Array
  /** interleaved fill vertices: pos f32x2, piece u16, pad u16 (stride 12) */
  fillVBO: ArrayBuffer
  fillIdx: Uint32Array
  fillStart: Uint32Array
  /** interleaved strip vertices: pos f32x2, norm f32x2, piece u16, edge u16, t u8, pad x3 (stride 24) */
  stripVBO: ArrayBuffer
  stripIdx: Uint32Array
  stripStart: Uint32Array
  /** average colour per piece in OKLab (3n) and sRGB bytes (3n) */
  avgLab: Float32Array
  avgRgb: Uint8Array
  stats: { verts: number; tris: number; ms: number }
}

export interface SaveSettings {
  ghost: boolean
  edgesOnly: boolean
  hidePlaced: boolean
  zone: number
  preview: { open: boolean; x: number; y: number; w: number } | null
  camera: { scale: number; tx: number; ty: number } | null
}

export interface SaveV2 {
  v: 2
  id: string
  imageId: string
  seed: number
  cols: number
  rows: number
  cw: number
  ch: number
  n: number
  /** Int32Array(n): piece → group id */
  pieceGroup: ArrayBuffer
  /** Float32Array(2n): origin per group id (valid for group heads) */
  origin: ArrayBuffer
  /** Uint32Array(n): z per group id */
  z: ArrayBuffer
  /** Uint8Array(n): colour class per piece (0 = none) */
  colorClass: ArrayBuffer | null
  /** hints used / best snap combo (added later; optional for older saves) */
  hints?: number
  bestCombo?: number
  boardGroup: number
  zCounter: number
  placed: number
  moves: number
  elapsedMs: number
  completed: boolean
  settings: SaveSettings
  createdAt: number
  updatedAt: number
}
