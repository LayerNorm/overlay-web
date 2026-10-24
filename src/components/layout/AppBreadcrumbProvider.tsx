'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppBreadcrumbContext } from '@overlay/modules-react/shell'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'

const PAGE_LABELS: Record<string, string> = {
  work: 'Work', agents: 'Agents', chat: 'Chats', files: 'Files', automations: 'Automations',
  tools: 'Extensions', settings: 'Settings', archived: 'Archived', activity: 'Activity',
  memories: 'Memories', notes: 'Notes', outputs: 'Outputs', admin: 'Admin',
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
