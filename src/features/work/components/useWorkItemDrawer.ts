'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WorkItemDoc } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { describeWorkError, isWorkConflict } from '@/features/work/lib/work-errors'

export type WorkItemUpdate = Omit<Parameters<typeof overlayAppClient.workItems.update>[0], 'itemId' | 'expectedUpdatedAt'>

/**
 * State and actions behind the detail drawer: the item and its subtasks, one request at a time, and a message when a
 * request fails. Every change carries the revision being looked at, so an edit made elsewhere is a conflict, not an
 * overwrite; after any change the item is re-read so the form matches the server.
 */
export function useWorkItemDrawer({
  itemId,
  headers,
  onChanged,
  onDeleted,
}: {
  itemId: string
  headers?: RequestInit
  onChanged: () => void
  onDeleted: () => void
}) {
  const [item, setItem] = useState<WorkItemDoc | null>(null)
  const [children, setChildren] = useState<WorkItemDoc[]>([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const data = await overlayAppClient.workItems.get(itemId, headers)
    setItem(data.item)
    setChildren(data.children ?? [])
  }, [headers, itemId])

  useEffect(() => {
    let cancelled = false
    setItem(null)
    setChildren([])
    setMissing(false)
    setError(null)
    overlayAppClient.workItems
      .get(itemId, headers)
      .then((data) => {
        if (cancelled) return
        setItem(data.item)
        setChildren(data.children ?? [])
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [itemId, headers])

  /** Runs one request: shows progress, and on failure says why instead of failing silently. Returns whether it worked. */
  const run = useCallback(async (action: string, work: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await work()
      return true
    } catch (failure) {
      setError(describeWorkError(failure, action))
      if (isWorkConflict(failure)) await reload().catch(() => {})
      return false
    } finally {
      setBusy(false)
    }
  }, [reload])

  const patch = useCallback((body: WorkItemUpdate) =>
    run('save that change', async () => {
      if (!item) return
      await overlayAppClient.workItems.update({ ...body, itemId, expectedUpdatedAt: item.updatedAt }, headers)
      await reload()
      onChanged()
    }), [headers, item, itemId, onChanged, reload, run])

  const archiveOrRestore = useCallback((action: 'archive' | 'restore') =>
    run(action === 'archive' ? 'archive that task' : 'restore that task', async () => {
      await overlayAppClient.workItems.update({ itemId, action }, headers)
      await reload()
      onChanged()
    }), [headers, itemId, onChanged, reload, run])

  const addSubtask = useCallback((title: string) =>
    run('add that subtask', async () => {
      if (!item) return
      // A subtask lives in its parent's scope.
      await overlayAppClient.workItems.create({ title, parentItemId: itemId, ...(item.scope ? { scope: item.scope } : {}) }, headers)
      await reload()
    }), [headers, item, itemId, reload, run])

  const remove = useCallback(async () => {
    const deleted = await run('delete that task', async () => {
      await overlayAppClient.workItems.delete({ itemId }, headers)
    })
    if (deleted) onDeleted()
    return deleted
  }, [headers, itemId, onDeleted, run])

  return { item, children, missing, busy, error, patch, archiveOrRestore, addSubtask, remove }
}
