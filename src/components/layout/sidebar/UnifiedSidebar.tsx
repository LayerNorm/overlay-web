'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Ellipsis, Loader2, PanelLeft, Search } from 'lucide-react'
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
  SidebarResourceSection,
  type SidebarResourceAction,
} from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { cn } from '@overlay/ui'
import { rememberPanelScope } from '@/hooks/use-panel-scope'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { PrimaryRailItem } from './AppSidebarPrimaryRail'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { publishPageSubviews } from './pageSubviewStore'

/** Pages that live behind the Explore menu instead of the main list. */
const EXPLORE_ITEM_IDS = new Set(['files', 'extensions'])
/** Pages whose subviews are different views of one page, so they become header tabs. */
const TAB_PANEL_KINDS = new Set(['work', 'files', 'notes', 'tools'])
const EXPLORE_CLOSE_DELAY_MS = 150

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
function ExploreMenu({ items, collapsed }: { items: readonly PrimaryRailItem[]; collapsed: boolean }) {
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
    closeTimer.current = setTimeout(() => changeOpen(false), EXPLORE_CLOSE_DELAY_MS)
  }
  const changeOpen = (next: boolean) => {
    if (!next) openedByHover.current = false
    setOpen(next)
  }
  useEffect(() => cancelClose, [])
  if (items.length === 0) return null
  const activeItem = items.find((item) => item.active)
  const label = activeItem?.label ?? 'Explore'
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
            {activeItem ? <activeItem.icon aria-hidden /> : <Ellipsis aria-hidden />}
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

function ScopeToggle({ scope, onChange }: { scope: PanelScope; onChange: (scope: PanelScope) => void }) {
  const options: ReadonlyArray<{ id: PanelScope; label: string }> = [
    { id: 'personal', label: 'Personal' },
    { id: 'workspace', label: 'Workspace' },
  ]
  return (
    <div role="group" aria-label="Scope" className="mx-2 mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          type="button"
          aria-pressed={scope === option.id}
          onClick={() => onChange(option.id)}
          className={unstyledButton(cn(
            'h-7 rounded-md text-xs font-medium transition-colors',
            scope === option.id
              ? 'bg-(--surface-elevated) text-(--foreground) shadow-sm'
              : 'text-(--muted) hover:text-(--foreground)',
          ))}
        >
          {option.label}
        </Button>
      ))}
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

function SectionRows({ nav, rows }: { nav: SecondaryPanelNav; rows: ReadonlyArray<InlineNavItem> }) {
  const activeId = nav.activeChildId ?? nav.activeId
  return (
    <SidebarMenu>
      {rows.map((row) => {
        const Icon = nav.pendingId === row.id ? Loader2 : row.icon
        return (
          <SidebarMenuItem key={row.id}>
            <SidebarMenuButton
              isActive={activeId === row.id}
              disabled={row.locked}
              onClick={() => nav.onSelect(row.id)}
            >
              {Icon ? <Icon aria-hidden className={nav.pendingId === row.id ? 'animate-spin' : undefined} /> : null}
              <span>{row.label}</span>
            </SidebarMenuButton>
            {row.badgeCount ? <SidebarMenuBadge>{badgeLabel(row.badgeCount)}</SidebarMenuBadge> : null}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
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
  /** List Explore pages as plain rows (the phone drawer has no room for a side menu). */
  inlineExplore?: boolean
  children?: ReactNode
  className?: string
}

/**
 * The default app sidebar: brand, Personal/Workspace, the main pages (Files and Extensions under Explore), then the
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
  inlineExplore = false,
  children,
  className,
}: UnifiedSidebarProps) {
  const mainItems = items.filter((item) => !EXPLORE_ITEM_IDS.has(item.id))
  const exploreItems = items.filter((item) => EXPLORE_ITEM_IDS.has(item.id))
  const scopedNav = panelKind && panelKind !== 'settings' ? panelNav : undefined
  const rows = scopeChildren(scopedNav, scope, solo)
  const tabsPage = Boolean(panelKind && TAB_PANEL_KINDS.has(panelKind))

  useEffect(() => {
    if (!keyboardShortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      event.preventDefault()
      onCollapsedChange(!collapsed)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboardShortcut, collapsed, onCollapsedChange])

  useEffect(() => {
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
  }, [rows, scopedNav, tabsPage])
  useEffect(() => () => publishPageSubviews(null), [])

  const changeScope = (next: PanelScope) => {
    if (next === scope) return
    if (scopedNav) scopedNav.onSelect(next)
    else rememberPanelScope(next)
  }
  const sectionRows = !tabsPage && scopedNav && rows.length > 0 ? <SectionRows nav={scopedNav} rows={rows} /> : null

  return (
    <Sidebar
      aria-label="Sidebar"
      data-collapsed={collapsed}
      className={cn('border-r-0', collapsed ? 'w-14' : 'w-64', className)}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-1', collapsed ? 'justify-center px-2' : 'px-3')}>
        {collapsed ? (
          <Button
            variant="ghost"
            type="button"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={() => onCollapsedChange(false)}
            className={unstyledButton('inline-flex size-8 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
          >
            <PanelLeft size={16} aria-hidden />
          </Button>
        ) : (
          <>
            <div className="min-w-0 flex-1">{brand}</div>
            {onSearch ? (
              <Button
                variant="ghost"
                type="button"
                aria-label="Search"
                title="Search (⌘K)"
                onClick={onSearch}
                className={unstyledButton('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
              >
                <Search size={16} aria-hidden />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              type="button"
              aria-label="Collapse sidebar"
              title="Collapse sidebar (⌘B)"
              onClick={() => onCollapsedChange(true)}
              className={unstyledButton('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)')}
            >
              <PanelLeft size={16} aria-hidden />
            </Button>
          </>
        )}
      </div>
      {!collapsed && !solo ? <ScopeToggle scope={scope} onChange={changeScope} /> : null}
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {(inlineExplore ? items : mainItems).map((item) => <NavRow key={item.id} item={item} collapsed={collapsed} />)}
            {inlineExplore ? null : <ExploreMenu items={exploreItems} collapsed={collapsed} />}
          </SidebarMenu>
        </SidebarGroup>
        {!collapsed && sectionRows ? <SidebarGroup className="mt-3">{sectionRows}</SidebarGroup> : null}
        {!collapsed && (children || panelAction) ? (
          <SidebarResourceSection action={panelAction} search={null} className="mt-1 border-t-0">
            {children}
          </SidebarResourceSection>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="border-t-0">
        {footerItems.length > 0 ? (
          <SidebarMenu>
            {footerItems.map((item) => <NavRow key={item.id} item={item} collapsed={collapsed} />)}
          </SidebarMenu>
        ) : null}
        {account}
      </SidebarFooter>
    </Sidebar>
  )
}
