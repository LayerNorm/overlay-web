'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { subscribeIntegrationsChanged } from '@/shared/integrations/integrations-events'

const POLL_MS = 3_000
const GIVE_UP_MS = 2 * 60_000

/**
 * Tracks a connector whose sign-in is finishing in another tab. While one is pending it re-checks the connected set on
 * cross-tab change events, when this tab becomes visible again, and every few seconds, so the original tab updates in
 * place even when the callback tab could not notify it. Gives up quietly after two minutes.
 */
export function usePendingConnection({
  load,
  onConnected,
}: {
  load: () => Promise<ReadonlySet<string> | null>
  onConnected: (providerKey: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const isConnected = useEffectEvent(async (providerKey: string) => (await load().catch(() => null))?.has(providerKey) === true)
  const notifyConnected = useEffectEvent(onConnected)

  useEffect(() => {
    if (!pending) return
    let settled = false
    const check = async () => {
      if (settled || !(await isConnected(pending)) || settled) return
      settled = true
      setPending(null)
      notifyConnected(pending)
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (Date.now() - startedAt > GIVE_UP_MS) setPending(null)
      else void check()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = subscribeIntegrationsChanged(() => void check())
    return () => {
      settled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [pending])

  return [pending, setPending] as const
}
