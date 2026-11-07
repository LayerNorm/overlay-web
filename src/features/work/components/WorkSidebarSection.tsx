'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WorkContext, WorkItem } from '@overlay/app-core'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { matchesFilter, parseWorkFilter, sortByRank, type WorkFilter, type WorkViewer } from '@/shared/work/query'
import { useWorkRoute } from '../lib/use-work-route'
import { useLiveWork } from '../lib/use-live-work'
import { WORK_TASK_PARAM } from '../lib/use-work-url-state'
import { StatusIcon } from './work-ui'

interface SidebarWork {
  items: WorkItem[]
  context: WorkContext | null
}

const EMPTY_LABEL: Record<WorkFilter, string> = {
  'needs-you': 'Nothing needs you',
  mine: 'Nothing assigned to you',
  all: 'No open tasks',
}

/** The sidebar sections read the same live subscription as the Work page, so they always agree with it. */
function useSidebarWork(): SidebarWork | null {
  const { listView } = useWorkRoute()
  const { items, context } = useLiveWork(listView)
  return useMemo(() => (items === undefined ? null : { items: items ?? [], context }), [context, items])
}

/** One Work section in the sidebar (Needs you, Assigned to me, Everything) listing its open tasks. */
export function WorkSidebarSection({ filter, onNavigate }: { filter: string; onNavigate?: () => void }) {
  const data = useSidebarWork()
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const { scope } = useWorkRoute()
  const buildWorkspaceHref = useWorkspaceHref()
  const activeId = params?.get(WORK_TASK_PARAM) ?? null
  const resolved = parseWorkFilter(filter)
  const userId = user?.id
  const items = useMemo(() => {
    const viewer: WorkViewer | null = userId && data?.context ? { userId, principalId: data.context.principalId } : null
    return sortByRank((data?.items ?? []).filter((item) => (
      item.status !== 'done' && item.archivedAt === null && matchesFilter(item, resolved, viewer)
    )))
  }, [data, resolved, userId])
  const listClassName = 'ml-0 border-l-0 pl-0'

  if (!data) {
    return (
      <SidebarMenuSub className={listClassName}>
        <SidebarListSkeleton rows={3} />
      </SidebarMenuSub>
    )
  }
  if (items.length === 0) {
    return (
      <SidebarMenuSub className={listClassName}>
        <SidebarMenuSubItem>
          <p className="px-2 py-1.5 text-xs text-(--muted-light)">{EMPTY_LABEL[resolved]}</p>
        </SidebarMenuSubItem>
      </SidebarMenuSub>
    )
  }
  const open = (id: string) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    next.set(WORK_TASK_PARAM, id)
    const route = buildWorkspaceHref(null, `${pathname}?${next.toString()}`, scope)
    router.push(route, { scroll: false })
    onNavigate?.()
  }
  return (
    <SidebarMenuSub className={listClassName} data-testid={`work-sidebar-${resolved}`}>
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <SidebarMenuSubItem key={item.id}>
            <SidebarMenuSubButton
              isActive={active}
              aria-current={active ? 'page' : undefined}
              onClick={() => open(item.id)}
              className="h-8 gap-2.5 text-sm"
            >
              <StatusIcon status={item.status} size={14} />
              <span className="flex-1 truncate">{item.title}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
    </SidebarMenuSub>
  )
}
