import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { Sheet } from './Sheet'

export type GuideTab = 'basics' | 'moving' | 'sorting' | 'shortcuts'

const TABS: { id: GuideTab; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'moving', label: 'Moving' },
  { id: 'sorting', label: 'Sorting' },
  { id: 'shortcuts', label: 'Shortcuts' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/**
 * In-app guide: how to start, move, sort and the keyboard map.
 * Used from Home (top bar) and from Play (help button / `?`).
 */
export function GuideSheet({ onClose, initialTab = 'basics' }: { onClose: () => void; initialTab?: GuideTab }) {
  const [tab, setTab] = useState<GuideTab>(initialTab)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const uid = useId()

  const close = () => {
    onClose()
  }

  const select = (i: number) => {
    const t = TABS[(i + TABS.length) % TABS.length]
    setTab(t.id)
    tabRefs.current[TABS.indexOf(t)]?.focus()
    panelRef.current?.closest('.sheet')?.scrollTo({ top: 0 })
  }

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') select(i + 1)
    else if (e.key === 'ArrowLeft') select(i - 1)
    else if (e.key === 'Home') select(0)
    else if (e.key === 'End') select(TABS.length - 1)
    else return
    e.preventDefault()
  }

  const idx = TABS.findIndex((t) => t.id === tab)

  return (
    <Sheet label="Pieceful guide" onClose={close} className="guide sheet-wide">
      <div className="sheet-title-row">
        <div>
          <h2>How to play</h2>
          <p className="muted">A quick tour of Pieceful</p>
        </div>
        <button className="btn btn-icon" aria-label="Close guide" onClick={close}>
          <Icon name="close" />
        </button>
      </div>

      <div className="tabs guide-tabs" role="tablist" aria-label="Guide sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            id={`${uid}-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${uid}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className={'tab' + (tab === t.id ? ' is-on' : '')}
            onClick={() => select(i)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div ref={panelRef} id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="guide-panel" key={tab}>
        {tab === 'basics' && <Basics />}
        {tab === 'moving' && <Moving />}
        {tab === 'sorting' && <Sorting />}
        {tab === 'shortcuts' && <Shortcuts />}
      </div>

      <div className="sheet-actions">
        {idx > 0 && (
          <button className="btn btn-ghost" onClick={() => select(idx - 1)}>
            <Icon name="back" size={18} /> {TABS[idx - 1].label}
          </button>
        )}
        {idx < TABS.length - 1 ? (
          <button className="btn btn-primary" onClick={() => select(idx + 1)}>
            {TABS[idx + 1].label} <Icon name="chevronRight" size={18} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={close}>
            Got it
          </button>
        )}
      </div>
    </Sheet>
  )
}

/* ---------------- sections ---------------- */

function Tip({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="tip">
      <span className="tip-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="tip-body">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </li>
  )
}

function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="guide-fig">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function Basics() {
  return (
    <>
      <Figure caption="Drop a piece near its neighbour — it slides in by itself.">
        <SnapIllustration />
      </Figure>
      <ul className="tips">
        <Tip icon="book" title="Choose a picture">
          Tap any artwork on the home screen, or use your own photo — it never leaves this device.
        </Tip>
        <Tip icon="pieces" title="Pick your pieces">
          From a relaxed 100 to an epic 5000. <em>Custom</em> dials in anything from 50 up; the line underneath shows the grid
          and how big each piece will be.
        </Tip>
        <Tip icon="sparkle" title="Magnetic snapping">
          Drop a piece close to a matching neighbour and it fits exactly, no fiddling. Pieces dropped near their spot on the
          board lock in place.
        </Tip>
        <Tip icon="cloudCheck" title="Saves itself">
          Progress is saved as you go. Pick up where you left off from <em>Continue</em> on the home screen.
        </Tip>
        <Tip icon="eye" title="Need a hint?">
          <em>Ghost</em> shows the picture faintly on the board, and <em>Preview</em> opens the box lid.
        </Tip>
      </ul>
    </>
  )
}

function Moving() {
  return (
    <>
      <ul className="tips">
        <Tip icon="hand" title="Drag pieces">
          Drag with a finger or the mouse. Pieces that are joined move together as one group.
        </Tip>
        <Tip icon="sparkle" title="Feel the pull">
          While you hold a piece near its match, the match glows mint. Let go and it clicks into place.
        </Tip>
        <Tip icon="bulb" title="Stuck? Ask for a hint">
          Tap <b>Hint</b> (or press <kbd>I</kbd>): a piece that fits right now glows, and a faint copy shows exactly where it goes.
        </Tip>
        <Tip icon="fire" title="Combos & milestones">
          Snap pieces in quick succession for combos — the sound climbs with every snap. Confetti pops at 25%, 50%, 75% and 90%.
        </Tip>
        <Tip icon="map" title="Carry pieces anywhere">
          While holding a piece, move it to the edge of the screen — the table scrolls along with you. If the board is off-screen, a
          mint “Board” arrow shows which way to go.
        </Tip>
        <Tip icon="expand" title="Pan around">
          Drag the empty table, use two fingers, or hold <kbd>Space</kbd> and drag.
        </Tip>
        <Tip icon="zoomIn" title="Zoom">
          Scroll the wheel, pinch, or use the <kbd>+</kbd> <kbd>−</kbd> buttons. Double-tap or double-click the table to fit
          everything on screen.
        </Tip>
      </ul>
      <Figure caption="Draw a box to select many pieces, then drag them together.">
        <SelectIllustration />
      </Figure>
      <ul className="tips">
        <Tip icon="select" title="Select several">
          Turn on the <em>Select</em> tool, or <kbd>Shift</kbd>-drag / right-drag to draw a box. <kbd>Shift</kbd>+click
          adds or removes a single group.
        </Tip>
        <Tip icon="gather" title="Move a selection">
          Drag any selected piece and the whole selection follows. <kbd>Esc</kbd> clears it.
        </Tip>
      </ul>
    </>
  )
}

function Sorting() {
  return (
    <>
      <Figure caption="By colour sorts loose pieces into zones around the board.">
        <ZonesIllustration />
      </Figure>
      <h3 className="guide-h">Sort menu</h3>
      <ul className="tips">
        <Tip icon="frame" title="Edges out">
          Pulls every border piece into a ring around the board — the classic way to start.
        </Tip>
        <Tip icon="color" title="By colour">
          Groups pieces into coloured zones. Tap a zone’s chip to show only those pieces; tap it again to see all.
        </Tip>
        <Tip icon="grid" title="Tidy grid">
          Lines every loose piece up in neat rows, nothing overlapping.
        </Tip>
        <Tip icon="shuffle" title="Scatter">
          Spreads the pieces out again at random.
        </Tip>
        <Tip icon="gather" title="Gather selection">
          Pulls the selected pieces into one tidy pile.
        </Tip>
      </ul>
      <h3 className="guide-h">View tools</h3>
      <ul className="tips tips-compact">
        <Tip icon="eye" title="Ghost image">
          A faint copy of the picture on the board.
        </Tip>
        <Tip icon="lid" title="Preview panel">
          The box lid — move it, resize it, pinch to zoom.
        </Tip>
        <Tip icon="frame" title="Edge pieces only">
          Dims everything except border pieces.
        </Tip>
        <Tip icon="hidePlaced" title="Hide placed">
          Hides pieces already locked on the board.
        </Tip>
        <Tip icon="map" title="Minimap">
          An overview of the whole table; tap to jump there.
        </Tip>
        <Tip icon="pause" title="Pause">
          Stops the clock and covers the board.
        </Tip>
      </ul>
    </>
  )
}

const mod = isMac ? '⌘' : 'Ctrl'
const SHORTCUTS: { group: string; rows: [string[][], string][] }[] = [
  {
    group: 'Camera',
    rows: [
      [[['Space']], 'Hold to pan'],
      [[['+'], ['−']], 'Zoom in / out'],
      [[['0']], 'Actual size'],
      [[['F']], 'Fit to screen'],
    ],
  },
  {
    group: 'View',
    rows: [
      [[['G']], 'Ghost image'],
      [[['P']], 'Preview panel'],
      [[['E']], 'Edge pieces only'],
      [[['H']], 'Hide placed pieces'],
      [[['M']], 'Minimap'],
    ],
  },
  {
    group: 'Select & sort',
    rows: [
      [[['S']], 'Select mode'],
      [[[mod, 'A']], 'Select all loose pieces'],
      [[['Esc']], 'Deselect / close'],
      [[['T']], 'Tidy grid'],
      [[['Ctrl', 'Shift', 'E']], 'Edges out'],
      [[['Ctrl', 'Shift', 'C']], 'Sort by colour'],
    ],
  },
  { group: 'Help', rows: [[[['?']], 'Open this guide']] },
]

function Shortcuts() {
  return (
    <>
      <p className="guide-note muted">Keyboard shortcuts work on any device with a keyboard.</p>
      {SHORTCUTS.map((g) => (
        <section key={g.group} className="kbd-group">
          <h3 className="guide-h">{g.group}</h3>
          <table className="kbd-table">
            <tbody>
              {g.rows.map(([combos, label]) => (
                <tr key={label}>
                  <td>
                    {combos.map((keys, ci) => (
                      <span key={ci} className="kbd-combo">
                        {ci > 0 && <span className="kbd-sep">/</span>}
                        {keys.map((k, ki) => (
                          <span key={ki}>
                            {ki > 0 && <span className="kbd-plus">+</span>}
                            <kbd>{k}</kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </td>
                  <td>{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}

/* ---------------- illustrations ---------------- */

/** Puzzle piece outline: square of size s at (x,y) with a knob on the right and a blank at the bottom. */
function piece(x: number, y: number, s: number): string {
  const a = 0.36 * s
  const b = 0.64 * s
  const r = 0.17 * s
  return [
    `M${x} ${y}`,
    `H${x + s}`,
    `V${y + a}`,
    `A${r} ${r} 0 1 1 ${x + s} ${y + b}`,
    `V${y + s}`,
    `H${x + b}`,
    `A${r} ${r} 0 1 0 ${x + a} ${y + s}`,
    `H${x}`,
    'Z',
  ].join(' ')
}

/** Piece with a blank on the left (fits the knob of `piece`) and a straight bottom. */
function pieceLeftBlank(x: number, y: number, s: number): string {
  const a = 0.36 * s
  const b = 0.64 * s
  const r = 0.17 * s
  return [`M${x} ${y}`, `H${x + s}`, `V${y + s}`, `H${x}`, `V${y + b}`, `A${r} ${r} 0 1 0 ${x} ${y + a}`, 'Z'].join(' ')
}

function SnapIllustration() {
  return (
    <svg viewBox="0 0 240 110" className="ill" role="img" aria-label="A piece moving toward its matching neighbour">
      <rect x="8" y="8" width="224" height="94" rx="12" className="ill-table" />
      <rect x="34" y="22" width="132" height="66" rx="4" className="ill-slot" />
      <path d={piece(40, 28, 54)} className="ill-piece-a" />
      <path d={pieceLeftBlank(94, 28, 54)} className="ill-ghost" />
      <g className="ill-float">
        <path d={pieceLeftBlank(160, 30, 54)} className="ill-piece-b" />
        <path d={pieceLeftBlank(160, 30, 54)} className="ill-glow" />
      </g>
      <path d="M154 57 H120" className="ill-arrow" />
      <path d="M126 51 L120 57 L126 63" className="ill-arrow-head" />
    </svg>
  )
}

function SelectIllustration() {
  const sq = (x: number, y: number, cls: string, k: number) => <rect key={k} x={x} y={y} width="22" height="22" rx="4" className={cls} />
  return (
    <svg viewBox="0 0 240 110" className="ill" role="img" aria-label="A selection box around several pieces">
      <rect x="8" y="8" width="224" height="94" rx="12" className="ill-table" />
      {sq(30, 24, 'ill-p1', 1)}
      {sq(30, 64, 'ill-p3', 2)}
      {sq(198 - 10, 26, 'ill-p2', 3)}
      {sq(184, 66, 'ill-p1', 4)}
      <rect x="70" y="20" width="96" height="70" rx="6" className="ill-marquee" />
      {sq(82, 30, 'ill-p2 ill-sel', 5)}
      {sq(116, 36, 'ill-p1 ill-sel', 6)}
      {sq(92, 58, 'ill-p3 ill-sel', 7)}
      {sq(132, 60, 'ill-p2 ill-sel', 8)}
      <path d="M150 74 l0 18 l5 -5 l4 8 l3 -1.5 l-4 -8 l7 0 z" className="ill-cursor" />
    </svg>
  )
}

function ZonesIllustration() {
  const zone = (x: number, y: number, cls: string, n: number) =>
    Array.from({ length: n }, (_, i) => (
      <rect key={cls + i} x={x + (i % 3) * 13} y={y + Math.floor(i / 3) * 13} width="10" height="10" rx="2.5" className={cls} />
    ))
  return (
    <svg viewBox="0 0 240 110" className="ill" role="img" aria-label="Pieces sorted into coloured zones around the board">
      <rect x="8" y="8" width="224" height="94" rx="12" className="ill-table" />
      <rect x="86" y="30" width="68" height="50" rx="4" className="ill-slot" />
      {zone(22, 22, 'ill-z1', 9)}
      {zone(22, 66, 'ill-z2', 6)}
      {zone(176, 22, 'ill-z3', 8)}
      {zone(176, 66, 'ill-z4', 6)}
      <rect x="20" y="13" width="30" height="7" rx="3.5" className="ill-z1 ill-chip" />
      <rect x="174" y="13" width="30" height="7" rx="3.5" className="ill-z3 ill-chip" />
    </svg>
  )
}
