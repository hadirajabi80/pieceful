import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile } from '../app/profile'
import { announce } from '../app/rewards'
import { resolveTable, useSettings } from '../app/settings'
import { startMusic, stopMusic } from '../audio/music'
import { useStore } from '../app/store'
import { GuideSheet } from '../components/GuideSheet'
import type { Zone } from '../engine/layout'
import { Game, type GameStats, type LoadProgress, type ViewState } from '../engine/Game'
import { CompleteModal, type CompleteInfo } from './CompleteModal'
import { CoachTour } from './play/CoachTour'
import { Dock } from './play/Dock'
import { Blocker, LoadingOverlay } from './play/LoadingOverlay'
import { Minimap } from './play/Minimap'
import { PreviewPanel } from './play/PreviewPanel'
import { SelectionBar } from './play/SelectionBar'
import { SettingsSheet } from './play/SettingsSheet'
import { TopBar } from './play/TopBar'
import { ZoneChips } from './play/ZoneChips'

export function Play({ imageId, cols, rows }: { imageId: string; cols: number; rows: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fx = useRef<HTMLCanvasElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [progress, setProgress] = useState<LoadProgress>({ stage: 'download', done: 0, total: 0 })
  const [blocked, setBlocked] = useState(false)
  const [stats, setStats] = useState<GameStats | null>(null)
  const [view, setView] = useState<ViewState | null>(null)
  const [selection, setSelection] = useState({ groups: 0, pieces: 0 })
  const [zones, setZones] = useState<Zone[] | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [boardHint, setBoardHint] = useState<{ x: number; y: number; angle: number } | null>(null)
  const [combos, setCombos] = useState<{ id: number; count: number; x: number; y: number }[]>([])
  const [complete, setComplete] = useState<CompleteInfo | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [guide, setGuide] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [, setTick] = useState(0)

  const theme = useStore((s) => s.theme)
  const navigate = useStore((s) => s.navigate)
  const toast = useStore((s) => s.toast)
  const settings = useSettings()

  // ---- lifecycle ----
  useEffect(() => {
    let g: Game | null = null
    const ac = new AbortController()
    const edgeStart = useStore.getState().startOptions.edgeStart
    Game.create({
      wrapper: wrap.current!,
      canvas: canvas.current!,
      fxCanvas: fx.current,
      imageId,
      cols,
      rows,
      edgeStart,
      onProgress: setProgress,
      signal: ac.signal,
    })
      .then((created) => {
        if (ac.signal.aborted) return created.destroy()
        g = created
        g.on('progress', setStats)
        g.on('view', setView)
        g.on('selection', setSelection)
        g.on('zones', setZones)
        g.on('marquee', setMarquee)
        g.on('boardHint', setBoardHint)
        g.on('combo', (c) => {
          const id = performance.now()
          setCombos((list) => [...list.slice(-3), { id, ...c }])
          setTimeout(() => setCombos((list) => list.filter((x) => x.id !== id)), 1300)
          announce(useProfile.getState().recordCombo(c.count))
        })
        g.on('milestone', (pct) =>
          toast({ text: pct === 50 ? 'Halfway there! 🎉' : pct === 90 ? 'Almost done — 90%! ✨' : `${pct}% complete — keep going!` }),
        )
        g.on('hint', (ok) => {
          if (!ok) toast({ text: 'No hint right now — try showing all pieces' })
        })
        g.on('complete', (c) => {
          announce(
            useProfile.getState().recordCompletion({ imageId, cols, rows, total: c.total, elapsedMs: c.elapsedMs, hints: c.hints, bestCombo: c.bestCombo }),
          )
          setComplete({
            hints: c.hints,
            bestCombo: c.bestCombo,
            imageId,
            title: created.image.title,
            artist: created.image.artist,
            year: created.image.year,
            thumb: created.image.preview,
            cols,
            rows,
            total: c.total,
            elapsedMs: c.elapsedMs,
            moves: c.moves,
            bestMs: c.bestMs,
            isBest: c.isBest,
          })
        })
        setStats(g.stats())
        setView({ ...g.view })
        setZones(g.zones)
        setPreviewOpen(!!g.preview?.open)
        setGame(g)
        if (import.meta.env.DEV) Object.assign(window, { __game: g })
        void navigator.storage?.persist?.()
      })
      .catch((e) => {
        if (ac.signal.aborted) return
        if (e instanceof Error && e.message === 'WEBGL2_UNAVAILABLE') return setBlocked(true)
        console.error(e)
        toast({ text: e instanceof Error ? e.message : "Couldn't open that puzzle" })
        navigate({ name: 'home' }, true)
      })
    return () => {
      ac.abort()
      g?.destroy()
      void useStore.getState().refresh()
    }
  }, [imageId, cols, rows, navigate, toast])

  // ---- appearance follows theme + settings ----
  useEffect(() => {
    if (!game) return
    const cs = getComputedStyle(document.documentElement)
    game.setAppearance({
      table: resolveTable(settings.table, theme),
      accent: cs.getPropertyValue('--accent').trim() || '#E26A8A',
      mint: cs.getPropertyValue('--mint').trim() || '#3FA796',
      amber: cs.getPropertyValue('--amber').trim() || '#D99A2B',
      bevel: settings.bevel,
      ghostOpacity: settings.ghostOpacity,
      haptics: settings.haptics,
    })
  }, [game, theme, settings.table, settings.bevel, settings.ghostOpacity, settings.haptics])

  // ---- 1 Hz timer display ----
  useEffect(() => {
    if (!game || stats?.completed || view?.paused) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [game, stats?.completed, view?.paused])

  const togglePreview = useCallback(() => {
    if (!game) return
    setPreviewOpen((o) => {
      game.setPreview({ ...(game.preview ?? { x: -1, y: -1, w: 0 }), open: !o })
      return !o
    })
  }, [game])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    if (!game) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], .backdrop')) return
      const k = e.key.toLowerCase()
      const v = game.view
      const mod = e.ctrlKey || e.metaKey
      if (mod && k === 'a') {
        e.preventDefault()
        game.selectAllLoose()
      } else if (mod && e.shiftKey && k === 'e') {
        e.preventDefault()
        game.sortEdgesOut()
      } else if (mod && e.shiftKey && k === 'c') {
        e.preventDefault()
        game.sortByColor()
      } else if (mod) return
      else if (k === 'escape') {
        if (v.selectMode) game.setView({ selectMode: false })
        game.clearSelection()
      } else if (k === '+' || k === '=') game.zoom(1.25)
      else if (k === '-' || k === '_') game.zoom(0.8)
      else if (k === '0') game.zoomTo(1)
      else if (k === 'f') game.fit()
      else if (k === 'g') game.setView({ ghost: !v.ghost })
      else if (k === 'e') game.setView({ edgesOnly: !v.edgesOnly })
      else if (k === 'h') game.setView({ hidePlaced: !v.hidePlaced })
      else if (k === 's') game.setView({ selectMode: !v.selectMode })
      else if (k === 't') game.sortTidy()
      else if (k === 'p') togglePreview()
      else if (k === 'i') game.hint()
      else if (k === 'm') useSettings.getState().set({ minimap: !useSettings.getState().minimap })
      else if (k === '?' || (e.shiftKey && k === '/')) setGuide(true)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, togglePreview])

  // ---- background music (only while a puzzle is open) ----
  const muted = useStore((s) => s.muted)
  useEffect(() => {
    if (!game || !settings.music || muted) return
    startMusic()
    return () => stopMusic()
  }, [game, settings.music, muted])

  const ready = game && stats && view
  return (
    <div className="play" ref={wrap}>
      <canvas ref={canvas} className="play-gl" aria-label="Puzzle table" role="img" />
      <canvas ref={fx} className="play-fx" aria-hidden="true" />
      {marquee && (
        <div className="marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />
      )}
      {boardHint && (
        <div className="board-hint" style={{ left: boardHint.x, top: boardHint.y }} aria-hidden="true">
          <span className="board-hint-arrow" style={{ transform: `rotate(${boardHint.angle}rad)` }}>➜</span>
          Board
        </div>
      )}
      {combos.map((c) => (
        <div key={c.id} className="combo-pop" style={{ left: c.x, top: c.y }} aria-hidden="true">
          {c.count >= 5 ? '🔥 ' : ''}Combo ×{c.count}
        </div>
      ))}
      {blocked && <Blocker onBack={() => navigate({ name: 'home' })} />}
      {!game && !blocked && <LoadingOverlay imageId={imageId} pieces={cols * rows} progress={progress} onCancel={() => navigate({ name: 'home' })} />}

      {ready && (
        <>
          {zones && <ZoneChips game={game} zones={zones} active={view.zone} />}
          <TopBar
            game={game}
            stats={stats}
            paused={view.paused}
            onGuide={() => setGuide(true)}
            onSettings={() => setSettingsOpen(true)}
          />
          {selection.groups > 0 && <SelectionBar game={game} selection={selection} selectMode={view.selectMode} />}
          {!selection.groups && view.selectMode && (
            <div className="hint-pill glass" role="status">
              Drag on the table to select pieces
              <button className="btn btn-sm" onClick={() => game.setView({ selectMode: false })}>
                Done
              </button>
            </div>
          )}
          <Dock game={game} view={view} previewOpen={previewOpen} onPreview={togglePreview} hasSelection={selection.groups > 0} />
          {settings.minimap && !stats.completed && <Minimap game={game} />}
          {previewOpen && <PreviewPanel game={game} onClose={togglePreview} />}
          {view.paused && (
            <div className="pause-overlay" role="dialog" aria-label="Paused">
              <div className="pause-card glass">
                <h2>Paused</h2>
                <p className="muted">Your progress is saved.</p>
                <button className="btn btn-primary" autoFocus onClick={() => game.setView({ paused: false })}>
                  Resume
                </button>
              </div>
            </div>
          )}
          {!settings.guideSeen && <CoachTour onDone={() => settings.set({ guideSeen: true })} onOpenGuide={() => setGuide(true)} />}
        </>
      )}

      {complete && <CompleteModal info={complete} onClose={() => setComplete(null)} />}
      {guide && <GuideSheet onClose={() => setGuide(false)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
