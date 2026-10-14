'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { WorkItem } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { withPanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkData } from '../components/WorkDataProvider'
import { useWorkRoute } from './use-work-route'

/**
 * The task a link or click named. It is usually in the list on screen; a link can also name one that is not (another
 * scope, or archived), which is read directly. `missing` means the server has no such task for this person.
 */
export function useWorkTask(taskId: string): { item: WorkItem | undefined; missing: boolean } {
  const { byId, state, adoptTask } = useWorkData()
  const [missingId, setMissingId] = useState<string | null>(null)
  const item = byId.get(taskId)
  const held = item !== undefined

  useEffect(() => {
    if (held || state !== 'ready') return
    let cancelled = false
    overlayAppClient.work.get(taskId)
      .then(({ item: found }) => { if (!cancelled) adoptTask(found) })
      .catch(() => { if (!cancelled) setMissingId(taskId) })
    return () => { cancelled = true }
  }, [adoptTask, held, state, taskId])

  return { item, missing: state === 'ready' && !held && missingId === taskId }
}

/** A task opens in the scope it lives in, so the list behind the panel agrees with it. */
export function useScopeFollowsTask(item: WorkItem | undefined) {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const { scope, solo } = useWorkRoute()
  useEffect(() => {
    if (!item || item.archivedAt !== null || solo || item.scope === scope) return
    const next = withPanelScope(new URLSearchParams(params?.toString() ?? ''), item.scope)
    if (item.scope === 'personal') next.set('scope', 'personal')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [item, params, pathname, router, scope, solo])
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
