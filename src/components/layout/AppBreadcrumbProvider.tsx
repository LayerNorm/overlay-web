'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppBreadcrumbContext } from '@overlay/modules-react/shell'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { resolveWorkspaceSurface, readWorkspaceIdFromPath, buildWorkspaceHref } from '@/shared/workspaces/routing'

const PAGE_LABELS: Record<string, string> = {
  work: 'Work', agents: 'Agents', chat: 'Chats', files: 'Files', automations: 'Automations',
  tools: 'Extensions', settings: 'Settings', archived: 'Archived', activity: 'Activity',
  memories: 'Memories', notes: 'Notes', outputs: 'Outputs', admin: 'Admin',
}

export function AppBreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app/chat'
  const scope = usePanelScope()
  const page = resolveWorkspaceSurface(pathname)
  const workspaceId = readWorkspaceIdFromPath(pathname)
  const base = workspaceId ? buildWorkspaceHref(workspaceId, `/app/${page}`) : `/app/${page}`
  const href = `${base}?scope=${scope}`
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
