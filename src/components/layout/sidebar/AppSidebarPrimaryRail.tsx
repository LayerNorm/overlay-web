'use client'

import { cn } from '@overlay/ui'
import { useState, type ReactNode, type CSSProperties } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import {
  PanelResizeHandle,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '@overlay/ui/primitives'
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

function RailBadge({ count, expanded }: { count: number; expanded: boolean }) {
  return (
    <span
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-(--border) px-0.5 text-[9px] font-medium text-(--foreground) ${
        expanded ? 'shrink-0' : 'absolute right-0.5 top-0.5 h-3.5 min-w-3.5 text-[8px]'
      }`}
      aria-hidden
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function RailButtonContent({ item, expanded }: { item: PrimaryRailItem; expanded: boolean }) {
  const { label, icon: Icon, pending, badgeCount } = item
  return (
    <>
      {pending ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-(--muted)" aria-hidden />
      ) : (
        <Icon size={15} className="shrink-0" />
      )}
      {expanded ? <span className="min-w-0 flex-1 truncate text-left text-sm">{label}</span> : null}
      {badgeCount ? <RailBadge count={badgeCount} expanded={expanded} /> : null}
    </>
  )
}

function RailButton({
  item,
  expanded,
}: {
  item: PrimaryRailItem
  expanded: boolean
}) {
  const { label, active, disabled, href, title, dataTour, onSelect } = item
  const className = cn(
    'relative',
    expanded ? 'gap-2.5 px-3' : 'justify-center px-0',
    disabled && 'cursor-not-allowed text-(--muted-light) hover:bg-transparent hover:text-(--muted-light) disabled:pointer-events-auto disabled:opacity-100',
  )
  const content = <RailButtonContent item={item} expanded={expanded} />

  if (href && !disabled) {
    return (
      <SidebarMenuButton asChild size="lg" isActive={active} className={className}>
        <Link
          href={href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            onSelect()
          }}
          aria-label={label}
          title={title ?? label}
          aria-current={active ? 'page' : undefined}
          data-tour={dataTour}
        >
          {content}
        </Link>
      </SidebarMenuButton>
    )
  }

  return (
    <SidebarMenuButton
      size="lg"
      isActive={active && !disabled}
      onClick={onSelect}
      disabled={disabled}
      aria-label={disabled ? `${label} (coming soon)` : label}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      data-tour={dataTour}
      className={className}
    >
      {content}
    </SidebarMenuButton>
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
  const [width, setWidth] = useState(224)
  const [resizing, setResizing] = useState(false)
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
    <SidebarProvider open={expanded}>
      <Sidebar className={cn(className, resizing && 'transition-none')} style={{ '--primary-sidebar-width': `${width}px` } as CSSProperties}>
        {expanded ? <PanelResizeHandle edge="right" width={width} onResize={setWidth} onResizingChange={setResizing} minWidth={220} maxWidth={420} label="Resize navigation sidebar" /> : null}
        <SidebarHeader className={expanded ? 'justify-between px-2' : 'justify-center gap-0 px-0'}>
          {brand}
        </SidebarHeader>
        <SidebarContent className="py-3">
          <nav aria-label="Primary" className="px-2">
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <RailButton item={item} expanded={expanded} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {showSectionItems ? (
              <>
                <SidebarSeparator className="mx-0 mb-2 mt-2.5" />
                <SidebarMenu>
                  {sectionItems.map((item) => (
                    <SidebarMenuItem key={`section-${item.id}`}>
                      <RailButton item={item} expanded={expanded} />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </>
            ) : null}
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-0.5">
          {footerItems.length ? (
            <SidebarMenu>
              {footerItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <RailButton item={item} expanded={expanded} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : null}
          {account}
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  )
}
