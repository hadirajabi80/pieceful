import { dailyPuzzle, isDailyDone, useProfile } from '../app/profile'
import { useStore } from '../app/store'
import { artUrl } from '../catalog/catalog'
import { Icon } from '../components/Icon'
import { saveId } from '../storage/db'
import { percent } from '../utils/format'

/** Today's puzzle — the same artwork for everyone, a gentle 200 pieces, with a streak. */
export function DailyCard() {
  const navigate = useStore((s) => s.navigate)
  const saves = useStore((s) => s.saves)
  const profile = useProfile()
  const d = dailyPuzzle()
  const done = isDailyDone(profile)
  const streak = profile.streak()
  const save = saves[saveId(d.art.id, d.cols, d.rows)]
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <section className="daily" aria-labelledby="daily-h">
      <button
        className="daily-card"
        onClick={() => navigate({ name: 'play', imageId: d.art.id, cols: d.cols, rows: d.rows })}
        aria-label={`Daily puzzle: ${d.art.title}, ${d.count} pieces`}
      >
        <span className="daily-thumb" style={{ background: d.art.tone }}>
          <img src={artUrl(d.art, 'thumb')} alt="" loading="lazy" />
        </span>
        <span className="daily-text">
          <span className="daily-eyebrow">
            <Icon name="calendar" size={14} /> Daily puzzle · {date}
          </span>
          <strong id="daily-h">{d.art.title}</strong>
          <span className="daily-sub">
            {d.art.artist} · {d.count} pieces
          </span>
        </span>
        <span className="daily-side">
          {streak > 0 && (
            <span className="streak" title={`${streak}-day streak`}>
              <Icon name="fire" size={16} /> {streak}
            </span>
          )}
          <span className={'daily-cta' + (done ? ' is-done' : '')}>
            {done ? (
              <>
                <Icon name="check" size={16} /> Done
              </>
            ) : save ? (
              `Continue · ${percent(save.placed, save.total)}%`
            ) : (
              'Play today'
            )}
          </span>
        </span>
      </button>
    </section>
  )
}
