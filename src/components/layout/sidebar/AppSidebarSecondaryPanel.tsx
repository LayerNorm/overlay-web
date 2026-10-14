'use client'

import type { ReactNode } from 'react'
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarRail,
  SidebarResourceSection,
  type SidebarResourceAction,
  type SidebarResourceSearch,
} from '@overlay/ui/primitives'
import { InlineNavChildren, type InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'

export interface SecondaryPanelNav {
  /** Addressable id so a controlling button can own aria-controls. */
  id?: string
  items: ReadonlyArray<InlineNavItem>
  /** Empty when no subview is selected, so nothing reads as pre-selected. */
  activeId: string
  /** The selected row among an expanded item's `children` (scope sub-rows). */
  activeChildId?: string
  /** The subpage whose navigation has started but has not committed yet. */
  pendingId?: string | null
  onSelect: (id: string) => void
}

export interface SecondaryPanelContentProps {
  nav?: SecondaryPanelNav
  action?: SidebarResourceAction | null
  search?: SidebarResourceSearch | null
  /** Pinned to the bottom of the panel (e.g. showcase links). */
  footer?: ReactNode
  children?: ReactNode
}

export function SecondaryPanelHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <SidebarHeader>
      {/* Match the primary rail wordmark: Libre Baskerville, lowercase, text-lg. */}
      <span
        className="min-w-0 flex-1 truncate text-lg font-medium lowercase tracking-tight text-(--foreground)"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </span>
      {action}
    </SidebarHeader>
  )
}

/**
 * Contextual body shared by the desktop secondary panel and the mobile
 * drawer's panel step: optional subnavigation, then the resource
 * action/search/list section.
 */
export function SecondaryPanelContent({
  nav,
  action,
  search,
  footer,
  children,
}: SecondaryPanelContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {nav ? (
        <InlineNavChildren
          id={nav.id}
          className="shrink-0 space-y-0.5 px-2 py-3"
          items={nav.items}
          activeId={nav.activeId}
          activeChildId={nav.activeChildId}
          pendingId={nav.pendingId}
          onSelect={nav.onSelect}
        />
      ) : null}
      {action || search || children ? (
        <SidebarResourceSection action={action} search={search} className={nav ? undefined : 'border-t-0'}>
          {children}
        </SidebarResourceSection>
      ) : null}
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
    </div>
  )
}

/**
 * Secondary sidebar: a contextual list/subnavigation panel that sits beside
 * the primary rail for routes that have one. Built on the shadcn Sidebar parts;
 * the shell decides whether it is shown (`open`), and the edge handle asks it to hide.
 */
export function AppSidebarSecondaryPanel({
  title,
  headerAction,
  className,
  open = true,
  onOpenChange,
  ...content
}: {
  title: string
  headerAction?: ReactNode
  className?: string
  /** Whether the panel is showing. The caller animates the width; this drives the edge handle. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
} & SecondaryPanelContentProps) {
  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange}>
      <Sidebar className={className} aria-label={title}>
        <SecondaryPanelHeader title={title} action={headerAction} />
        <SecondaryPanelContent {...content} />
        {onOpenChange ? <SidebarRail /> : null}
      </Sidebar>
    </SidebarProvider>
  )
}
