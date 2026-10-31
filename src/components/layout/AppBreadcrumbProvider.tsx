'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore, type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { AppBreadcrumbContext } from '@overlay/modules-react/shell'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { useOptionalAppSettings } from '@/components/providers/AppSettingsProvider'
import { getSidebarCollapsedSnapshot, setStoredSidebarCollapsed, subscribeToSidebarCollapsed } from './sidebar/sidebarCollapsedStore'

const getServerCollapsed = () => false

function ContextSidebarToggle() {
  const appSettings = useOptionalAppSettings()
  const collapsed = useSyncExternalStore(subscribeToSidebarCollapsed, getSidebarCollapsedSnapshot, getServerCollapsed)
  if (appSettings?.settings.useSecondarySidebar === false) return null
  return <Button variant="ghost" size="icon" className="context-sidebar-toggle hidden size-8 shrink-0 text-(--muted) md:inline-flex" aria-controls="app-context-sidebar" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar (⌘B)" onClick={() => setStoredSidebarCollapsed(!collapsed)}><PanelLeft size={16} aria-hidden /></Button>
}

const PAGE_LABELS: Record<string, string> = {
  work: 'Work', agents: 'Agents', chat: 'Chats', files: 'Files', automations: 'Automations',
  tools: 'Extensions', settings: 'Settings', archived: 'Archived', activity: 'Activity',
  memories: 'Memories', notes: 'Notes', outputs: 'Outputs', admin: 'Admin',
}

const UNSCOPED_SURFACES = new Set(['settings', 'archived', 'memories'])

export function breadcrumbItems({
  page,
  scope,
  href,
  unscopedHref,
}: {
  page: string
  scope: PanelScope
  href: string
  unscopedHref: string
}) {
  if (UNSCOPED_SURFACES.has(page)) {
    return [{ label: 'Settings', href: unscopedHref }]
  }
  return [
    { label: scope === 'workspace' ? 'Workspace' : 'Personal', href },
    { label: PAGE_LABELS[page] ?? page, href },
  ]
}

export function AppBreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app/chat'
  const scope = usePanelScope()
  const buildHref = useWorkspaceHref()
  const page = resolveWorkspaceSurface(pathname)
  const params = new URLSearchParams()
  if (page === 'chat') params.set('view', scope === 'workspace' ? 'workspace-chats' : 'personal')
  const route = `/app/${page}${params.size ? `?${params}` : ''}`
  const href = buildHref(null, route, scope)
  const unscopedHref = UNSCOPED_SURFACES.has(page) ? buildHref(null, '/app/settings') : href
  return (
    <AppBreadcrumbContext.Provider value={{
      items: breadcrumbItems({ page, scope, href, unscopedHref }),
      leading: <ContextSidebarToggle />,
      renderLink: (item, className) => <Link href={item.href!} className={className}>{item.label}</Link>,
    }}>
      {children}
    </AppBreadcrumbContext.Provider>
  )
}
