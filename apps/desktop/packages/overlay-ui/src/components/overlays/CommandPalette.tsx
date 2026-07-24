'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import { cn } from '../../utils/cn'

export type CommandPaletteRow =
  | { kind: 'action'; id: string; label: string; icon?: ReactNode; emphasized?: boolean }
  | { kind: 'category'; id: string; label: string; icon?: ReactNode }
  | { kind: 'item'; id: string; label: string; description?: string; icon?: ReactNode; logoUrl?: string }

export interface CommandPaletteBreadcrumb {
  label: string
  icon?: ReactNode
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  query: string
  onQueryChange: (query: string) => void
  placeholder?: string
  breadcrumb?: CommandPaletteBreadcrumb | null
  onBreadcrumbBack?: () => void
  rows: CommandPaletteRow[]
  loading?: boolean
  /** When set, replaces the row list (e.g. no results). */
  emptyState?: ReactNode
  onActivateRow: (row: CommandPaletteRow) => void
}

export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  placeholder = 'Type a command or search...',
  breadcrumb = null,
  onBreadcrumbBack,
  rows,
  loading = false,
  emptyState,
  onActivateRow,
}: CommandPaletteProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { mounted, visible } = usePresence(open)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setActiveIndex(0)
      inputRef.current?.focus()
    })
  }, [open, breadcrumb?.label])

  useEffect(() => {
    queueMicrotask(() => setActiveIndex(0))
  }, [rows.length, breadcrumb?.label])

  useEffect(() => {
    const el = itemRefs.current[activeIndex]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(rows.length - 1, 0)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const current = rows[activeIndex]
        if (current) onActivateRow(current)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (breadcrumb && onBreadcrumbBack) {
          onBreadcrumbBack()
          queueMicrotask(() => inputRef.current?.focus())
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, rows, activeIndex, onActivateRow, breadcrumb, onBreadcrumbBack, onClose])

  if (!mounted) return null

  const showSpinner = loading && rows.length === 0 && !emptyState

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh] px-4 transition-opacity duration-200 ease-[var(--overlay-ease)]',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl transition-[opacity,transform] duration-200 ease-[var(--overlay-ease)]',
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1',
        )}
      >
        {breadcrumb ? (
          <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-light)]">
            <button
              type="button"
              onClick={() => {
                onBreadcrumbBack?.()
                inputRef.current?.focus()
              }}
              className="hover:text-[var(--foreground)] transition-colors"
            >
              All
            </button>
            <ChevronRight size={10} className="opacity-60" />
            {breadcrumb.icon ? <span className="opacity-60 [&_svg]:h-[11px] [&_svg]:w-[11px]">{breadcrumb.icon}</span> : null}
            <span>{breadcrumb.label}</span>
            <span className="ml-auto text-[9px] opacity-60">esc to go back</span>
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-[var(--muted-light)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
          />
        </div>

        <div className="overflow-y-auto py-1">
          {showSpinner ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />
            </div>
          ) : emptyState ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--muted-light)]">{emptyState}</div>
          ) : (
            rows.map((row, idx) => {
              const isActive = idx === activeIndex
              if (row.kind === 'action') {
                return (
                  <button
                    key={row.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el
                    }}
                    type="button"
                    onClick={() => onActivateRow(row)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      'mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
                    )}
                  >
                    {row.icon ? <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{row.icon}</span> : null}
                    <span className={row.emphasized ? 'font-medium' : undefined}>{row.label}</span>
                  </button>
                )
              }
              if (row.kind === 'category') {
                return (
                  <button
                    key={row.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el
                    }}
                    type="button"
                    onClick={() => onActivateRow(row)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      'flex w-full items-center gap-3 px-5 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]',
                    )}
                  >
                    {row.icon ? (
                      <span className="shrink-0 opacity-70 [&_svg]:h-4 [&_svg]:w-4">{row.icon}</span>
                    ) : null}
                    <span className="flex-1 font-medium">{row.label}</span>
                    <ChevronRight size={14} strokeWidth={1.75} className="shrink-0 opacity-50" />
                  </button>
                )
              }
              return (
                <button
                  key={row.id}
                  ref={(el) => {
                    itemRefs.current[idx] = el
                  }}
                  type="button"
                  onClick={() => onActivateRow(row)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]',
                  )}
                >
                  {row.logoUrl ? (
                    <img src={row.logoUrl} alt="" className="h-4 w-4 shrink-0 rounded object-contain" />
                  ) : row.icon ? (
                    <span className="shrink-0 opacity-70 [&_svg]:h-4 [&_svg]:w-4">{row.icon}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                  {row.description ? (
                    <span className="ml-2 shrink-0 truncate text-[11px] text-[var(--muted-light)]">
                      {row.description}
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
