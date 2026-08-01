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

function RailButton({ item }: { item: PrimaryRailItem }) {
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
      className={`relative flex h-10 w-full items-center justify-center rounded-md transition-colors ${
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
        <Icon size={15} />
      )}
      {badgeCount ? (
        <span
          className="absolute right-0.5 top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--border)] px-0.5 text-[8px] font-medium text-[var(--foreground)]"
          aria-hidden
        >
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Stable, always-narrow primary navigation rail. Top-level destinations only;
 * contextual subnavigation and resource lists live in the secondary panel.
 */
export function AppSidebarPrimaryRail({
  brand,
  items,
  footerItems = [],
  account,
  className,
}: {
  brand: ReactNode
  items: readonly PrimaryRailItem[]
  footerItems?: readonly PrimaryRailItem[]
  account: ReactNode
  className?: string
}) {
  return (
    <SidebarShell className={className}>
      <div className="flex h-16 min-h-16 shrink-0 items-center justify-center border-b border-[var(--border)]">
        {brand}
      </div>
      <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto px-2 py-3">
        {items.map((item) => (
          <RailButton key={item.id} item={item} />
        ))}
      </nav>
      <div className="shrink-0 space-y-0.5 border-t border-[var(--border)] px-2 py-3">
        {footerItems.map((item) => (
          <RailButton key={item.id} item={item} />
        ))}
        {account}
      </div>
    </SidebarShell>
  )
}
