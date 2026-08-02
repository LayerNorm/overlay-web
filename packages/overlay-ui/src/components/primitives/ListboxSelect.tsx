'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface ListboxOption<T extends string> {
  value: T
  label: string
}

export interface ListboxSelectProps<T extends string> {
  value: T
  options: ListboxOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  buttonClassName?: string
  menuClassName?: string
  'aria-label'?: string
}

export function ListboxSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  buttonClassName,
  menuClassName,
  'aria-label': ariaLabel,
}: ListboxSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((current) => !current)}
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-1.5 text-left text-xs',
          disabled
            ? 'cursor-not-allowed text-[var(--muted-light)]'
            : 'text-[var(--muted)] hover:bg-[var(--border)]',
          buttonClassName,
        )}
      >
        <span className="min-w-0 truncate">{selected}</span>
        <ChevronDown size={11} className={cn('shrink-0 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div
          className={cn(
            'overlay-pop-in absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg',
            menuClassName,
          )}
          role="listbox"
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-left text-xs transition-colors',
                  active
                    ? 'bg-[var(--surface-muted)] font-medium text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
                )}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export type DropdownOption<T extends string> = ListboxOption<T>

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export const DropdownSelect = ListboxSelect
