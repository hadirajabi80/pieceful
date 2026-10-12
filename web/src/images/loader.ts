import { artUrl, catalogById, playSize } from '../catalog/catalog'
import { getImage } from '../storage/db'

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  title: string
  artist?: string
  year?: string
  /** small image URL for previews / completion (object URL for user photos) */
  thumb: string
  /** larger reference image for the preview panel */
  preview: string
  revoke?: () => void
}

/** Fetches with byte-level progress (falls back to a plain blob when the length is unknown). */
async function fetchWithProgress(url: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Couldn't download the image (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) return res.blob()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress(loaded, total)
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? 'image/webp' })
}

export async function loadPuzzleImage(
  imageId: string,
  pieces: number,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<LoadedImage> {
  if (imageId.startsWith('user:')) {
    const img = await getImage(imageId.slice(5))
    if (!img) throw new Error('Photo not found')
    const bitmap = await createImageBitmap(img.blob)
    const thumb = URL.createObjectURL(img.thumb)
    const preview = URL.createObjectURL(img.blob)
    onProgress(1, 1)
    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      title: img.title,
      thumb,
      preview,
      revoke: () => {
        URL.revokeObjectURL(thumb)
        URL.revokeObjectURL(preview)
      },
    }
  }
  const art = catalogById(imageId)
  if (!art) throw new Error('Unknown puzzle')
  const blob = await fetchWithProgress(artUrl(art, playSize(pieces)), onProgress, signal)
  const bitmap = await createImageBitmap(blob)
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    title: art.title,
    artist: art.artist,
    year: art.year,
    thumb: artUrl(art, 'thumb'),
    preview: artUrl(art, 'mid'),
  }
}

/** Tiny board-sized RGBA sample (cols*4 x rows*4) for per-piece colours. */
export function sampleColors(bitmap: ImageBitmap, cols: number, rows: number): { data: Uint8ClampedArray; w: number; h: number } {
  const w = cols * 4
  const h = rows * 4
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}
