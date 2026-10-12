import { artUrl, catalogById } from '../../catalog/catalog'
import type { LoadProgress } from '../../engine/Game'

const MB = 1024 * 1024

export function LoadingOverlay({ imageId, pieces, progress, onCancel }: { imageId: string; pieces: number; progress: LoadProgress; onCancel: () => void }) {
  const art = catalogById(imageId)
  const { stage, done, total } = progress
  const frac = stage === 'download' ? (total ? done / total : 0) * 0.45 : stage === 'cut' ? 0.45 + (total ? done / total : 0) * 0.45 : 0.95
  const text =
    stage === 'download'
      ? total
        ? `Downloading image · ${(done / MB).toFixed(1)} / ${(total / MB).toFixed(1)} MB`
        : 'Opening image…'
      : stage === 'cut'
        ? `Cutting ${pieces.toLocaleString()} pieces · ${Math.round((total ? done / total : 0) * 100)}%`
        : 'Preparing the table…'

  return (
    <div className="loading-overlay">
      {art && <img className="loading-backdrop" src={artUrl(art, 'thumb')} alt="" style={{ background: art.tone }} />}
      <div className="loading-card glass" role="status" aria-live="polite">
        <div className="loading-piece" aria-hidden="true" />
        {art && (
          <p className="loading-title">
            {art.title} <span className="muted">· {pieces.toLocaleString()} pieces</span>
          </p>
        )}
        <div className="loading-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(frac * 100)}%` }} />
        </div>
        <p className="loading-text">{text}</p>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function Blocker({ onBack }: { onBack: () => void }) {
  return (
    <div className="loading-overlay">
      <div className="loading-card glass" role="alert">
        <h2>Your browser can’t run Pieceful</h2>
        <p className="muted">Pieceful needs WebGL2 for smooth 5000-piece puzzles. Please update your browser (Safari 15+, Chrome 56+, Firefox 51+) or enable hardware acceleration.</p>
        <button className="btn btn-primary" onClick={onBack}>
          Back to gallery
        </button>
      </div>
    </div>
  )
}
