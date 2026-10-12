import { mulberry32 } from './rng'

/** Number of colour zones for a puzzle size. */
export const zoneCount = (n: number) => (n <= 150 ? 3 : n <= 500 ? 4 : n <= 1000 ? 5 : n <= 3000 ? 6 : 8)

/**
 * k-means++ in OKLab (lightness weighted 0.7). `points` is a flat [L, a, b] array.
 * Returns the class of each point and the centroids, classes ordered light → dark.
 */
export function kmeans(points: Float32Array, k: number, seed: number, iters = 20): { cls: Uint8Array; centroids: Float32Array } {
  const n = points.length / 3
  k = Math.max(1, Math.min(k, n))
  const rand = mulberry32(seed)
  const W = [0.7, 1, 1]
  const dist = (i: number, c: Float32Array, j: number) => {
    let s = 0
    for (let d = 0; d < 3; d++) {
      const v = (points[i * 3 + d] - c[j * 3 + d]) * W[d]
      s += v * v
    }
    return s
  }
  const cent = new Float32Array(k * 3)
  // k-means++ seeding
  const first = Math.floor(rand() * n)
  cent.set(points.subarray(first * 3, first * 3 + 3), 0)
  const dmin = new Float64Array(n).fill(Infinity)
  for (let j = 1; j < k; j++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      dmin[i] = Math.min(dmin[i], dist(i, cent, j - 1))
      sum += dmin[i]
    }
    let r = rand() * sum
    let pick = n - 1
    for (let i = 0; i < n; i++) {
      r -= dmin[i]
      if (r <= 0) {
        pick = i
        break
      }
    }
    cent.set(points.subarray(pick * 3, pick * 3 + 3), j * 3)
  }
  const cls = new Uint8Array(n)
  const acc = new Float64Array(k * 3)
  const cnt = new Uint32Array(k)
  for (let it = 0; it < iters; it++) {
    let changed = 0
    for (let i = 0; i < n; i++) {
      let best = 0
      let bd = Infinity
      for (let j = 0; j < k; j++) {
        const d = dist(i, cent, j)
        if (d < bd) {
          bd = d
          best = j
        }
      }
      if (cls[i] !== best) changed++
      cls[i] = best
    }
    acc.fill(0)
    cnt.fill(0)
    for (let i = 0; i < n; i++) {
      const j = cls[i]
      cnt[j]++
      for (let d = 0; d < 3; d++) acc[j * 3 + d] += points[i * 3 + d]
    }
    for (let j = 0; j < k; j++) if (cnt[j]) for (let d = 0; d < 3; d++) cent[j * 3 + d] = acc[j * 3 + d] / cnt[j]
    if (!changed && it > 0) break
  }
  // Order classes light → dark for stable, readable zones.
  const order = [...Array(k).keys()].sort((a, b) => cent[b * 3] - cent[a * 3])
  const remap = new Uint8Array(k)
  order.forEach((old, nu) => (remap[old] = nu))
  const sorted = new Float32Array(k * 3)
  order.forEach((old, nu) => sorted.set(cent.subarray(old * 3, old * 3 + 3), nu * 3))
  for (let i = 0; i < n; i++) cls[i] = remap[cls[i]]
  return { cls, centroids: sorted }
}

/** OKLab → sRGB bytes (for zone swatches). */
export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v))
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
  }) as [number, number, number]
}
