import { useState } from 'react'
import { useStore } from '../app/store'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { deleteSave, type SaveSummary } from '../storage/db'
import { formatTime, percent } from '../utils/format'
import { resolveImage, type PuzzleImage } from './puzzleImage'

interface Item {
  save: SaveSummary
  img: PuzzleImage
}

export function ContinueRow() {
  const saves = useStore((s) => s.saves)
  const userImages = useStore((s) => s.userImages)
  const navigate = useStore((s) => s.navigate)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const [menu, setMenu] = useState<Item | null>(null)

  const items: Item[] = Object.values(saves)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((save) => ({ save, img: resolveImage(save.imageId, userImages) }))
    .filter((x): x is Item => !!x.img)

  if (!items.length) return null

  const play = (s: SaveSummary, nonce?: number) => navigate({ name: 'play', imageId: s.imageId, cols: s.cols, rows: s.rows, nonce })

  return (
    <section className="continue" aria-labelledby="continue-h">
      <div className="section-head">
        <h2 id="continue-h">Continue</h2>
        <span className="muted">{items.length === 1 ? '1 puzzle' : `${items.length} puzzles`} in progress</span>
      </div>
      <ul className="continue-row" role="list">
        {items.map(({ save, img }) => {
          const pct = percent(save.placed, save.total)
          return (
            <li key={save.id} className="continue-item">
              <button
                className="continue-card"
                onClick={() => play(save)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ save, img })
                }}
                aria-label={`Continue ${img.title}, ${save.total} pieces, ${pct}% done`}
              >
                <span className="continue-thumb" style={{ background: img.tone }}>
                  <img src={img.thumb} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="continue-title">{img.title}</span>
                <span className="continue-meta">
                  <span>{save.total} pcs</span>
                  <span>{pct}%</span>
                </span>
                <span className="bar bar-sm" aria-hidden="true">
                  <span style={{ width: pct + '%' }} />
                </span>
                <span className="continue-time">
                  <Icon name="timer" size={13} /> {formatTime(save.elapsedMs)}
                </span>
              </button>
              <button
                className="btn btn-icon continue-more"
                aria-label={`More options for ${img.title}`}
                onClick={() => setMenu({ save, img })}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            </li>
          )
        })}
      </ul>

      {menu && (
        <Sheet label={`Options for ${menu.img.title}`} onClose={() => setMenu(null)} className="confirm">
          <h2>{menu.img.title}</h2>
          <p>
            {menu.save.total} pieces · {percent(menu.save.placed, menu.save.total)}% · {formatTime(menu.save.elapsedMs)}
          </p>
          <div className="sheet-actions sheet-actions-stack">
            <button className="btn btn-primary" onClick={() => play(menu.save)}>
              <Icon name="play" size={18} /> Continue
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await deleteSave(menu.save.id)
                play(menu.save, Date.now())
              }}
            >
              <Icon name="restart" size={18} /> Start over
            </button>
            <button
              className="btn btn-ghost btn-danger-text"
              onClick={async () => {
                await deleteSave(menu.save.id)
                setMenu(null)
                await refresh()
                toast({ text: 'Progress removed' })
              }}
            >
              <Icon name="trash" size={18} /> Remove progress
            </button>
          </div>
        </Sheet>
      )}
    </section>
  )
}
