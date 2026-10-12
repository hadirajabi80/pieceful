import { useState } from 'react'
import { useStore } from '../app/store'
import { Icon } from '../components/Icon'
import { ProgressRing } from '../components/ProgressRing'
import { Sheet } from '../components/Sheet'
import { deleteImage } from '../storage/db'
import { percent } from '../utils/format'
import { byline, recordsFor, type PuzzleImage } from './puzzleImage'

export function PuzzleCard({ image, onOpen }: { image: PuzzleImage; onOpen: () => void }) {
  const saves = useStore((s) => s.saves)
  const done = useStore((s) => s.done)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const [confirm, setConfirm] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const inProgress = recordsFor(image.imageId, saves).sort((a, b) => b.updatedAt - a.updatedAt)
  const completed = recordsFor(image.imageId, done)
    .filter((d) => !saves[d.id])
    .map((d) => d.cols * d.rows)
    .sort((a, b) => a - b)
  const sub = image.userId ? 'Your photo' : byline(image)

  return (
    <div className="card-wrap">
      <button className="card" onClick={onOpen} aria-label={`${image.title}${sub ? ', ' + sub : ''}`}>
        <div className="card-thumb" style={{ background: image.tone }}>
          <img
            src={image.thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className={loaded ? 'is-loaded' : undefined}
            onLoad={() => setLoaded(true)}
            ref={(el) => {
              if (el?.complete && el.naturalWidth && !loaded) setLoaded(true)
            }}
          />
          {(inProgress.length > 0 || completed.length > 0) && (
            <span className="card-badges">
              {inProgress.slice(0, 2).map((s) => (
                <span className="chip chip-glass" key={s.id} title={`${s.total} pieces, ${percent(s.placed, s.total)}% done`}>
                  <ProgressRing value={s.placed / s.total} size={16} />
                  {s.total} · {percent(s.placed, s.total)}%
                </span>
              ))}
              {completed.slice(0, 3).map((n) => (
                <span className="chip chip-glass chip-done" key={n} title={`Solved with ${n} pieces`}>
                  <Icon name="check" size={13} />
                  {n}
                </span>
              ))}
            </span>
          )}
        </div>
        <span className="card-text">
          <span className="card-title">{image.title}</span>
          {sub && <span className="card-sub">{sub}</span>}
        </span>
      </button>
      {image.userId && (
        <button className="btn btn-icon card-more" aria-label={`Remove ${image.title}`} title="Remove photo" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={16} />
        </button>
      )}
      {confirm && (
        <Sheet label="Remove photo" onClose={() => setConfirm(false)} className="confirm">
          <h2>Remove this photo?</h2>
          <p>Its saved progress and best times go with it.</p>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await deleteImage(image.userId!)
                setConfirm(false)
                await refresh()
                toast({ text: 'Photo removed' })
              }}
            >
              Remove
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
