import type { UserImage } from '../storage/db'

export const MAX_SIDE = 3840

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

export async function blobToCanvas(blob: Blob, w?: number, h?: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const c = canvas(w ?? img.naturalWidth, h ?? img.naturalHeight)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Resamples any canvas to exactly w x h (used to snap the board to whole-pixel cells). */
export function resample(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  if (src.width === w && src.height === h) return src
  const c = canvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return c
}

/** crypto.randomUUID only exists in secure contexts (HTTPS / localhost); fall back on plain HTTP. */
const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q))

/** Imports a user photo: browser applies EXIF orientation; longest side capped at 1600. */
export async function importPhoto(file: File): Promise<UserImage> {
  if (file.size > 25 * 1024 * 1024) throw new Error('That photo is a bit too big (max 25 MB).')
  let full: HTMLCanvasElement
  try {
    full = await blobToCanvas(file)
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG.")
  }
  const k = Math.min(1, MAX_SIDE / Math.max(full.width, full.height))
  const w = Math.round(full.width * k)
  const h = Math.round(full.height * k)
  const main = resample(full, w, h)
  const tk = 640 / Math.max(w, h)
  const thumb = resample(main, Math.round(w * tk), Math.round(h * tk))
  return {
    id: uuid(),
    title: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My photo',
    width: w,
    height: h,
    createdAt: Date.now(),
    blob: await toBlob(main, 'image/jpeg', 0.88),
    thumb: await toBlob(thumb, 'image/jpeg', 0.82),
  }
}
