import { useEffect, useRef } from 'react'
import type { Game } from '../../engine/Game'
import type { Zone } from '../../engine/layout'

/** Colour-zone labels pinned to the table; positioned imperatively on camera moves (no re-render). */
export function ZoneChips({ game, zones, active }: { game: Game; zones: Zone[]; active: number }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const place = () => {
      const el = root.current
      if (!el) return
      zones.forEach((z, k) => {
        const chip = el.children[k] as HTMLElement | undefined
        if (!chip) return
        const p = game.camera.toScreen({ x: z.rect.x0, y: z.rect.y0 })
        chip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 34)}px)`
      })
    }
    place()
    const off1 = game.on('camera', place)
    const off2 = game.on('layout', place)
    return () => {
      off1()
      off2()
    }
  }, [game, zones])

  return (
    <div className="zone-chips" ref={root}>
      {zones.map((z) => (
        <button
          key={z.cls}
          className={'zone-chip glass' + (active === z.cls ? ' is-on' : '') + (active >= 0 && active !== z.cls ? ' is-dim' : '')}
          onClick={() => game.setView({ zone: active === z.cls ? -1 : z.cls })}
          aria-pressed={active === z.cls}
          title="Show only this colour zone"
        >
          <span className="zone-swatch" style={{ background: `rgb(${z.color.join(',')})` }} />
          Zone {z.cls + 1} · {z.count}
        </button>
      ))}
    </div>
  )
}
