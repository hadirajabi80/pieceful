import { useState } from 'react'
import { useStore } from '../app/store'
import { artUrl, CATALOG, type CatalogImage } from '../catalog/catalog'
import { Icon } from '../components/Icon'
import type { DoneRecord } from '../storage/db'
import { formatTime, percent } from '../utils/format'
import { byline, fromCatalog, recordsFor, type PuzzleImage } from './puzzleImage'

function dayHash(): number {
  const d = new Date()
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return h >>> 0
}

/** First featured artwork not yet completed; otherwise rotate daily through the whole catalog. */
export function pickFeatured(done: Record<string, DoneRecord>): CatalogImage {
  const solved = (img: CatalogImage) => recordsFor(img.id, done).length > 0
  return CATALOG.find((c) => c.featured && !solved(c)) ?? CATALOG[dayHash() % CATALOG.length]
}

export function HeroCard({ art, onPlay, onCredits }: { art: CatalogImage; onPlay: (img: PuzzleImage) => void; onCredits: () => void }) {
  const saves = useStore((s) => s.saves)
  const navigate = useStore((s) => s.navigate)
  const [loaded, setLoaded] = useState(false)

  const save = recordsFor(art.id, saves).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const pct = save ? percent(save.placed, save.total) : 0
  const title = art.title

  return (
    <section className="hero" aria-label={`Featured: ${title}`} style={{ background: art.tone }}>
      <img
        className={'hero-img' + (loaded ? ' is-loaded' : '')}
        src={artUrl(art, 'mid')}
        alt=""
        decoding="async"
        fetchPriority="high"
        onLoad={() => setLoaded(true)}
        ref={(el) => {
          if (el?.complete && el.naturalWidth && !loaded) setLoaded(true)
        }}
      />
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-body">
        <span className="hero-eyebrow">
          <Icon name="sparkle" size={14} /> {art.featured ? 'Featured' : "Today's pick"}
        </span>
        <h2 className="hero-title">{title}</h2>
        <p className="hero-by">{byline(art)}</p>

        {save && (
          <div className="hero-progress">
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress">
              <span style={{ width: pct + '%' }} />
            </div>
            <span>
              {save.total} pieces · {pct}% · {formatTime(save.elapsedMs)}
            </span>
          </div>
        )}

        <div className="hero-actions">
          {save ? (
            <>
              <button
                className="btn btn-primary btn-lg"
                onClick={() => navigate({ name: 'play', imageId: art.id, cols: save.cols, rows: save.rows })}
              >
                <Icon name="play" size={18} /> Continue
              </button>
              <button className="btn btn-glass btn-lg" onClick={() => onPlay(fromCatalog(art))}>
                New puzzle
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => onPlay(fromCatalog(art))}>
              <Icon name="play" size={18} /> Play
            </button>
          )}
          <button className="btn btn-icon btn-glass hero-info" aria-label={`About ${title}`} title="Credits" onClick={onCredits}>
            <Icon name="info" />
          </button>
        </div>
      </div>
    </section>
  )
}
