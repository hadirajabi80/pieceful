// Generates PNG app icons from public/icons/icon.svg (run: npm run icons)
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const svg = await readFile(join(dir, 'icon.svg'), 'utf8')

// Maskable: full-bleed background, art scaled into the central 80% safe zone.
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect width="512" height="512" rx="112" fill="#FBF7F2"\/>/, '')
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FBF7F2"/><g transform="translate(51.2 51.2) scale(.8)">${inner}</g></svg>`
// Apple: square (iOS applies its own mask)
const apple = svg.replace('rx="112"', 'rx="0"')

const jobs = [
  [svg, 192, 'icon-192.png'],
  [svg, 512, 'icon-512.png'],
  [maskable, 512, 'icon-maskable-512.png'],
  [apple, 180, 'apple-touch-icon-180.png'],
]
for (const [src, size, name] of jobs) {
  await sharp(Buffer.from(src), { density: 300 }).resize(size, size).png().toFile(join(dir, name))
  console.log('wrote', name)
}
