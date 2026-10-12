import { useEffect, useRef } from 'react'
import { artUrl, CATALOG } from '../catalog/catalog'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { byline } from './puzzleImage'

/** Credits for every catalog artwork. `focusId` scrolls to (and highlights) one entry. */
export function CreditsSheet({ onClose, focusId }: { onClose: () => void; focusId?: string }) {
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!focusId) return
    const el = list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [focusId])

  return (
    <Sheet label="Artwork credits" onClose={onClose} className="credits sheet-wide">
      <div className="sheet-title-row">
        <h2>Artwork credits</h2>
        <button className="btn btn-icon" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="credits-intro">
        Every painting and print in Pieceful is in the public domain (a few scans are dedicated CC0), reproduced from Wikimedia Commons. Space
        imagery from NASA, and from NASA/ESA missions such as Hubble and Webb, is public domain as well. Images are
        resized and hosted by Pieceful so puzzles work offline.
      </p>
      <ul className="credits-list" ref={list}>
        {CATALOG.map((img) => (
          <li key={img.id} data-id={img.id} className={img.id === focusId ? 'is-focus' : undefined}>
            <span className="credits-thumb" style={{ background: img.tone }}>
              <img src={artUrl(img, 'thumb')} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="credits-text">
              <span className="credits-title">{img.title}</span>
              <span className="credits-by">{byline(img)}</span>
              <span className="credits-license">{img.license}</span>
            </span>
            <a
              className="credits-link"
              href={img.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Source of ${img.title} on Wikimedia Commons (opens in a new tab)`}
              title="View on Wikimedia Commons"
            >
              Source <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="credits-foot muted">Your own photos never leave this device.</p>
    </Sheet>
  )
}
