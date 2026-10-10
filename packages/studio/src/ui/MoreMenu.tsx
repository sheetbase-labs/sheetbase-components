import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface MoreMenuProps {
  /** Items: buttons (and any read-only status) shown when the menu is open. */
  children: ReactNode
  /** Accessible name of the trigger and the panel. */
  label?: string
  className?: string
}

/**
 * The narrow top bar's overflow: one "⋯" button that discloses the actions the
 * wide bar shows inline. A disclosure (button + panel), not an ARIA menu:
 * items are ordinary buttons in tab order. Escape or a click outside closes it
 * and returns focus to the trigger; choosing an item closes it.
 */
export function MoreMenu({ children, label = 'More actions', className }: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('button:not([disabled]), a[href], select, input')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    // Choosing an item closes the menu (after the item's own click runs).
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target && panel.current?.contains(target) && target.closest('button')) {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onClick)
    }
  }, [open])

  return (
    <div ref={root} className={`sbs-more${className ? ` ${className}` : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="sb-icon-btn sbs-more-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <circle cx="3" cy="7" r="1.3" fill="currentColor" />
          <circle cx="7" cy="7" r="1.3" fill="currentColor" />
          <circle cx="11" cy="7" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div ref={panel} id={id} className="sbs-more-panel">
          {children}
        </div>
      )}
    </div>
  )
}
