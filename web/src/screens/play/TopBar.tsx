import { useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { Icon } from '../../components/Icon'
import type { Game, GameStats } from '../../engine/Game'
import { formatTime, percent } from '../../utils/format'
import { Menu } from './Menu'

export function TopBar({
  game,
  stats,
  paused,
  onGuide,
  onSettings,
}: {
  game: Game
  stats: GameStats
  paused: boolean
  onGuide: () => void
  onSettings: () => void
}) {
  const navigate = useStore((s) => s.navigate)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const showTimer = useSettings((s) => s.showTimer)
  const pct = percent(stats.placed, stats.total)
  const goHome = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    navigate({ name: 'home' })
  }

  return (
    <header className="play-top glass">
      <button className="btn btn-icon" onClick={goHome} aria-label="Back to gallery" title="Back">
        <Icon name="back" />
      </button>
      <div className="play-title">
        <strong>{game.image.title}</strong>
        <span>{stats.total.toLocaleString()} pieces</span>
      </div>
      <div className="play-progress" aria-label={`${pct}% complete, ${stats.placed} of ${stats.total} pieces placed`}>
        <span className="play-progress-num">{pct}%</span>
        <span className="play-progress-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      {showTimer && (
        <span className="play-timer" aria-label="Elapsed time">
          {formatTime(game.elapsed())}
        </span>
      )}
      <button className="btn btn-icon" onClick={onGuide} aria-label="Guide" title="Guide (?)" data-tour="guide">
        <Icon name="help" />
      </button>
      <button
        className="btn btn-icon"
        onClick={() => game.setView({ paused: !paused })}
        aria-label={paused ? 'Resume' : 'Pause'}
        title={paused ? 'Resume' : 'Pause'}
        disabled={stats.completed}
      >
        <Icon name={paused ? 'play' : 'pause'} />
      </button>
      <Menu
        label="More"
        icon="more"
        align="end"
        items={[
          { icon: 'help', label: 'Guide & shortcuts', hint: '?', run: onGuide },
          { icon: 'settings', label: 'Settings', run: onSettings },
          ...(document.fullscreenEnabled
            ? [
                {
                  icon: 'expand' as const,
                  label: document.fullscreenElement ? 'Exit full screen' : 'Full screen',
                  run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
                },
              ]
            : []),
          { icon: 'restart', label: 'Start over…', run: () => setConfirmRestart(true), danger: true },
        ]}
      />
      {confirmRestart && (
        <div className="confirm-pop glass" role="alertdialog" aria-label="Start over">
          <p>Start this puzzle over? Your progress will be cleared.</p>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRestart(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                await game.restart()
                const r = useStore.getState().route
                if (r.name === 'play') navigate({ ...r, nonce: Date.now() }, true)
              }}
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
