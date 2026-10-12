import raw from './catalog.json'
import meta from './art-meta.json'

export type Category = 'paintings' | 'landscapes' | 'detailed' | 'japanese' | 'space'

export const CATEGORIES: { id: Category | 'all' | 'mine'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'paintings', label: 'Paintings' },
  { id: 'detailed', label: 'Masterpieces in detail' },
  { id: 'japanese', label: 'Japanese prints' },
  { id: 'landscapes', label: 'Landscapes' },
  { id: 'space', label: 'Space' },
  { id: 'mine', label: 'My photos' },
]

export interface CatalogImage {
  /** route/save id, e.g. 'art:starry-night' */
  id: string
  slug: string
  title: string
  artist: string
  year: string
  category: Category
  license: string
  /** Wikimedia Commons file page */
  sourceUrl: string
  /** pixel size of full.webp (longest side ≤ 4096) */
  width: number
  height: number
  /** pixel size of mid.webp (longest side ≤ 2048) */
  midWidth: number
  midHeight: number
  /** average colour, used as a placeholder while thumbs load */
  tone: string
  /** bytes of full.webp (for download progress hints) */
  bytes: number
  featured: boolean
}

type Meta = Record<string, { full: [number, number]; mid: [number, number]; tone: string; bytes: number }>

const FEATURED = new Set(['starry-night', 'great-wave', 'tower-babel', 'the-kiss', 'pillars', 'hunters-snow'])

export const CATALOG: CatalogImage[] = (raw as { id: string; title: string; artist: string; year: string; category: Category; file: string; license: string }[]).map((r) => {
  const m = (meta as unknown as Meta)[r.id]
  return {
    id: 'art:' + r.id,
    slug: r.id,
    title: r.title,
    artist: r.artist,
    year: r.year,
    category: r.category,
    license: r.license,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(r.file),
    width: m.full[0],
    height: m.full[1],
    midWidth: m.mid[0],
    midHeight: m.mid[1],
    tone: m.tone,
    bytes: m.bytes,
    featured: FEATURED.has(r.id),
  }
})

const byIdMap = new Map(CATALOG.map((c) => [c.id, c]))
export const catalogById = (id: string) => byIdMap.get(id)

export type ArtSize = 'thumb' | 'mid' | 'full'
export const artUrl = (img: CatalogImage, size: ArtSize) => `/art/${img.slug}/${size}.webp`

/** Always play from the 4K image for crisp pieces; fall back to 2K only on small GPUs / low-memory devices. */
export function playSize(_pieces: number, maxTexture = 4096): ArtSize {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (maxTexture < 4096 || (mem !== undefined && mem <= 2)) return 'mid'
  return 'full'
}
