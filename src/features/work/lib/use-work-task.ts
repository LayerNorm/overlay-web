'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WorkItem } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { isResourceInPanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useWorkData } from '../components/WorkDataProvider'
import { useWorkRoute } from './use-work-route'

/**
 * The task a link or click named. It is usually in the list on screen; a link can also name one that is not (another
 * scope, or archived), which is read directly. `missing` means the server has no such task for this person.
 */
export function useWorkTask(taskId: string): { item: WorkItem | undefined; missing: boolean } {
  const { byId, state, adoptTask } = useWorkData()
  const [missingId, setMissingId] = useState<string | null>(null)
  const [resolved, setResolved] = useState<{ id: string; item: WorkItem } | null>(null)
  const { scope } = useWorkRoute()
  const item = byId.get(taskId)
  const resolvedItem = resolved?.id === taskId ? resolved.item : undefined
  const held = item !== undefined || resolvedItem !== undefined

  useEffect(() => {
    if (held || state !== 'ready') return
    let cancelled = false
    overlayAppClient.work.get(taskId)
      .then(({ item: found }) => {
        if (cancelled) return
        setResolved({ id: taskId, item: found })
        if (isResourceInPanelScope(found.scope, scope, found.archivedAt !== null)) adoptTask(found)
      })
      .catch(() => { if (!cancelled) setMissingId(taskId) })
    return () => { cancelled = true }
  }, [adoptTask, held, scope, state, taskId])

  useEffect(() => {
    if (resolvedItem && isResourceInPanelScope(resolvedItem.scope, scope, resolvedItem.archivedAt !== null)) {
      adoptTask(resolvedItem)
    }
  }, [adoptTask, resolvedItem, scope])

  return { item: item ?? resolvedItem, missing: state === 'ready' && !held && missingId === taskId }
}

/** A task opens in the scope it lives in, so the list behind the panel agrees with it. */
export function useScopeFollowsTask(item: WorkItem | undefined) {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const { scope } = useWorkRoute()
  const buildWorkspaceHref = useWorkspaceHref()
  const scopeMatches = !item || isResourceInPanelScope(item.scope, scope, item.archivedAt !== null)
  useEffect(() => {
    if (!item || item.archivedAt !== null || item.scope === scope) return
    const next = new URLSearchParams(params?.toString() ?? '')
    next.delete('scope')
    const query = next.toString()
    const route = buildWorkspaceHref(null, pathname, item.scope)
    router.replace(`${route}${query ? `?${query}` : ''}`, { scroll: false })
  }, [buildWorkspaceHref, item, params, pathname, router, scope])
  return scopeMatches
}

/** Escape closes the panel, unless a text field or an open picker has it first. */
export function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (document.querySelector('[data-work-menu]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}
