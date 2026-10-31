'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Loader2, PanelLeft, Plus, Search } from 'lucide-react'
import { cn } from '@overlay/ui'
import { Button, PanelResizeHandle, Sidebar, SidebarContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { useShellAdapter } from '../adapter'
import type { PrimaryRailItem, SecondaryPanelNav } from '../types'
import { PageSections } from './PageSections'
import { SettingsSidebarNav } from './SettingsSidebarNav'
import { publishPageSubviews } from './pageSubviewStore'
import { groupMoreItems, MoreMenu, NavRow, ScopeToggle, scopeChildren, useCollapseShortcut, type UnifiedSidebarProps } from './UnifiedSidebar'

const MORE_GROUPS = [{ ids: ['files', 'extensions', 'automations'] }]

export function selectDoubleSidebarItem(item: PrimaryRailItem, collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void) {
  if (item.disabled) return
  if (item.active) {
    onCollapsedChange(!collapsed)
    return
  }
  onCollapsedChange(false)
  item.onSelect()
}

function PanelViews({ nav, scope }: Pick<UnifiedSidebarProps, 'scope'> & { nav: SecondaryPanelNav }) {
  const rows = scopeChildren(nav, scope)
  return (
    <SidebarMenu className="px-2 pb-2">
      {rows.map((row) => {
        const Icon = nav.pendingId === row.id ? Loader2 : row.icon
        return (
          <SidebarMenuItem key={row.id}>
            <SidebarMenuButton
              isActive={(nav.activeChildId ?? nav.activeId) === row.id}
              disabled={row.locked}
              onClick={() => nav.onSelect(row.id)}
              className="h-[34px] rounded-lg px-2.5"
            >
              {Icon ? <Icon aria-hidden className={nav.pendingId === row.id ? 'animate-spin' : 'text-(--muted)'} /> : null}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.badgeCount ? <span className="text-xs text-(--muted)">{row.badgeCount}</span> : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export interface DoubleSidebarProps extends UnifiedSidebarProps {
  title: string
  panelId?: string
  themePreset?: string
  railBrand: ReactNode
}

/** The rail stays mounted and usable while only the contextual panel collapses. */
export function DoubleSidebar({
  railBrand, title, collapsed, onCollapsedChange, items, footerItems = [], panelKind,
  panelNav, panelAction, sectionActions, renderSection, sectionRows, onSearch, scope,
  account, keyboardShortcut = false, resizable = false, settingsGroups, children,
  className, panelId, themePreset,
}: DoubleSidebarProps) {
  const { rememberScope } = useShellAdapter()
  const [width, setWidth] = useState(272)
  const [resizing, setResizing] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const settingsNav = panelKind === 'settings' ? panelNav : undefined
  const scopedNav = settingsNav ? undefined : panelNav
  const select = (item: PrimaryRailItem) => ({
    ...item,
    onSelect: () => selectDoubleSidebarItem(item, collapsed, onCollapsedChange),
  })
  const destinations = items.filter((item) => item.id !== 'settings-close').map(select)
  const moreGroups = groupMoreItems(destinations, MORE_GROUPS)
  const moreIds = new Set(moreGroups.flatMap((group) => group.items.map((item) => item.id)))
  const rows = scopedNav ? scopeChildren(scopedNav, scope) : []
  const groupedResources = panelKind === 'chat' || panelKind === 'work'

  useCollapseShortcut(keyboardShortcut, collapsed, onCollapsedChange)
  useEffect(() => {
    // The context panel owns these views, instead of duplicating them in page headers.
    publishPageSubviews(null)
  }, [])
  useEffect(() => {
    if (collapsed && panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus()
  }, [collapsed])

  return (
    <div data-double-sidebar data-shell-preset={themePreset} className={cn('double-sidebar flex h-full shrink-0', className)}>
      <Sidebar aria-label="Primary navigation" className="double-sidebar-rail w-[60px] overflow-visible border-0 bg-transparent px-2.5 py-1.5">
        <div className="mb-2.5 flex size-10 shrink-0 items-center justify-center">{railBrand}</div>
        <SidebarContent className="overflow-visible">
          <nav aria-label="Primary">
            <SidebarMenu className="gap-1">
              {destinations.filter((item) => !moreIds.has(item.id)).map((item) => (
                <NavRow key={item.id} item={item} collapsed />
              ))}
              <MoreMenu groups={moreGroups} collapsed />
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <div className="mt-auto flex flex-col gap-1">
          <DelayedTooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <Button ref={toggleRef} variant="ghost" size="icon" className="double-sidebar-toggle size-10 text-(--muted)"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls={panelId}
              onClick={() => onCollapsedChange(!collapsed)}><PanelLeft size={16} aria-hidden /></Button>
          </DelayedTooltip>
          <SidebarMenu className="gap-1">{footerItems.map((item) => <NavRow key={item.id} item={item.id === 'settings' ? select(item) : item} collapsed />)}</SidebarMenu>
          {account}
        </div>
      </Sidebar>
      <Sidebar
        ref={panelRef}
        id={panelId}
        aria-label={`${title} sidebar`}
        aria-hidden={collapsed}
        inert={collapsed}
        data-collapsed={collapsed}
        style={{ '--context-sidebar-width': `${width}px` } as CSSProperties}
        className={cn('double-sidebar-panel border-0 bg-transparent transition-[width,opacity] duration-200 motion-reduce:transition-none', collapsed ? 'invisible w-0 opacity-0' : 'w-(--context-sidebar-width) opacity-100', resizing && 'transition-none')}
      >
        <div className="flex h-12 min-h-12 items-center gap-0.5 pl-3 pr-1.5">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold capitalize tracking-tight">{title}</h2>
          {onSearch ? <DelayedTooltip label="Search" side="bottom"><Button variant="ghost" size="icon" aria-label={`Search ${title.toLowerCase()}`} onClick={onSearch} className="size-8 text-(--muted)"><Search size={16} aria-hidden /></Button></DelayedTooltip> : null}
          {panelAction ? <DelayedTooltip label={panelAction.label} side="bottom"><Button variant="ghost" size="icon" aria-label={panelAction.label} onClick={panelAction.onClick} className="size-8 text-(--muted)"><Plus size={16} aria-hidden /></Button></DelayedTooltip> : null}
        </div>
        {!settingsNav ? <ScopeToggle scope={scope} workspaceLocked={false} onChange={(next) => { if (next !== scope) { if (scopedNav) scopedNav.onSelect(next); else rememberScope(next) } }} /> : null}
        <SidebarContent className="pb-3">
          {settingsNav ? <SettingsSidebarNav nav={settingsNav} collapsed={false} onBack={items.find((item) => item.id === 'settings-close')?.onSelect} settingsGroups={settingsGroups} /> : (
            <>
              {!groupedResources && scopedNav ? <PanelViews nav={scopedNav} scope={scope} /> : null}
              {panelKind === 'work' && scopedNav ? <PanelViews nav={scopedNav} scope={scope} /> : null}
              {groupedResources ? (
                <PageSections nav={scopedNav} rows={panelKind === 'work' ? sectionRows ?? [] : rows} title={panelKind === 'chat' ? 'Recents' : title} sectionActions={sectionActions} renderSection={renderSection}>
                  {children}
                </PageSections>
              ) : <div className="px-2">{children}</div>}
            </>
          )}
        </SidebarContent>
        {resizable && !collapsed ? <PanelResizeHandle edge="right" width={width} onResize={setWidth} onResizingChange={setResizing} minWidth={220} maxWidth={360} label="Resize contextual sidebar" /> : null}
      </Sidebar>
    </div>
  )
}
