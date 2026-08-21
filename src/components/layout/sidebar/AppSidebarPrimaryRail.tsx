'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { SidebarShell } from '@overlay/ui/primitives'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'

export interface PrimaryRailItem {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
  pending?: boolean
  disabled?: boolean
  badgeCount?: number
  /** Real destinations stay anchors so modifier-click can open a new tab. */
  href?: string
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
  const { label, icon: Icon, active, pending, disabled, badgeCount, href, title, dataTour, onSelect } = item
  const className = `relative flex h-9 w-full items-center rounded-md transition-colors ${
        expanded ? 'gap-2.5 px-3' : 'justify-center px-0'
      } ${
        disabled
          ? 'cursor-not-allowed text-[var(--muted-light)]'
          : active
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
      }`
  const content = (
    <>
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
    </>
  )

  if (href && !disabled) {
    return (
      <Link
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onSelect()
        }}
        title={title ?? label}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-tour={dataTour}
        className={className}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={title ?? label}
      aria-label={disabled ? `${label} (coming soon)` : label}
      aria-current={active ? 'page' : undefined}
      data-tour={dataTour}
      className={className}
    >
      {content}
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
  sectionNav,
  account,
  expanded = false,
  className,
}: {
  brand: ReactNode
  items: readonly PrimaryRailItem[]
  footerItems?: readonly PrimaryRailItem[]
  /**
   * Subviews of the active section (Personal, DMs, Channels…). Collapsing the
   * sidebar hides the secondary panel, so they move under the primary icons
   * instead of disappearing.
   */
  sectionNav?: {
    items: readonly InlineNavItem[]
    activeId: string
    pendingId?: string | null
    onSelect: (id: string) => void
  }
  account: ReactNode
  expanded?: boolean
  className?: string
}) {
  // Icon-only rows need an icon; anything without one has no collapsed form.
  const sectionItems: PrimaryRailItem[] = !expanded && sectionNav
    ? sectionNav.items.flatMap((item) => {
        const Icon = item.icon
        if (!Icon) return []
        return [{
          id: item.id,
          label: item.label,
          icon: Icon,
          active: sectionNav.activeId === item.id,
          pending: sectionNav.pendingId === item.id,
          disabled: item.locked,
          title: item.label,
          ...(item.badgeCount ? { badgeCount: item.badgeCount } : {}),
          ...(item.href ? { href: item.href } : {}),
          onSelect: () => sectionNav.onSelect(item.id),
        }]
      })
    : []
  const showSectionItems = sectionItems.length > 0
  return (
    <SidebarShell className={className}>
      <div
        className={`flex h-16 min-h-16 shrink-0 items-center border-b border-[var(--border)] ${
          // Match nav `px-2` so the brand mark lines up with rail icons (same
          // inset as SidebarNav + button `px-3` on main).
          expanded ? 'justify-between gap-2 px-2' : 'justify-center'
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
        {showSectionItems ? (
          <>
            <div className="my-2 border-t border-[var(--border)]" role="presentation" />
            {sectionItems.map((item) => (
              <RailButton key={`section-${item.id}`} item={item} expanded={expanded} />
            ))}
          </>
        ) : null}
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
