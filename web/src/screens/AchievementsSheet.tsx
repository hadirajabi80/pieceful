import { ACHIEVEMENTS, useProfile } from '../app/profile'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { formatTime } from '../utils/format'

export function AchievementsSheet({ onClose }: { onClose: () => void }) {
  const p = useProfile()
  const unlocked = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length
  const hours = p.playMs / 3_600_000

  return (
    <Sheet label="Achievements" onClose={onClose} className="sheet-wide achievements-sheet">
      <div className="ach-head">
        <span className="ach-trophy">
          <Icon name="trophy" size={26} />
        </span>
        <div>
          <h2>Achievements</h2>
          <p className="muted">
            {unlocked} of {ACHIEVEMENTS.length} unlocked
          </p>
        </div>
      </div>
      <div className="ach-progress" aria-hidden="true">
        <span style={{ width: `${(unlocked / ACHIEVEMENTS.length) * 100}%` }} />
      </div>

      <div className="ach-stats">
        <div>
          <b>{p.completed}</b>
          <span>Puzzles finished</span>
        </div>
        <div>
          <b>{p.piecesPlaced.toLocaleString()}</b>
          <span>Pieces placed</span>
        </div>
        <div>
          <b>{hours >= 1 ? `${hours.toFixed(1)} h` : formatTime(p.playMs)}</b>
          <span>Time puzzling</span>
        </div>
        <div>
          <b>{p.biggest ? p.biggest.toLocaleString() : '—'}</b>
          <span>Biggest puzzle</span>
        </div>
        <div>
          <b>{p.bestCombo > 1 ? `×${p.bestCombo}` : '—'}</b>
          <span>Best combo</span>
        </div>
        <div>
          <b>{p.daily.best || '—'}</b>
          <span>Best daily streak</span>
        </div>
      </div>

      <ul className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const at = p.achievements[a.id]
          return (
            <li key={a.id} className={'ach' + (at ? ' is-on' : '')}>
              <span className="ach-icon">
                <Icon name={at ? a.icon : 'more'} size={20} />
              </span>
              <span className="ach-text">
                <strong>{a.title}</strong>
                <span>{a.desc}</span>
              </span>
              {at ? <Icon name="check" size={16} /> : null}
            </li>
          )
        })}
      </ul>
      <div className="sheet-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Keep puzzling
        </button>
      </div>
    </Sheet>
  )
}
