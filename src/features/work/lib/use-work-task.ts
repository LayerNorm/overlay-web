'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WorkItem } from '@overlay/app-core'
import { isResourceInPanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useWorkData } from '../components/WorkDataProvider'
import { useWorkRoute } from './use-work-route'
import { useLiveWorkTask } from './use-live-work'

/**
 * The task a link or click named. It is usually in the list on screen; a link can also name one that is not (another
 * scope, archived, or past the list window), which is read live on its own. `missing` means there is no such task for
 * this person, or it was deleted or hidden while open.
 */
export function useWorkTask(taskId: string): { item: WorkItem | undefined; missing: boolean } {
  const { byId, state, adoptTask } = useWorkData()
  const { scope } = useWorkRoute()
  const listed = byId.get(taskId)
  const direct = useLiveWorkTask(listed ? null : taskId)
  const inScope = direct ? isResourceInPanelScope(direct.scope, scope, direct.archivedAt !== null) : false
  useEffect(() => {
    if (direct && inScope) adoptTask(direct.id)
  }, [adoptTask, direct, inScope])
  return { item: listed ?? direct ?? undefined, missing: state === 'ready' && !listed && direct === null }
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
    // The href builder merges the task's own query with the scope it adds; appending it afterwards produced
    // `?scope=personal?task=…`, which dropped the open task and fell back to the other scope.
    router.replace(buildWorkspaceHref(null, `${pathname}${query ? `?${query}` : ''}`, item.scope), { scroll: false })
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
