import { Icon } from '../../components/Icon'
import type { Game } from '../../engine/Game'

export function SelectionBar({ game, selection, selectMode }: { game: Game; selection: { groups: number; pieces: number }; selectMode: boolean }) {
  return (
    <div className="selection-bar glass" role="status">
      <span className="selection-count">
        <strong>{selection.pieces.toLocaleString()}</strong> {selection.pieces === 1 ? 'piece' : 'pieces'}
        {selection.groups !== selection.pieces && <span className="muted"> · {selection.groups} groups</span>}
      </span>
      <button className="btn btn-sm" onClick={() => game.gatherSelection()}>
        <Icon name="gather" size={16} /> Gather
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => game.clearSelection()}>
        Deselect
      </button>
      {selectMode && (
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            game.setView({ selectMode: false })
          }}
        >
          Done
        </button>
      )}
    </div>
  )
}
