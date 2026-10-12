import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore, type CategoryFilter } from '../app/store'
import { CATALOG, CATEGORIES } from '../catalog/catalog'
import { GuideSheet } from '../components/GuideSheet'
import { Icon } from '../components/Icon'
import { ContinueRow } from './ContinueRow'
import { CreditsSheet } from './CreditsSheet'
import { HeroCard, pickFeatured } from './HeroCard'
import { PuzzleCard } from './PuzzleCard'
import { fromCatalog, fromUser, type PuzzleImage } from './puzzleImage'
import { SetupSheet } from './SetupSheet'
import { UploadCard } from './UploadCard'
import { AchievementsSheet } from './AchievementsSheet'
import { DailyCard } from './DailyCard'

export function Home() {
  const userImages = useStore((s) => s.userImages)
  const done = useStore((s) => s.done)
  const category = useStore((s) => s.category)
  const setCategory = useStore((s) => s.setCategory)
  const refresh = useStore((s) => s.refresh)

  const [setup, setSetup] = useState<PuzzleImage | null>(null)
  const [credits, setCredits] = useState<{ focusId?: string } | null>(null)
  const [guide, setGuide] = useState(false)
  const [trophies, setTrophies] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const featured = useMemo(() => pickFeatured(done), [done])

  const mine = userImages.map(fromUser)
  const art = (category === 'all' ? CATALOG : CATALOG.filter((c) => c.category === category)).map(fromCatalog)
  const showUpload = category === 'all' || category === 'mine'
  const items = category === 'mine' ? mine : category === 'all' ? [...mine, ...art] : art

  return (
    <div className="home">
      <TopBar onGuide={() => setGuide(true)} onTrophies={() => setTrophies(true)} />

      <main className="home-main">
        <HeroCard art={featured} onPlay={setSetup} onCredits={() => setCredits({ focusId: featured.id })} />

        <DailyCard />

        <ContinueRow />

        <section className="library" aria-labelledby="library-h">
          <div className="section-head">
            <h2 id="library-h">Gallery</h2>
            <span className="muted">{CATALOG.length} masterpieces, ready to play</span>
          </div>
          <CategoryTabs value={category} onChange={setCategory} mineCount={userImages.length} />
          <div className="grid" id="gallery-panel" role="tabpanel" aria-labelledby={`cat-${category}`}>
            {showUpload && <UploadCard onImported={(img) => setSetup(img)} />}
            {items.map((img) => (
              <PuzzleCard key={img.imageId} image={img} onOpen={() => setSetup(img)} />
            ))}
          </div>
          {category === 'mine' && mine.length === 0 && (
            <p className="empty-note muted">Your photos appear here. They're stored only on this device.</p>
          )}
        </section>
      </main>

      <footer className="home-footer">
        <p>
          Artwork: public-domain masterpieces from Wikimedia Commons, and NASA/ESA space imagery.{' '}
          <button className="link-btn" onClick={() => setCredits({})}>
            Credits
          </button>
        </p>
      </footer>

      {setup && <SetupSheet image={setup} onClose={() => setSetup(null)} />}
      {credits && <CreditsSheet focusId={credits.focusId} onClose={() => setCredits(null)} />}
      {guide && <GuideSheet onClose={() => setGuide(false)} />}
      {trophies && <AchievementsSheet onClose={() => setTrophies(false)} />}
    </div>
  )
}

function TopBar({ onGuide, onTrophies }: { onGuide: () => void; onTrophies: () => void }) {
  const themePref = useStore((s) => s.themePref)
  const muted = useStore((s) => s.muted)
  const cycleTheme = useStore((s) => s.cycleTheme)
  const toggleMute = useStore((s) => s.toggleMute)
  const themeLabel = themePref === 'system' ? 'Auto' : themePref === 'light' ? 'Light' : 'Dark'

  return (
    <header className="topbar glass">
      <div className="topbar-inner">
        <h1 className="brand">
          <img src="/icons/icon.svg" alt="" width={32} height={32} />
          <span>Pieceful</span>
        </h1>
        <div className="topbar-actions">
          <button className="btn btn-icon" onClick={onTrophies} aria-label="Achievements and stats" title="Achievements">
            <Icon name="trophy" />
          </button>
          <button className="btn btn-ghost btn-sm guide-btn" onClick={onGuide} aria-label="Open the guide">
            <Icon name="help" size={18} />
            <span className="guide-btn-label">Guide</span>
          </button>
          <button
            className="btn btn-icon"
            onClick={cycleTheme}
            aria-label={`Theme: ${themeLabel}. Switch theme`}
            title={`Theme: ${themeLabel}`}
          >
            <Icon name={themePref === 'system' ? 'auto' : themePref === 'light' ? 'sun' : 'moon'} />
          </button>
          <button
            className="btn btn-icon"
            onClick={toggleMute}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound off' : 'Sound on'}
          >
            <Icon name={muted ? 'mute' : 'volume'} />
          </button>
        </div>
      </div>
    </header>
  )
}

function CategoryTabs({ value, onChange, mineCount }: { value: CategoryFilter; onChange: (c: CategoryFilter) => void; mineCount: number }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = Math.max(0, CATEGORIES.findIndex((c) => c.id === value))

  // Keep the active tab visible inside the horizontal scroller (never scrolls the page).
  useEffect(() => {
    const el = refs.current[idx]
    const box = el?.parentElement
    if (!el || !box) return
    const pad = 24
    if (el.offsetLeft - pad < box.scrollLeft) box.scrollTo({ left: el.offsetLeft - pad, behavior: 'smooth' })
    else if (el.offsetLeft + el.offsetWidth + pad > box.scrollLeft + box.clientWidth)
      box.scrollTo({ left: el.offsetLeft + el.offsetWidth + pad - box.clientWidth, behavior: 'smooth' })
  }, [idx])

  const onKey = (e: KeyboardEvent, i: number) => {
    let j = i
    if (e.key === 'ArrowRight') j = i + 1
    else if (e.key === 'ArrowLeft') j = i - 1
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = CATEGORIES.length - 1
    else return
    e.preventDefault()
    j = (j + CATEGORIES.length) % CATEGORIES.length
    onChange(CATEGORIES[j].id as CategoryFilter)
    refs.current[j]?.focus()
  }

  return (
    <div className="tabs cat-tabs" role="tablist" aria-label="Categories">
      {CATEGORIES.map((c, i) => {
        const on = c.id === value
        return (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={`cat-${c.id}`}
            role="tab"
            aria-selected={on}
            aria-controls="gallery-panel"
            tabIndex={on ? 0 : -1}
            className={'tab' + (on ? ' is-on' : '')}
            onClick={() => onChange(c.id as CategoryFilter)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {c.label}
            {c.id === 'mine' && mineCount > 0 && <span className="tab-count">{mineCount}</span>}
          </button>
        )
      })}
    </div>
  )
}
