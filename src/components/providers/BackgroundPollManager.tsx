'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { coalesceRequest } from '@/shared/observability/request-coalescer'

export default function BackgroundPollManager() {
  const { user, isLoading: authLoading } = useAuth()
  const authUserId = user?.id ?? null

  /** Warm personalized chat starters cache early so empty-chat chips rarely wait on the network. */
  // Client-side data load on mount — no server data layer in this app.
  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect
  useEffect(() => {
    if (authLoading || !authUserId) return
    const run = () => {
      void coalesceRequest('chat-suggestions', () =>
        fetch('/api/v1/chat-suggestions', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`chat-suggestions ${r.status}`)))),
      ).catch(() => {})
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 8000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(run, 2000)
    return () => window.clearTimeout(t)
  }, [authLoading, authUserId])

  return null
}
