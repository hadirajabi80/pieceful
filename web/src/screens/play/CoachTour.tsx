import { useLayoutEffect, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'

interface Step {
  icon: IconName
  title: string
  body: string
  /** data-tour target to spotlight */
  target?: string
}

const STEPS: Step[] = [
  {
    icon: 'hand',
    title: 'Drag pieces together',
    body: 'Drop a piece near its matching neighbour and it snaps exactly into place by itself — a soft glow shows the match while you hold it. Pieces near their spot on the board lock in.',
  },
  {
    icon: 'zoomIn',
    title: 'Move around the table',
    body: 'Carry a piece to the edge of the screen and the table scrolls with you — a “Board” arrow points the way. Drag the empty table to pan, pinch or scroll to zoom, double-tap to see everything.',
  },
  {
    icon: 'bulb',
    title: 'Hints when you need them',
    body: 'Tap Hint and a piece that fits right now lights up, with a ghost showing exactly where it goes. Snap quickly in a row for combos!',
    target: 'hint',
  },
  {
    icon: 'sort',
    title: 'Sort like a pro',
    body: 'Edges out puts every border piece in a ring around the board. By colour groups pieces into zones you can filter. Tidy grid lines everything up.',
    target: 'sort',
  },
  {
    icon: 'select',
    title: 'Select many at once',
    body: 'Use Select (or Shift-drag / right-drag with a mouse) to box-select pieces, then move or Gather them together.',
    target: 'select',
  },
  {
    icon: 'lid',
    title: 'Peek at the picture',
    body: 'Open the Preview — your “box lid” — and drag it anywhere. Ghost shows the image faintly on the board.',
    target: 'preview',
  },
]

/** First-run walkthrough with a spotlight on the relevant tool. */
export function CoachTour({ onDone, onOpenGuide }: { onDone: () => void; onOpenGuide: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[i]

  useLayoutEffect(() => {
    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  const last = i === STEPS.length - 1
  return (
    <div className="coach" role="dialog" aria-modal="true" aria-label="Welcome tour">
      {rect && <div className="coach-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <div className={'coach-card glass' + (rect ? ' near-dock' : '')}>
        <div className="coach-icon">
          <Icon name={step.icon} size={22} />
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="coach-dots" aria-hidden="true">
          {STEPS.map((_, k) => (
            <span key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <div className="coach-actions">
          <button className="btn btn-ghost btn-sm" onClick={onDone}>
            Skip
          </button>
          {last && (
            <button
              className="btn btn-sm"
              onClick={() => {
                onDone()
                onOpenGuide()
              }}
            >
              Full guide
            </button>
          )}
          <button className="btn btn-primary btn-sm" autoFocus onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? 'Start puzzling' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
