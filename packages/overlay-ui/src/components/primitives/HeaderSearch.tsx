import { useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../utils/cn'
import { IconButton } from './IconButton'

export interface HeaderSearchProps {
  /** Controlled query value. */
  value: string
  onChange: (value: string) => void
  /** Accessible name for both the toggle and the input. */
  label: string
  placeholder?: string
  /** Controlled open state. When omitted the component owns it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/**
 * Collapsible header search: a toggle IconButton that expands into a compact
 * inline input. Escape clears and closes. Pair with AppScreenHeader's
 * `search` slot.
 */
export function HeaderSearch({
  value,
  onChange,
  label,
  placeholder = 'Search',
  open: openProp,
  onOpenChange,
  className,
}: HeaderSearchProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen

  function dismiss() {
    onChange('')
    setUncontrolledOpen(false)
    onOpenChange?.(false)
  }

  function toggle() {
    if (open) {
      dismiss()
      return
    }
    setUncontrolledOpen(true)
    onOpenChange?.(true)
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {open ? (
        <label className="relative block w-52 max-w-[45vw]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
          <span className="sr-only">{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') dismiss()
            }}
            placeholder={placeholder}
            className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] pl-8 pr-3 text-xs outline-none focus:border-[var(--muted)]"
          />
        </label>
      ) : null}
      <IconButton
        aria-label={open ? `Close ${label.toLowerCase()}` : label}
        aria-pressed={open}
        size="sm"
        onClick={toggle}
      >
        <Search size={15} />
      </IconButton>
    </div>
  )
}
