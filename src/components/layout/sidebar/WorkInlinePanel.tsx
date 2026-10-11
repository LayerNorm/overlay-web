'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import type { WorkItemDoc } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { listViewForScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { workItemKey, workItemStatusDotClass } from '@/shared/work/work-item-ui'

const rowClass =
  'flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

/**
 * The Work page's secondary-panel list: open items in the current scope,
 * newest first. Rows deep-link to `/app/work?item=<id>`; the shared panel
 * shell handles scope rows and the New task action above this list.
 */
export function WorkInlinePanel({
  workspaceId,
  baseHref = '/app/work',
  scope = 'personal',
  onNavigate,
}: {
  workspaceId: string | null
  baseHref?: string
  scope?: PanelScope
  onNavigate?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeItemId = pathname?.startsWith('/app/work') || baseHref !== '/app/work'
    ? searchParams?.get('item') ?? null
    : null
  const solo = useIsSoloWorkspace()
  const [items, setItems] = useState<WorkItemDoc[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const view = listViewForScope(scope, solo)
    overlayAppClient.workItems
      .list<WorkItemDoc[]>(
        view ? { view } : undefined,
        workspaceId ? { headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId } } : undefined,
      )
      .then((data) => { if (!cancelled) setItems(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [scope, solo, workspaceId])

  const openItems = useMemo(
    () => (items ?? []).filter((item) => item.status !== 'done' && !item.deletedAt),
    [items],
  )

  const openItem = useCallback((item: WorkItemDoc) => {
    onNavigate?.()
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('item', item._id)
    params.set('view', 'list')
    router.push(`${baseHref}?${params.toString()}`)
  }, [baseHref, onNavigate, router, searchParams])

  if (items === null) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--muted-light)]">
        <Loader2 size={12} className="animate-spin" /> Loading work…
      </div>
    )
  }

  if (openItems.length === 0) {
    return <div className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No open tasks</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {openItems.map((item) => (
        <button
          key={item._id}
          type="button"
          onClick={() => openItem(item)}
          className={`${rowClass} ${activeItemId === item._id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${workItemStatusDotClass(item.status)}`} />
          <span className="shrink-0 font-mono text-[10px] text-[var(--muted-light)]">{workItemKey(item)}</span>
          <span className="truncate">{item.title}</span>
        </button>
      ))}
    </div>
  )
}
