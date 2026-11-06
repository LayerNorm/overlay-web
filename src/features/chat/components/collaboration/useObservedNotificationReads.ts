'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { toast } from '@overlay/ui/primitives'
import type { NativeActivity } from '@/components/providers/native-activity-context'

function activityScope(native: NativeActivity | null) {
  return JSON.stringify([native?.counts?.workspaceId, native?.counts?.viewerUserId])
}

export function useObservedNotificationReads(native: NativeActivity | null, renderedIds: string[]) {
  const listRef = useRef<HTMLUListElement>(null)
  const latest = useRef(native)
  const attempts = useRef({ scope: activityScope(native), pending: new Set<string>(), failed: new Set<string>() })
  const retryVisible = useRef<(() => void) | null>(null)
  const scope = activityScope(native)
  const renderedKey = JSON.stringify(renderedIds)
  const ready = native?.ready ?? false
  useLayoutEffect(() => {
    latest.current = native
    if (attempts.current.scope !== scope) attempts.current = { scope, pending: new Set(), failed: new Set() }
    return () => { latest.current = null }
  }, [native, scope])
  useEffect(() => {
    if (!ready || !listRef.current || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    let active = true
    const attempt = attempts.current
    const markVisible = () => {
      const current = latest.current
      if (!active || !current?.ready || activityScope(current) !== scope || document.visibilityState !== 'visible') return
      const items = current.notifications.filter(item => visible.has(item.id) && item.readAt === undefined
        && !attempt.pending.has(item.id) && !attempt.failed.has(item.id))
      if (!items.length) return
      items.forEach(item => attempt.pending.add(item.id))
      void current.mark(items.map(item => item.id), Math.max(...items.map(item => item.createdAt)))
        .catch(() => {
          items.forEach(item => attempt.failed.add(item.id))
          if (activityScope(latest.current) !== scope) return
          toast.error('Notifications could not be marked read', { action: { label: 'Retry', onClick: () => {
            if (activityScope(latest.current) !== scope || attempts.current !== attempt) return
            items.forEach(item => attempt.failed.delete(item.id))
            retryVisible.current?.()
          } } })
        }).finally(() => { items.forEach(item => attempt.pending.delete(item.id)) })
    }
    const observer = new IntersectionObserver(entries => {
      if (!active) return
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.notificationId
        if (!id) continue
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(id)
        else { visible.delete(id); attempt.failed.delete(id) }
      }
      markVisible()
    }, { threshold: 0.5 })
    retryVisible.current = markVisible
    const observe = () => {
      visible.clear()
      observer.disconnect()
      if (document.visibilityState === 'visible') listRef.current?.querySelectorAll('[data-notification-id]').forEach(row => observer.observe(row))
    }
    document.addEventListener('visibilitychange', observe)
    observe()
    return () => { active = false; observer.disconnect(); if (retryVisible.current === markVisible) retryVisible.current = null; document.removeEventListener('visibilitychange', observe) }
  }, [ready, renderedKey, scope])
  return listRef
}
