'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, RotateCcw } from 'lucide-react'
import type { ScopedResourceKind } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import type { ResourceScope } from '@/shared/workspaces/resource-scope'
import { ScopeTag } from './ScopeTag'

export interface ArchivedScopeItem {
  id: string
  name: string
  /** Where it was archived from; restoring returns it there. */
  from: ResourceScope
  href?: string
  icon?: ReactNode
}

/**
 * The list under Archived in a scoped secondary panel: everything archived from Personal or Workspace, each with a tag
 * saying which, and a restore button on hover that returns it to where it came from.
 */
export function ArchivedScopeList({
  resource,
  load,
  emptyLabel = 'Nothing archived',
  onOpen,
  onRestored,
}: {
  resource: ScopedResourceKind
  load: (signal?: AbortSignal) => Promise<ArchivedScopeItem[]>
  emptyLabel?: string
  onOpen?: () => void
  onRestored?: (item: ArchivedScopeItem) => void
}) {
  const [items, setItems] = useState<ArchivedScopeItem[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setItems(await load())
      setFailed(false)
    } catch {
      setFailed(true)
      setItems((current) => current ?? [])
    }
  }, [load])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useWorkspaceChanged(refresh)

  async function restore(item: ArchivedScopeItem) {
    setBusyId(item.id)
    try {
      await overlayAppClient.scope.restore(resource, item.id)
      setItems((current) => current?.filter((row) => row.id !== item.id) ?? current)
      onRestored?.(item)
    } catch {
      setFailed(true)
    } finally {
      setBusyId(null)
    }
  }

  if (items === null) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--muted-light)]">
        <Loader2 size={13} className="animate-spin" /> Loading...
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      {failed ? <p role="alert" className="px-2.5 py-1 text-xs text-red-500">Something went wrong. Try again.</p> : null}
      {items.length === 0 ? <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">{emptyLabel}</p> : null}
      {items.map((item) => {
        const label = <span className="min-w-0 flex-1 truncate">{item.name}</span>
        return (
          <div
            key={item.id}
            className="group/archived flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            {item.icon}
            {item.href ? (
              <Link href={item.href} onClick={onOpen} className="flex min-w-0 flex-1 items-center">{label}</Link>
            ) : label}
            <ScopeTag scope={item.from} />
            <button
              type="button"
              title={`Restore to ${item.from === 'workspace' ? 'Workspace' : 'Personal'}`}
              aria-label={`Restore ${item.name}`}
              disabled={busyId === item.id}
              onClick={() => void restore(item)}
              className="hidden shrink-0 rounded p-0.5 text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50 group-hover/archived:block"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
