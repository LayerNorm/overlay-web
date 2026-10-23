'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppBreadcrumbContext } from '@overlay/modules-react/shell'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { resolvePanelScope, resolvePanelScopeFromParams } from '@/shared/workspaces/panel-scope'
import { resolveWorkspaceSurface, readWorkspaceIdFromPath, buildWorkspaceHref } from '@/shared/workspaces/routing'
import { chatScopeForView } from './sidebar/appSidebarNav'

const PAGE_LABELS: Record<string, string> = {
  work: 'Work', agents: 'Agents', chat: 'Chats', files: 'Files', automations: 'Automations',
  tools: 'Extensions', settings: 'Settings', archived: 'Archived', activity: 'Activity',
  memories: 'Memories', notes: 'Notes', outputs: 'Outputs', admin: 'Admin',
}

export function AppBreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app/chat'
  const savedScope = usePanelScope()
  const searchParams = useSearchParams()
  const solo = useIsSoloWorkspace()
  const page = resolveWorkspaceSurface(pathname)
  const scope = page === 'chat' || page === 'activity'
    ? resolvePanelScope({ param: chatScopeForView(page === 'activity' ? 'activity' : searchParams?.get('view') ?? 'personal'), solo })
    : page === 'agents' ? resolvePanelScopeFromParams(searchParams, savedScope, solo) : savedScope
  const workspaceId = readWorkspaceIdFromPath(pathname)
  const base = workspaceId ? buildWorkspaceHref(workspaceId, `/app/${page}`) : `/app/${page}`
  const params = new URLSearchParams({ scope })
  if (page === 'chat') params.set('view', scope === 'workspace' ? 'workspace-chats' : 'personal')
  const href = `${base}?${params}`
  return (
    <AppBreadcrumbContext.Provider value={{
      items: [
        { label: scope === 'workspace' ? 'Workspace' : 'Personal', href },
        { label: PAGE_LABELS[page] ?? page, href },
      ],
      renderLink: (item, className) => <Link href={item.href!} className={className}>{item.label}</Link>,
    }}>
      {children}
    </AppBreadcrumbContext.Provider>
  )
}
