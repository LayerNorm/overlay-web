'use client'

import { useState } from 'react'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@overlay/ui/primitives'
import { useShellAdapter } from '../adapter'
import type { InlineNavItem, SecondaryPanelNav } from '../types'
import { groupSettingsItems } from './settingsSearch'

function SettingsRow({ item, nav, collapsed }: { item: InlineNavItem; nav: SecondaryPanelNav; collapsed: boolean }) {
  const { Link } = useShellAdapter()
  const pending = nav.pendingId === item.id
  const Icon = pending ? Loader2 : item.icon
  const active = nav.activeId === item.id
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={collapsed ? 'justify-center px-0' : undefined}
      >
        <Link
          href={item.href ?? `/app/settings?section=${item.id}`}
          aria-label={item.label}
          onClick={() => nav.onSelect(item.id)}
        >
          {Icon ? <Icon aria-hidden className={pending ? 'animate-spin' : undefined} /> : null}
          {collapsed ? null : <span>{item.label}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** The sidebar body while Settings is open: back to the app, a settings search, then the settings pages. */
export function SettingsSidebarNav({
  nav,
  collapsed,
  onBack,
  settingsGroups,
}: {
  nav: SecondaryPanelNav
  collapsed: boolean
  onBack?: () => void
  settingsGroups?: ReadonlyArray<{ label: string; ids: readonly string[] }>
}) {
  const [query, setQuery] = useState('')
  const groups = groupSettingsItems(nav.items, collapsed ? '' : query, settingsGroups)
  return (
    <>
      <SidebarGroup className="pb-0">
        <SidebarMenu>
          {onBack ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                title={collapsed ? 'Back to app' : undefined}
                aria-label="Back to app"
                className={collapsed ? 'justify-center px-0' : undefined}
                onClick={onBack}
              >
                <ArrowLeft aria-hidden />
                {collapsed ? null : <span>Back to app</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
        {collapsed ? null : (
          <div role="search" className="relative mt-1.5">
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--muted-light)" />
            <SidebarInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-8 rounded-lg border-transparent bg-(--surface-subtle) pl-8 text-sm focus:border-(--border)"
            />
          </div>
        )}
      </SidebarGroup>
      {groups.map((group) => (
        <SidebarGroup key={group.label} className="mt-2">
          {collapsed ? null : (
            <SidebarGroupLabel className="text-xs font-normal tracking-normal normal-case text-(--muted)">{group.label}</SidebarGroupLabel>
          )}
          <SidebarMenu>
            {group.items.map((item) => <SettingsRow key={item.id} item={item} nav={nav} collapsed={collapsed} />)}
          </SidebarMenu>
        </SidebarGroup>
      ))}
      {groups.length === 0 ? <p className="px-4 py-2 text-sm text-(--muted)">No settings match.</p> : null}
    </>
  )
}
