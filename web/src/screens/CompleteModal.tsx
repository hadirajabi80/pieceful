import { useStore } from '../app/store'
import { catalogById } from '../catalog/catalog'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { chooseGrid, PIECE_COUNTS } from '../engine/layout'
import { formatTime } from '../utils/format'

export interface CompleteInfo {
  imageId: string
  title: string
  artist?: string
  year?: string
  thumb: string
  cols: number
  rows: number
  total: number
  elapsedMs: number
  moves: number
  bestMs: number
  isBest: boolean
  hints?: number
  bestCombo?: number
}

export function CompleteModal({ info, onClose }: { info: CompleteInfo; onClose: () => void }) {
  const navigate = useStore((s) => s.navigate)
  const userImages = useStore((s) => s.userImages)
  const toast = useStore((s) => s.toast)

  const art = catalogById(info.imageId)
  const user = userImages.find((u) => u.imageId === info.imageId)
  const aspect = art ? art.width / art.height : user ? user.aspect : info.cols / info.rows
  const nextCount = PIECE_COUNTS.find((n) => n > info.total)
  const nextGrid = nextCount ? chooseGrid(nextCount, aspect) : null
  const byline = [info.artist, info.year].filter(Boolean).join(' · ')
  const time = formatTime(info.elapsedMs)

  const play = (cols: number, rows: number, nonce?: number) =>
    navigate({ name: 'play', imageId: info.imageId, cols, rows, ...(nonce ? { nonce } : {}) }, true)

  const share = async () => {
    const text = `I completed ${info.title} · ${info.total} pieces in ${time} on Pieceful`
    const url = location.origin
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pieceful', text, url })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      toast({ text: 'Copied to clipboard' })
    } catch {
      toast({ text: "Couldn't share — try again" })
    }
  }

  return (
    <Sheet label="Puzzle complete" onClose={onClose} className="complete">
      <div className="complete-img" style={{ aspectRatio: String(aspect), background: art?.tone }}>
        <img src={info.thumb} alt={info.title} />
        {info.isBest && (
          <span className="chip chip-best">
            <Icon name="sparkle" size={14} /> New personal best
          </span>
        )}
      </div>
      <p className="complete-eyebrow">Finished</p>
      <h2 className="complete-title">{info.title}</h2>
      {byline && <p className="complete-by">{byline}</p>}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">
            <Icon name="timer" size={14} /> Time
          </span>
          <b>{time}</b>
          {!info.isBest && info.bestMs > 0 && <span className="stat-sub">Best {formatTime(info.bestMs)}</span>}
        </div>
        <div className="stat">
          <span className="stat-label">
            <Icon name="hand" size={14} /> Moves
          </span>
          <b>{info.moves.toLocaleString()}</b>
        </div>
        <div className="stat">
          <span className="stat-label">
            <Icon name="pieces" size={14} /> Pieces
          </span>
          <b>{info.total.toLocaleString()}</b>
          <span className="stat-sub">
            {info.cols} × {info.rows}
          </span>
        </div>
      </div>

      {(info.hints !== undefined || (info.bestCombo ?? 0) > 1) && (
        <p className="complete-extras">
          {info.hints !== undefined && (
            <span>
              <Icon name="bulb" size={15} /> {info.hints === 0 ? 'No hints used' : `${info.hints} ${info.hints === 1 ? 'hint' : 'hints'}`}
            </span>
          )}
          {(info.bestCombo ?? 0) > 1 && (
            <span>
              <Icon name="fire" size={15} /> Best combo ×{info.bestCombo}
            </span>
          )}
        </p>
      )}

      <div className="complete-actions">
        {nextGrid && (
          <button className="btn btn-primary" onClick={() => play(nextGrid.cols, nextGrid.rows)}>
            <Icon name="pieces" size={18} /> Try {nextGrid.count.toLocaleString()}
          </button>
        )}
        <button className="btn" onClick={() => play(info.cols, info.rows, Date.now())}>
          <Icon name="restart" size={18} /> Play again
        </button>
        <button className="btn" onClick={() => void share()}>
          <Icon name="share" size={18} /> Share
        </button>
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'home' })}>
          Home
        </button>
      </div>
    </Sheet>
  )
}
