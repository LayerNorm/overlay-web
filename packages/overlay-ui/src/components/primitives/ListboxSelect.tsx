'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  portal?: boolean
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
  portal = false,
  'aria-label': ariaLabel,
}: ListboxSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [portalPosition, setPortalPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        rootRef.current
        && !rootRef.current.contains(target)
        && !menuRef.current?.contains(target)
      ) {
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

  useLayoutEffect(() => {
    if (!open || !portal) return

    function updatePosition() {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const viewportPadding = 8
      const menuGap = 4
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2)
      setPortalPosition({
        left: Math.min(
          Math.max(viewportPadding, rect.left),
          Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
        ),
        top: rect.bottom + menuGap,
        width,
        maxHeight: Math.max(
          0,
          Math.min(240, window.innerHeight - rect.bottom - menuGap - viewportPadding),
        ),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, portal])

  const menu = open ? (
    <div
      ref={menuRef}
      className={cn(
        'overlay-pop-in z-50 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg',
        portal
          ? 'fixed z-[10080]'
          : 'absolute left-0 right-0 top-full mt-1 max-h-60',
        menuClassName,
      )}
      role="listbox"
      style={portal
        ? {
            left: portalPosition?.left,
            top: portalPosition?.top,
            width: portalPosition?.width,
            maxHeight: portalPosition?.maxHeight,
            visibility: portalPosition ? 'visible' : 'hidden',
          }
        : undefined}
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
  ) : null

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
          'flex w-full min-w-0 items-center justify-between gap-2.5 rounded-md bg-[var(--surface-subtle)] py-1.5 pl-3 pr-3.5 text-left text-xs',
          disabled
            ? 'cursor-not-allowed text-[var(--muted-light)]'
            : 'text-[var(--muted)] hover:bg-[var(--border)]',
          buttonClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected}</span>
        <ChevronDown size={12} className={cn('ml-1 shrink-0 opacity-70 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {portal && typeof document !== 'undefined' && menu
        ? createPortal(menu, document.body)
        : menu}
    </div>
  )
}

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export type DropdownOption<T extends string> = ListboxOption<T>

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export const DropdownSelect = ListboxSelect
