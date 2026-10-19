'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { WORK_UPDATED_EVENT, type WorkContext, type WorkItem } from '@overlay/app-core'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { matchesFilter, parseWorkFilter, sortByRank, type WorkFilter, type WorkViewer } from '@/shared/work/query'
import { useWorkRoute } from '../lib/use-work-route'
import { WORK_TASK_PARAM } from '../lib/use-work-url-state'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
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

/** The three sidebar sections share one load per scope, so opening Work asks the server once. */
let shared: { key: string; promise: Promise<SidebarWork> } | null = null

function loadSidebarWork(key: string, listView: PanelScope | undefined, force: boolean): Promise<SidebarWork> {
  if (!force && shared?.key === key) return shared.promise
  const promise = Promise.all([
    overlayAppClient.work.list(listView ? { view: listView } : undefined),
    overlayAppClient.work.context().catch(() => null),
  ]).then(([list, context]) => ({ items: list.items, context }))
  shared = { key, promise }
  promise.catch(() => { if (shared?.promise === promise) shared = null })
  return promise
}

function useSidebarWork(): SidebarWork | null {
  const { listView } = useWorkRoute()
  const key = listView ?? 'all'
  const [data, setData] = useState<SidebarWork | null>(null)
  const load = useCallback((force: boolean) => {
    let live = true
    loadSidebarWork(key, listView, force).then((next) => { if (live) setData(next) }, () => { if (live) setData({ items: [], context: null }) })
    return () => { live = false }
  }, [key, listView])
  useEffect(() => load(false), [load])
  useEffect(() => {
    const reload = () => { load(true) }
    window.addEventListener(WORK_UPDATED_EVENT, reload)
    return () => window.removeEventListener(WORK_UPDATED_EVENT, reload)
  }, [load])
  useWorkspaceChanged(useCallback(() => {
    setData(null)
    load(true)
  }, [load]))
  return data
}

/** One Work section in the sidebar (Needs you, Assigned to me, Everything) listing its open tasks. */
export function WorkSidebarSection({ filter, onNavigate }: { filter: string; onNavigate?: () => void }) {
  const data = useSidebarWork()
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
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
    router.push(`${pathname}?${next.toString()}`, { scroll: false })
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
