// Downloads the public-domain artwork catalog from Wikimedia Commons (gently: one at a
// time, with pauses and Retry-After aware retries) and converts each image to WebP sizes.
//
//   node scripts/fetch-art.mjs <catalog.json> <raw-cache-dir> <output-dir> <meta-out.json>
//
// Output per image: <out>/<id>/full.webp (longest side ≤ 4096), mid.webp (≤ 2048), thumb.webp (≤ 640)
// plus <meta-out.json> with final pixel sizes and dominant colors.
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [catalogPath, rawDir, outDir, metaPath] = process.argv.slice(2)
if (!catalogPath || !rawDir || !outDir || !metaPath) {
  console.error('usage: fetch-art.mjs <catalog.json> <raw-cache-dir> <output-dir> <meta-out.json>')
  process.exit(1)
}

const UA = 'PiecefulPuzzle/2.0 (open-source jigsaw PWA; one-time asset build)'
const BASE = 'https://upload.wikimedia.org/wikipedia/commons/'
const SIZES = { full: 4096, mid: 2048, thumb: 640 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sourceUrl(c) {
  const f = encodeURIComponent(c.file)
  return c.width > 3840 ? `${BASE}thumb/${c.path}/${f}/3840px-${f}` : `${BASE}${c.path}/${f}`
}

async function download(url, dest) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (!/^image\/(jpeg|png|webp)/.test(res.headers.get('content-type') ?? '')) throw new Error('not an image: ' + url)
      await writeFile(dest, buf)
      return buf.length
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(120_000, 5000 * 2 ** (attempt - 1))
      console.log(`   ${res.status}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt})`)
      await sleep(wait)
      continue
    }
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  throw new Error('gave up: ' + url)
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
await mkdir(rawDir, { recursive: true })
await mkdir(outDir, { recursive: true })
const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : {}

let k = 0
for (const c of catalog) {
  k++
  const raw = join(rawDir, c.id + '.jpg')
  const dir = join(outDir, c.id)
  if (meta[c.id] && existsSync(join(dir, 'full.webp'))) {
    console.log(`[${k}/${catalog.length}] ${c.id} ✓ (cached)`)
    continue
  }
  if (!existsSync(raw)) {
    const bytes = await download(sourceUrl(c), raw)
    console.log(`[${k}/${catalog.length}] ${c.id} downloaded ${(bytes / 1048576).toFixed(1)} MB`)
    await sleep(2500)
  }
  await mkdir(dir, { recursive: true })
  const img = sharp(raw, { limitInputPixels: 300_000_000 }).rotate()
  const out = {}
  for (const [name, side] of Object.entries(SIZES)) {
    const info = await img
      .clone()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: name === 'thumb' ? 76 : name === 'mid' ? 80 : 90, effort: 6, smartSubsample: true })
      .toFile(join(dir, name + '.webp'))
    out[name] = [info.width, info.height, info.size]
  }
  const { channels } = await sharp(join(dir, 'thumb.webp')).stats()
  const hex = channels.slice(0, 3).map((ch) => Math.round(ch.mean).toString(16).padStart(2, '0')).join('')
  meta[c.id] = { full: out.full.slice(0, 2), mid: out.mid.slice(0, 2), tone: '#' + hex, bytes: out.full[2] }
  await writeFile(metaPath, JSON.stringify(meta, null, 1))
  console.log(`   → ${out.full[0]}×${out.full[1]} full ${(out.full[2] / 1048576).toFixed(1)} MB, mid ${(out.mid[2] / 1024).toFixed(0)} KB, thumb ${(out.thumb[2] / 1024).toFixed(0)} KB`)
}
console.log('done')
