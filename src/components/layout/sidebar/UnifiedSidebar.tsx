'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Ellipsis, Loader2, PanelLeft, Plus, Search } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarResourceAction,
} from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { cn } from '@overlay/ui'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { rememberPanelScope } from '@/hooks/use-panel-scope'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { PrimaryRailItem } from './AppSidebarPrimaryRail'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { publishPageSubviews } from './pageSubviewStore'
import { SettingsSidebarNav } from './SettingsSidebarNav'

/** Pages that live behind the More menu instead of the main list. */
const MORE_ITEM_IDS = new Set(['files', 'extensions'])
/** Pages whose subviews are different views of one page, so they become header tabs. */
const TAB_PANEL_KINDS = new Set(['work', 'files', 'notes', 'tools'])
const MORE_CLOSE_DELAY_MS = 150

function badgeLabel(count: number) {
  return count > 99 ? '99+' : String(count)
}

function NavRow({ item, collapsed }: { item: PrimaryRailItem; collapsed: boolean }) {
  const Icon = item.pending ? Loader2 : item.icon
  const content = (
    <>
      <Icon aria-hidden className={item.pending ? 'animate-spin' : undefined} />
      {collapsed ? null : <span>{item.label}</span>}
    </>
  )
  const shared = {
    isActive: item.active,
    size: 'lg' as const,
    title: collapsed ? item.label : item.title,
    'aria-current': item.active ? ('page' as const) : undefined,
    'data-tour': item.dataTour,
    className: collapsed ? 'justify-center px-0' : undefined,
  }
  return (
    <SidebarMenuItem>
      {item.href && !item.disabled ? (
        <SidebarMenuButton asChild {...shared}>
          <Link
            href={item.href}
            aria-label={item.label}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              item.onSelect()
            }}
          >
            {content}
          </Link>
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton {...shared} disabled={item.disabled} aria-label={item.label} onClick={item.onSelect}>
          {content}
        </SidebarMenuButton>
      )}
      {item.badgeCount && !collapsed ? <SidebarMenuBadge>{badgeLabel(item.badgeCount)}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )
}

/** Files and Extensions. Opens on hover with a short close delay; click, Enter and touch still open it. */
function MoreMenu({ items, collapsed }: { items: readonly PrimaryRailItem[]; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A click right after hover opened the menu should keep it open, not toggle it shut.
  const openedByHover = useRef(false)
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => changeOpen(false), MORE_CLOSE_DELAY_MS)
  }
  const changeOpen = (next: boolean) => {
    if (!next) openedByHover.current = false
    setOpen(next)
  }
  useEffect(() => cancelClose, [])
  if (items.length === 0) return null
  const activeItem = items.find((item) => item.active)
  const label = 'More'
  const hoverOpen = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelClose()
    if (!open) openedByHover.current = true
    setOpen(true)
  }
  const hoverClose = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') scheduleClose()
  }
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            size="lg"
            isActive={Boolean(activeItem)}
            title={collapsed ? label : undefined}
            aria-label={label}
            className={collapsed ? 'justify-center px-0' : undefined}
            onPointerEnter={hoverOpen}
            onPointerLeave={hoverClose}
            onClick={(event) => {
              if (!open || !openedByHover.current) return
              openedByHover.current = false
              event.preventDefault()
            }}
          >
            <Ellipsis aria-hidden />
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <ChevronRight aria-hidden className="text-(--muted-light)" />
              </>
            )}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-48 p-1"
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
        >
          <SidebarMenu>
            {items.map((item) => (
              <NavRow
                key={item.id}
                item={{ ...item, onSelect: () => { changeOpen(false); item.onSelect() } }}
                collapsed={false}
              />
            ))}
          </SidebarMenu>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}

export const WORKSPACE_LOCKED_HINT = 'To enable Workspace features, invite members.'

function ScopeToggle({
  scope,
  workspaceLocked,
  onChange,
}: {
  scope: PanelScope
  workspaceLocked: boolean
  onChange: (scope: PanelScope) => void
}) {
  const options: ReadonlyArray<{ id: PanelScope; label: string }> = [
    { id: 'personal', label: 'Personal' },
    { id: 'workspace', label: 'Workspace' },
  ]
  return (
    <div role="group" aria-label="Scope" className="mx-2 mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map((option) => {
        const locked = workspaceLocked && option.id === 'workspace'
        const button = (
          <Button
            key={option.id}
            variant="ghost"
            type="button"
            aria-pressed={scope === option.id}
            aria-disabled={locked || undefined}
            onClick={() => { if (!locked) onChange(option.id) }}
            className={unstyledButton(cn(
              'h-7 w-full rounded-md text-xs font-medium transition-colors',
              scope === option.id
                ? 'bg-(--surface-elevated) text-(--foreground) shadow-sm'
                : locked
                  ? 'cursor-not-allowed text-(--muted-light)'
                  : 'text-(--muted) hover:text-(--foreground)',
            ))}
          >
            {option.label}
          </Button>
        )
        return locked ? (
          <DelayedTooltip key={option.id} label={WORKSPACE_LOCKED_HINT} side="bottom">
            {button}
          </DelayedTooltip>
        ) : button
      })}
    </div>
  )
}

/** Rows under the selected scope (for Chats: Direct messages, Channels, Activity). */
function scopeChildren(nav: SecondaryPanelNav | undefined, scope: PanelScope, solo: boolean): ReadonlyArray<InlineNavItem> {
  if (!nav) return []
  const row = nav.items.find((item) => item.id === scope)
  if (row?.children?.length) return row.children
  return solo ? nav.items.filter((item) => item.id.includes(':')) : []
}

const SECTION_HEADER_PX = 32

interface PageSection {
  id: string
  label: string
  active: boolean
  badgeCount?: number
  locked?: boolean
}

function pageSections(
  nav: SecondaryPanelNav | undefined,
  rows: ReadonlyArray<InlineNavItem>,
  title: string,
  hasContent: boolean,
): PageSection[] {
  if (nav && rows.length > 0) {
    const activeId = nav.activeChildId ?? nav.activeId
    return rows.map((row) => ({ id: row.id, label: row.label, active: activeId === row.id, badgeCount: row.badgeCount, locked: row.locked }))
  }
  return hasContent && title ? [{ id: 'page', label: title, active: true }] : []
}

/** Collapsible page sections; headers stick to the top and bottom so every section stays reachable. */
function PageSections({
  nav,
  rows,
  title,
  action,
  children,
}: {
  nav?: SecondaryPanelNav
  rows: ReadonlyArray<InlineNavItem>
  title: string
  action?: SidebarResourceAction | null
  children?: ReactNode
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const sections = pageSections(nav, rows, title, Boolean(children || action))
  if (sections.length === 0) return null
  const setOpen = (id: string, open: boolean) => setClosed((prev) => {
    const next = new Set(prev)
    if (open) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <SidebarGroup className="mt-3">
      {sections.map((section, index) => {
        const open = section.active && !closed.has(section.id)
        const pending = nav?.pendingId === section.id
        return (
          <div key={section.id} className="min-w-0">
            <div
              className="sticky z-10 flex h-8 items-center gap-0.5 bg-(--sidebar-surface)"
              style={{ top: index * SECTION_HEADER_PX, bottom: (sections.length - 1 - index) * SECTION_HEADER_PX }}
            >
              <SidebarMenuButton
                aria-expanded={open}
                isActive={section.active && Boolean(nav)}
                disabled={section.locked}
                className="flex-1 font-medium"
                onClick={() => {
                  if (section.active) setOpen(section.id, !open)
                  else {
                    setOpen(section.id, true)
                    nav?.onSelect(section.id)
                  }
                }}
              >
                {pending
                  ? <Loader2 aria-hidden className="animate-spin" />
                  : <ChevronRight aria-hidden className={cn('transition-transform', open ? 'rotate-90' : null)} />}
                <span>{section.label}</span>
              </SidebarMenuButton>
              {section.badgeCount ? (
                <span className="shrink-0 px-1 text-[10px] font-medium text-(--muted)">{badgeLabel(section.badgeCount)}</span>
              ) : null}
              {section.active && action ? (
                <DelayedTooltip label={action.label} side="bottom">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={action.label}
                    onClick={action.onClick}
                    className="size-7 shrink-0 rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
                  >
                    <Plus size={14} aria-hidden />
                  </Button>
                </DelayedTooltip>
              ) : null}
            </div>
            {open ? <div className="min-w-0 pb-2">{children}</div> : null}
          </div>
        )
      })}
    </SidebarGroup>
  )
}

export interface UnifiedSidebarProps {
  brand: ReactNode
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  items: readonly PrimaryRailItem[]
  footerItems?: readonly PrimaryRailItem[]
  panelKind: string | null
  panelNav?: SecondaryPanelNav
  panelAction?: SidebarResourceAction | null
  onSearch?: (() => void) | null
  scope: PanelScope
  solo: boolean
  account: ReactNode
  /** Toggle collapse with Cmd/Ctrl+B. */
  keyboardShortcut?: boolean
  /** List More pages as plain rows (the phone drawer has no room for a side menu). */
  inlineMore?: boolean
  /** Owns the header tabs; a second copy (the phone drawer) must not clear them when it closes. */
  publishSubviews?: boolean
  children?: ReactNode
  className?: string
}

function useCollapseShortcut(enabled: boolean, collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      event.preventDefault()
      onCollapsedChange(!collapsed)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, collapsed, onCollapsedChange])
}

function SidebarHeaderBar({
  brand,
  collapsed,
  onCollapsedChange,
  onSearch,
}: Pick<UnifiedSidebarProps, 'brand' | 'collapsed' | 'onCollapsedChange' | 'onSearch'>) {
  return (
    <div className={cn('flex h-14 shrink-0 items-center gap-1 md:h-16', collapsed ? 'justify-center px-2' : 'pl-[19px] pr-3')}>
      {collapsed ? (
        <DelayedTooltip label="Expand sidebar" side="bottom">
          <Button
            variant="ghost"
            type="button"
            aria-label="Expand sidebar"
            onClick={() => onCollapsedChange(false)}
            className={unstyledButton('inline-flex size-8 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
          >
            <PanelLeft size={16} aria-hidden />
          </Button>
        </DelayedTooltip>
      ) : (
        <>
          <div className="min-w-0 flex-1">{brand}</div>
          {onSearch ? (
            <DelayedTooltip label="Search (⌘K)" side="bottom">
              <Button
                variant="ghost"
                type="button"
                aria-label="Search"
                onClick={onSearch}
                className={unstyledButton('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
              >
                <Search size={16} aria-hidden />
              </Button>
            </DelayedTooltip>
          ) : null}
          <DelayedTooltip label="Collapse sidebar (⌘B)" side="bottom">
            <Button
              variant="ghost"
              type="button"
              aria-label="Collapse sidebar"
              onClick={() => onCollapsedChange(true)}
              className={unstyledButton('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
            >
              <PanelLeft size={16} aria-hidden />
            </Button>
          </DelayedTooltip>
        </>
      )}
    </div>
  )
}

/**
 * The default app sidebar: brand, Personal/Workspace, the main pages (Files and Extensions under More), then the
 * current page's own rows and items, then the account. Subviews that are views of one page go to header tabs.
 */
export function UnifiedSidebar({
  brand,
  collapsed,
  onCollapsedChange,
  items,
  footerItems = [],
  panelKind,
  panelNav,
  panelAction,
  onSearch,
  scope,
  solo,
  account,
  keyboardShortcut = false,
  inlineMore = false,
  publishSubviews = true,
  children,
  className,
}: UnifiedSidebarProps) {
  const settingsNav = panelKind === 'settings' ? panelNav : undefined
  const settingsBack = items.find((item) => item.id === 'settings-close')
  const mainItems = items.filter((item) => !MORE_ITEM_IDS.has(item.id))
  const moreItems = items.filter((item) => MORE_ITEM_IDS.has(item.id))
  const scopedNav = panelKind && panelKind !== 'settings' ? panelNav : undefined
  const rows = scopeChildren(scopedNav, scope, solo)
  const tabsPage = Boolean(panelKind && TAB_PANEL_KINDS.has(panelKind))

  useCollapseShortcut(keyboardShortcut, collapsed, onCollapsedChange)

  useEffect(() => {
    if (!publishSubviews) return
    if (!tabsPage || !scopedNav || rows.length === 0) {
      publishPageSubviews(null)
      return
    }
    publishPageSubviews({
      items: rows,
      activeId: scopedNav.activeChildId ?? scopedNav.activeId,
      pendingId: scopedNav.pendingId,
      onSelect: scopedNav.onSelect,
    })
  }, [publishSubviews, rows, scopedNav, tabsPage])
  useEffect(() => (publishSubviews ? () => publishPageSubviews(null) : undefined), [publishSubviews])

  const changeScope = (next: PanelScope) => {
    if (next === scope) return
    if (scopedNav) scopedNav.onSelect(next)
    else rememberPanelScope(next)
  }
  const pageTitle = items.find((item) => item.active)?.label ?? ''

  return (
    <Sidebar
      aria-label="Sidebar"
      data-collapsed={collapsed}
      className={cn('border-r-0', collapsed ? 'w-14' : 'w-64', className)}
    >
      <SidebarHeaderBar brand={brand} collapsed={collapsed} onCollapsedChange={onCollapsedChange} onSearch={settingsNav ? null : onSearch} />
      {collapsed || settingsNav ? null : <ScopeToggle scope={solo ? 'personal' : scope} workspaceLocked={solo} onChange={changeScope} />}
      {settingsNav ? (
        <SidebarContent>
          <SettingsSidebarNav nav={settingsNav} collapsed={collapsed} onBack={settingsBack?.onSelect} />
        </SidebarContent>
      ) : (
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {(inlineMore ? items : mainItems).map((item) => <NavRow key={item.id} item={item} collapsed={collapsed} />)}
            {inlineMore ? null : <MoreMenu items={moreItems} collapsed={collapsed} />}
          </SidebarMenu>
        </SidebarGroup>
        {collapsed ? null : (
          <PageSections nav={tabsPage ? undefined : scopedNav} rows={tabsPage ? [] : rows} title={pageTitle} action={panelAction}>
            {children}
          </PageSections>
        )}
      </SidebarContent>
      )}
      <SidebarFooter className="border-t-0">
        {footerItems.length > 0 && !settingsNav ? (
          <SidebarMenu>
            {footerItems.map((item) => <NavRow key={item.id} item={item} collapsed={collapsed} />)}
          </SidebarMenu>
        ) : null}
        {account}
      </SidebarFooter>
    </Sidebar>
  )
}
