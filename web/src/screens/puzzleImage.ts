import type { UserImageMeta } from '../app/store'
import { artUrl, catalogById, playSize, type CatalogImage } from '../catalog/catalog'
import { chooseGrid } from '../engine/layout'
import type { DoneRecord, SaveSummary } from '../storage/db'

/** Longest side user photos are imported at (raster.ts MAX_SIDE). */
const USER_MAX_SIDE = 3840

/** Anything that can be turned into a puzzle: a catalog artwork or a user photo. */
export interface PuzzleImage {
  imageId: string
  title: string
  artist?: string
  year?: string
  thumb: string
  /** width / height */
  aspect: number
  /** placeholder colour while the thumb loads */
  tone?: string
  art?: CatalogImage
  /** user photo id (without the 'user:' prefix) */
  userId?: string
}

export function fromCatalog(art: CatalogImage): PuzzleImage {
  return {
    imageId: art.id,
    title: art.title,
    artist: art.artist,
    year: art.year,
    thumb: artUrl(art, 'thumb'),
    aspect: art.width / art.height,
    tone: art.tone,
    art,
  }
}

export function fromUser(u: UserImageMeta): PuzzleImage {
  return { imageId: u.imageId, title: u.title, thumb: u.thumbUrl, aspect: u.aspect, userId: u.id }
}

/** Resolves any image id (catalog or user) to display data; undefined when it no longer exists. */
export function resolveImage(imageId: string, userImages: UserImageMeta[]): PuzzleImage | undefined {
  const art = catalogById(imageId)
  if (art) return fromCatalog(art)
  const u = userImages.find((x) => x.imageId === imageId)
  return u ? fromUser(u) : undefined
}

export const byline = (img: { artist?: string; year?: string }) => [img.artist, img.year].filter(Boolean).join(' · ')

/** Pixel width of the image the game will load for a puzzle of `count` pieces. */
export function playImageWidth(img: PuzzleImage, count: number): number {
  if (img.art) return playSize(count) === 'full' ? img.art.width : img.art.midWidth
  return Math.round(img.aspect >= 1 ? USER_MAX_SIDE : USER_MAX_SIDE * img.aspect)
}

/** Records (saves or completions) for one image, keyed by grid. */
export function recordsFor<T extends { id: string }>(imageId: string, recs: Record<string, T>): (T & { cols: number; rows: number })[] {
  const prefix = imageId + '|'
  const out: (T & { cols: number; rows: number })[] = []
  for (const r of Object.values(recs)) {
    if (!r.id.startsWith(prefix)) continue
    const m = /^(\d+)x(\d+)$/.exec(r.id.slice(prefix.length))
    if (m) out.push({ ...r, cols: +m[1], rows: +m[2] })
  }
  return out
}

/**
 * Grid for a requested piece count. If the player already has a save or completion whose grid
 * has exactly that many pieces, reuse its cols/rows so the record is found again.
 */
export function gridFor(
  img: PuzzleImage,
  n: number,
  saves: Record<string, SaveSummary>,
  done: Record<string, DoneRecord>,
): { cols: number; rows: number; count: number } {
  const known = [...recordsFor(img.imageId, saves), ...recordsFor(img.imageId, done)].find((r) => r.cols * r.rows === n)
  if (known) return { cols: known.cols, rows: known.rows, count: n }
  return chooseGrid(n, img.aspect)
}
