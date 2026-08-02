'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { SidebarShell } from '@overlay/ui/primitives'

export interface PrimaryRailItem {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
  pending?: boolean
  disabled?: boolean
  badgeCount?: number
  title?: string
  dataTour?: string
  onSelect: () => void
}

function RailButton({
  item,
  expanded,
}: {
  item: PrimaryRailItem
  expanded: boolean
}) {
  const { label, icon: Icon, active, pending, disabled, badgeCount, title, dataTour, onSelect } = item
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={title ?? label}
      aria-label={disabled ? `${label} (coming soon)` : label}
      aria-current={active ? 'page' : undefined}
      data-tour={dataTour}
      className={`relative flex h-9 w-full items-center rounded-md transition-colors ${
        expanded ? 'gap-2.5 px-3' : 'justify-center px-0'
      } ${
        disabled
          ? 'cursor-not-allowed text-[var(--muted-light)]'
          : active
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
      }`}
    >
      {pending ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden />
      ) : (
        <Icon size={15} className="shrink-0" />
      )}
      {expanded ? <span className="min-w-0 flex-1 truncate text-left text-sm">{label}</span> : null}
      {badgeCount ? (
        <span
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--border)] px-0.5 text-[9px] font-medium text-[var(--foreground)] ${
            expanded ? 'shrink-0' : 'absolute right-0.5 top-0.5 h-3.5 min-w-3.5 text-[8px]'
          }`}
          aria-hidden
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Primary navigation rail. Expanded shows labels; collapsed is icon-only with
 * the brand control flipping to an expand chevron (same as the pre-split sidebar).
 */
export function AppSidebarPrimaryRail({
  brand,
  items,
  footerItems = [],
  account,
  expanded = false,
  className,
}: {
  brand: ReactNode
  items: readonly PrimaryRailItem[]
  footerItems?: readonly PrimaryRailItem[]
  account: ReactNode
  expanded?: boolean
  className?: string
}) {
  return (
    <SidebarShell className={className}>
      <div
        className={`flex h-16 min-h-16 shrink-0 items-center border-b border-[var(--border)] ${
          expanded ? 'justify-between gap-2 px-3' : 'justify-center'
        }`}
      >
        {brand}
      </div>
      <nav
        aria-label="Primary"
        className={`flex min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto py-3 ${
          expanded ? 'px-2' : 'px-2'
        }`}
      >
        {items.map((item) => (
          <RailButton key={item.id} item={item} expanded={expanded} />
        ))}
      </nav>
      <div className={`shrink-0 space-y-0.5 border-t border-[var(--border)] py-3 ${expanded ? 'px-2' : 'px-2'}`}>
        {footerItems.map((item) => (
          <RailButton key={item.id} item={item} expanded={expanded} />
        ))}
        {account}
      </div>
    </SidebarShell>
  )
}
