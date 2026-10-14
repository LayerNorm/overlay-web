'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useDialogReturnFocus } from '../../hooks/useDialogReturnFocus'
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from '../ui/command'

export type CommandPaletteRow = (
  | { kind: 'action'; id: string; label: string; icon?: ReactNode; emphasized?: boolean }
  | { kind: 'category'; id: string; label: string; icon?: ReactNode }
  | {
      kind: 'item'
      id: string
      label: string
      description?: string
      icon?: ReactNode
      logoUrl?: string
    }
) & { disabled?: boolean }

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
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useDialogReturnFocus()
  const [activeValue, setActiveValue] = useState('')
  const firstValue = rows.find((row) => !row.disabled)?.id ?? ''
  // Keep the legacy reset on open, category change and result-count change.
  // cmdk owns arrow selection, disabled-item skipping and scrolling thereafter.
  useEffect(() => {
    queueMicrotask(() => setActiveValue(firstValue))
  }, [open, rows.length, breadcrumb?.label, firstValue])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, breadcrumb?.label])

  const goBack = () => {
    onBreadcrumbBack?.()
    inputRef.current?.focus()
  }
  const showSpinner = loading && rows.length === 0 && !emptyState

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      contentProps={{
        ...returnFocus,
        overlayClassName: 'bg-black/40 backdrop-blur-xs',
        onOpenAutoFocus: (event) => {
          returnFocus.onOpenAutoFocus()
          event.preventDefault()
          inputRef.current?.focus()
        },
        onEscapeKeyDown: (event) => {
          if (breadcrumb && onBreadcrumbBack) {
            event.preventDefault()
            goBack()
          }
        },
      }}
    >
      <Command
        label="Command palette"
        shouldFilter={false}
        vimBindings={false}
        value={activeValue}
        onValueChange={setActiveValue}
      >
        {breadcrumb ? (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-(--border) bg-(--surface-muted) px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-(--muted-light)">
            <button
              type="button"
              onClick={goBack}
              onKeyDown={(event) => {
                // Native breadcrumb activation must not also activate the cmdk row.
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              }}
              className="transition-colors hover:text-(--foreground)"
            >
              All
            </button>
            <ChevronRight size={10} className="opacity-60" aria-hidden="true" />
            {breadcrumb.icon ? (
              <span className="opacity-60 [&_svg]:h-[11px] [&_svg]:w-[11px]">
                {breadcrumb.icon}
              </span>
            ) : null}
            <span>{breadcrumb.label}</span>
            <span className="ml-auto text-[9px] opacity-60">esc to go back</span>
          </div>
        ) : null}
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={onQueryChange}
          placeholder={placeholder}
        />
        <CommandList aria-busy={loading}>
          {showSpinner ? (
            <div
              role="status"
              aria-label="Searching"
              className="flex items-center justify-center py-10"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--muted) border-t-transparent" />
            </div>
          ) : emptyState ? (
            <div role="status" className="px-4 py-8 text-center text-xs text-(--muted-light)">
              {emptyState}
            </div>
          ) : (
            rows.map((row) => (
              <CommandItem
                key={row.id}
                value={row.id}
                disabled={row.disabled}
                onSelect={() => onActivateRow(row)}
                className={
                  row.kind === 'action'
                    ? 'mx-2 my-1 rounded-lg px-3 py-2.5 text-(--foreground)'
                    : undefined
                }
              >
                {row.kind === 'item' && row.logoUrl ? (
                  <img
                    src={row.logoUrl}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-contain"
                  />
                ) : row.icon ? (
                  <span
                    className={
                      row.kind === 'action'
                        ? 'shrink-0 [&_svg]:h-4 [&_svg]:w-4'
                        : 'shrink-0 opacity-70 [&_svg]:h-4 [&_svg]:w-4'
                    }
                  >
                    {row.icon}
                  </span>
                ) : null}
                <span
                  className={
                    row.kind === 'action'
                      ? row.emphasized
                        ? 'font-medium'
                        : undefined
                      : 'min-w-0 flex-1 truncate font-medium'
                  }
                >
                  {row.label}
                </span>
                {row.kind === 'category' ? (
                  <ChevronRight
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 opacity-50"
                    aria-hidden="true"
                  />
                ) : null}
                {row.kind === 'item' && row.description ? (
                  <span className="ml-2 max-w-[45%] shrink-0 truncate text-[11px] text-(--muted-light)">
                    {row.description}
                  </span>
                ) : null}
              </CommandItem>
            ))
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
