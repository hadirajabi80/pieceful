import { useId, useMemo, useState, type CSSProperties } from 'react'
import { resolveTable, TABLES, useSettings } from '../app/settings'
import { useStore } from '../app/store'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { MAX_PIECES, MIN_PIECES, PIECE_COUNTS } from '../engine/layout'
import { deleteSave, saveId } from '../storage/db'
import { formatTime, percent } from '../utils/format'
import { byline, gridFor, playImageWidth, recordsFor, type PuzzleImage } from './puzzleImage'

const SNAP = 40 // slider detent distance around presets

function isConstrainedDevice(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (mem !== undefined && mem <= 4) return true
  return navigator.maxTouchPoints > 0 && window.innerWidth < 900
}

function initialCount(img: PuzzleImage, saves: ReturnType<typeof useStore.getState>['saves']): { n: number; custom: boolean } {
  const latest = recordsFor(img.imageId, saves).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (latest) {
    const n = latest.cols * latest.rows
    const preset = PIECE_COUNTS.find((p) => gridFor(img, p, saves, {}).count === n)
    return preset ? { n: preset, custom: false } : { n, custom: true }
  }
  return { n: window.innerWidth < 600 ? 300 : 500, custom: false }
}

export function SetupSheet({ image, onClose }: { image: PuzzleImage; onClose: () => void }) {
  const saves = useStore((s) => s.saves)
  const done = useStore((s) => s.done)
  const navigate = useStore((s) => s.navigate)
  const theme = useStore((s) => s.theme)
  const startOptions = useStore((s) => s.startOptions)
  const setStartOptions = useStore((s) => s.setStartOptions)
  const table = useSettings((s) => s.table)
  const setSettings = useSettings((s) => s.set)

  const [init] = useState(() => initialCount(image, saves))
  const [count, setCount] = useState(init.n)
  const [custom, setCustom] = useState(init.custom)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const constrained = useMemo(isConstrainedDevice, [])
  const ids = useId()

  const grid = gridFor(image, count, saves, done)
  const id = saveId(image.imageId, grid.cols, grid.rows)
  const save = saves[id]
  const rec = done[id]
  const imgW = playImageWidth(image, grid.count)
  const piecePx = Math.round(imgW / grid.cols)

  const start = async (fresh: boolean) => {
    if (fresh && save) await deleteSave(id)
    void navigator.storage?.persist?.()
    navigate({ name: 'play', imageId: image.imageId, cols: grid.cols, rows: grid.rows })
  }

  const onSlide = (v: number) => {
    const near = PIECE_COUNTS.find((p) => Math.abs(p - v) <= SNAP)
    setCount(near ?? v)
  }

  const chipStatus = (n: number) => {
    const g = gridFor(image, n, saves, done)
    const k = saveId(image.imageId, g.cols, g.rows)
    if (saves[k]) return { kind: 'save' as const, text: `${percent(saves[k].placed, saves[k].total)}%` }
    if (done[k]) return { kind: 'done' as const, text: formatTime(done[k].bestMs) }
    return null
  }

  const swatches = [{ id: 'auto', label: 'Auto', table: '' }, ...TABLES]

  return (
    <Sheet label={`Set up ${image.title}`} onClose={onClose} className="setup">
      <div className="setup-head">
        <div className="setup-thumb" style={{ background: image.tone }}>
          <img src={image.thumb} alt="" decoding="async" />
        </div>
        <div className="setup-title">
          <h2>{image.title}</h2>
          {byline(image) && <p className="muted">{byline(image)}</p>}
          {image.art && (
            <a className="link-sm" href={image.art.sourceUrl} target="_blank" rel="noopener noreferrer">
              Credit · {image.art.license} <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
        <button className="btn btn-icon setup-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <section className="setup-section" aria-labelledby={ids + 'pc'}>
        <h3 id={ids + 'pc'} className="setup-label">
          Pieces
        </h3>
        <div className="count-chips" role="radiogroup" aria-labelledby={ids + 'pc'}>
          {PIECE_COUNTS.map((n) => {
            const st = chipStatus(n)
            const on = !custom && count === n
            return (
              <button
                key={n}
                role="radio"
                aria-checked={on}
                className={'count-chip' + (on ? ' is-on' : '')}
                onClick={() => {
                  setCustom(false)
                  setCount(n)
                }}
              >
                <span className="count-n">{n >= 1000 ? `${n / 1000}k` : n}</span>
                {st && (
                  <span className={'count-st ' + st.kind}>
                    {st.kind === 'save' ? <span className="dot" aria-hidden="true" /> : <Icon name="check" size={11} />}
                    {st.text}
                    <span className="visually-hidden">{st.kind === 'save' ? ' in progress' : ' best time'}</span>
                  </span>
                )}
              </button>
            )
          })}
          <button
            role="radio"
            aria-checked={custom}
            className={'count-chip' + (custom ? ' is-on' : '')}
            onClick={() => setCustom(true)}
          >
            <span className="count-n">Custom</span>
          </button>
        </div>

        {custom && (
          <div className="slider-row">
            <input
              type="range"
              min={MIN_PIECES}
              max={MAX_PIECES}
              step={10}
              value={count}
              list={ids + 'det'}
              aria-label="Custom piece count"
              aria-valuetext={`${grid.count} pieces`}
              onChange={(e) => onSlide(+e.target.value)}
              style={{ '--fill': `${((count - MIN_PIECES) / (MAX_PIECES - MIN_PIECES)) * 100}%` } as CSSProperties}
            />
            <datalist id={ids + 'det'}>
              {PIECE_COUNTS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <span className="slider-val">{count}</span>
          </div>
        )}

        <p className="grid-detail" aria-live="polite">
          {grid.cols} × {grid.rows} grid · {grid.count} pieces · piece ≈ {piecePx} px
        </p>

        {(save || rec) && (
          <div className="record-line">
            {save && (
              <span className="pill pill-accent">
                <Icon name="restart" size={14} /> In progress · {percent(save.placed, save.total)}% · {formatTime(save.elapsedMs)}
              </span>
            )}
            {rec && (
              <span className="pill pill-mint">
                <Icon name="timer" size={14} /> Best {formatTime(rec.bestMs)}
                {rec.count > 1 ? ` · solved ${rec.count}×` : ''}
              </span>
            )}
          </div>
        )}

        {constrained && grid.count >= 2000 && (
          <p className="note-amber" role="note">
            <Icon name="info" size={16} /> Large puzzles may be slower on this device.
          </p>
        )}
      </section>

      <section className="setup-section">
        <label className="switch-row">
          <span>
            <span className="switch-title">Start with edges sorted</span>
            <span className="switch-sub">Border pieces are laid out around the board</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={startOptions.edgeStart}
            onChange={(e) => setStartOptions({ edgeStart: e.target.checked })}
          />
        </label>
      </section>

      <section className="setup-section" aria-labelledby={ids + 'tb'}>
        <h3 id={ids + 'tb'} className="setup-label">
          Table colour
          <span className="setup-label-value">
            {table === 'auto' ? `Auto · ${resolveTable('auto', theme).label}` : resolveTable(table, theme).label}
          </span>
        </h3>
        <div className="swatches" role="radiogroup" aria-labelledby={ids + 'tb'}>
          {swatches.map((t) => {
            const on = table === t.id
            const auto = t.id === 'auto'
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={on}
                aria-label={auto ? `Auto (${resolveTable('auto', theme).label})` : t.label}
                title={auto ? 'Auto · follows light/dark' : t.label}
                className={'swatch' + (on ? ' is-on' : '') + (auto ? ' swatch-auto' : '')}
                style={auto ? undefined : { background: t.table }}
                onClick={() => setSettings({ table: t.id })}
              >
                {on && <Icon name="check" size={16} />}
              </button>
            )
          })}
        </div>
      </section>

      <div className="sheet-actions setup-actions">
        {save ? (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmRestart(true)}>
              <Icon name="restart" size={18} /> Start over
            </button>
            <button className="btn btn-primary" onClick={() => void start(false)}>
              <Icon name="play" size={18} /> Continue
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => void start(true)}>
            <Icon name="play" size={18} /> Start puzzle
          </button>
        )}
      </div>

      {confirmRestart && (
        <Sheet label="Start over" onClose={() => setConfirmRestart(false)} className="confirm">
          <h2>Start over?</h2>
          <p>Your progress on this {grid.count}-piece puzzle will be cleared.</p>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmRestart(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => void start(true)}>
              Start over
            </button>
          </div>
        </Sheet>
      )}
    </Sheet>
  )
}
