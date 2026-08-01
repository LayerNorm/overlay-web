'use client'

import type { ReactNode } from 'react'
import {
  SidebarResourceSection,
  SidebarShell,
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

export function SecondaryPanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-16 min-h-16 shrink-0 items-center border-b border-[var(--border)] px-4">
      <span
        className="truncate text-lg font-medium tracking-tight text-[var(--foreground)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </span>
    </div>
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
          onSelect={nav.onSelect}
        />
      ) : null}
      {action || search || children ? (
        <SidebarResourceSection action={action} search={search}>
          {children}
        </SidebarResourceSection>
      ) : null}
      {footer ? (
        <div className="mt-auto shrink-0 border-t border-[var(--border)] px-2 py-3">{footer}</div>
      ) : null}
    </div>
  )
}

/**
 * Secondary sidebar: a contextual list/subnavigation panel that sits beside
 * the primary rail for routes that have one.
 */
export function AppSidebarSecondaryPanel({
  title,
  className,
  ...content
}: {
  title: string
  className?: string
} & SecondaryPanelContentProps) {
  return (
    <SidebarShell className={className}>
      <SecondaryPanelHeader title={title} />
      <SecondaryPanelContent {...content} />
    </SidebarShell>
  )
}
