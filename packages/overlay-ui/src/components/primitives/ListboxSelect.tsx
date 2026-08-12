'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface ListboxOption<T extends string> {
  value: T
  label: string
  /** Optional visual grouping, rendered as a non-selectable menu heading. */
  group?: string
}

export interface ListboxSelectProps<T extends string> {
  value: T
  options: ListboxOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  buttonClassName?: string
  menuClassName?: string
  id?: string
  name?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** Defaults to true so the listbox can escape clipping parents. */
  portal?: boolean
}

export function ListboxSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  buttonClassName,
  menuClassName,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  portal = true,
}: ListboxSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
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
    function updateMenuPosition() {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) return
      const rect = button.getBoundingClientRect()
      const padding = 8
      const gap = 4
      const spaceBelow = window.innerHeight - rect.bottom - padding
      const spaceAbove = rect.top - padding
      const opensUpward = spaceBelow < 144 && spaceAbove > spaceBelow
      const width = Math.min(rect.width, window.innerWidth - padding * 2)
      const left = Math.min(Math.max(padding, rect.left), Math.max(padding, window.innerWidth - width - padding))
      setMenuPosition({
        left,
        top: opensUpward
          ? Math.max(padding, rect.top - Math.min(menu.offsetHeight || 240, spaceAbove) - gap)
          : rect.bottom + gap,
        width,
        maxHeight: Math.max(96, Math.min(240, opensUpward ? spaceAbove : spaceBelow)),
      })
    }
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, portal])

  const groupedOptions = options.reduce<Array<{ group?: string; options: ListboxOption<T>[] }>>((groups, option) => {
    const last = groups.at(-1)
    if (last && last.group === option.group) {
      last.options.push(option)
    } else {
      groups.push({ group: option.group, options: [option] })
    }
    return groups
  }, [])

  const menu = open ? (
    <div
      ref={menuRef}
      className={cn(
        'overlay-pop-in max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg',
        portal ? 'fixed z-[10090]' : 'absolute left-0 right-0 top-full z-50 mt-1',
        menuClassName,
      )}
      style={portal ? {
        left: menuPosition?.left ?? -10_000,
        top: menuPosition?.top ?? -10_000,
        width: menuPosition?.width,
        maxHeight: menuPosition?.maxHeight,
        visibility: menuPosition ? 'visible' : 'hidden',
      } : undefined}
      role="listbox"
    >
      {groupedOptions.map(({ group, options: optionsInGroup }) => (
        <div key={group ?? '__ungrouped'}>
          {group ? (
            <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">
              {group}
            </p>
          ) : null}
          {optionsInGroup.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-left text-sm transition-colors',
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
      ))}
    </div>
  ) : null

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (disabled) return
          setMenuPosition(null)
          setOpen((current) => !current)
        }}
        className={cn(
          'flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--foreground)]',
          disabled
            ? 'cursor-not-allowed text-[var(--muted-light)]'
            : 'text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
          buttonClassName,
        )}
      >
        <span className="min-w-0 truncate">{selected}</span>
        <ChevronDown size={11} className={cn('shrink-0 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {!portal ? menu : null}
      {portal && menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </div>
  )
}

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export type DropdownOption<T extends string> = ListboxOption<T>

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export const DropdownSelect = ListboxSelect
