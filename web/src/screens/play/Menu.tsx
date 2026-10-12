import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../../components/Icon'

export interface MenuItem {
  icon?: IconName
  label: string
  /** second line under the label (what the command does) */
  desc?: string
  hint?: string
  run: () => void
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  swatch?: string
}

/**
 * Popover menu (keyboard navigable, closes on outside click / Esc).
 * The popover is portalled to the play root and positioned against its trigger, so toolbars
 * with blur/overflow (which create containing blocks and clip) can't hide it.
 */
export function Menu({
  label,
  icon,
  text,
  items,
  align = 'center',
  up = false,
  header,
}: {
  label: string
  icon: IconName
  text?: string
  items: (MenuItem | 'sep')[]
  align?: 'center' | 'end'
  up?: boolean
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const id = useId()

  // Position after render, once the popover's width is known.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const t = root.current?.querySelector('.menu-trigger')?.getBoundingClientRect()
      const p = pop.current
      if (!t || !p) return
      const w = p.offsetWidth
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = Math.min(vw - w - 8, Math.max(8, align === 'end' ? t.right - w : t.left + t.width / 2 - w / 2))
      setPos(up ? { left, bottom: vh - t.top + 10, maxH: t.top - 18 } : { left, top: t.bottom + 10, maxH: vh - t.bottom - 18 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, align, up])

  useEffect(() => {
    if (!open) return
    const inside = (n: Node) => root.current?.contains(n) || pop.current?.contains(n)
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('.menu-trigger')?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const list = [...(pop.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])]
        const i = list.indexOf(document.activeElement as HTMLButtonElement)
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    pop.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const host = (root.current?.closest('.play') as HTMLElement | null) ?? document.body

  return (
    <div className={'menu' + (open ? ' is-open' : '')} ref={root}>
      <button
        className={'btn menu-trigger' + (text ? ' btn-tool' : ' btn-icon')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => {
          setPos(null)
          setOpen((o) => !o)
        }}
      >
        <Icon name={icon} />
        {text && <span className="tool-label">{text}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="menu-pop glass"
            role="menu"
            id={id}
            aria-label={label}
            style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH } : { visibility: 'hidden', left: 0, top: 0 }}
          >
            {header}
            {items.map((it, k) =>
              it === 'sep' ? (
                <div className="menu-sep" key={k} role="separator" />
              ) : (
                <button
                  key={k}
                  role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={it.checked}
                  className={'menu-item' + (it.danger ? ' danger' : '') + (it.desc ? ' has-desc' : '')}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false)
                    it.run()
                  }}
                >
                  {it.swatch ? <span className="menu-swatch" style={{ background: it.swatch }} /> : it.icon ? <Icon name={it.icon} size={18} /> : <span className="menu-swatch" />}
                  <span className="menu-label">
                    {it.label}
                    {it.desc && <small>{it.desc}</small>}
                  </span>
                  {it.checked !== undefined && <span className="menu-check">{it.checked ? <Icon name="check" size={16} /> : null}</span>}
                  {it.hint && <kbd>{it.hint}</kbd>}
                </button>
              ),
            )}
          </div>,
          host,
        )}
    </div>
  )
}
