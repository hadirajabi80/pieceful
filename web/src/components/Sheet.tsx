import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Bottom sheet on phones, centered dialog on wider screens. Esc / backdrop closes. */
export function Sheet({ onClose, label, children, className = '' }: { onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
    ;(first ?? el)?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      // Only the topmost sheet reacts.
      const sheets = document.querySelectorAll('.sheet')
      if (sheets[sheets.length - 1] !== el) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const a = items[0]
        const z = items[items.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={'sheet ' + className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>,
    document.body,
  )
}
