'use client'

import { useEffect, useRef } from 'react'
import { createSingleFlightReconciler } from '@/shared/events/single-flight-reconciler'

const DEFAULT_RECONCILIATION_INTERVAL_MS = 15_000

/**
 * Reconciles server-authoritative state while a surface is visible and
 * immediately after a user returns to the tab.
 */
export function useVisibleReconciliation(
  reconcile: () => Promise<void>,
  intervalMs = DEFAULT_RECONCILIATION_INTERVAL_MS,
): void {
  const reconcileRef = useRef(reconcile)
  useEffect(() => {
    reconcileRef.current = reconcile
  }, [reconcile])

  useEffect(() => {
    const controller = createSingleFlightReconciler({
      reconcile: async () => await reconcileRef.current(),
      shouldRun: () => document.visibilityState === 'visible',
    })
    const trigger = () => {
      void controller.trigger().catch(() => undefined)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') trigger()
    }
    const interval = window.setInterval(trigger, Math.max(1_000, intervalMs))
    window.addEventListener('focus', trigger)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', trigger)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      controller.dispose()
    }
  }, [intervalMs])
}
