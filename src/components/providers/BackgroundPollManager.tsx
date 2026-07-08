'use client'

import { useEffect, useRef } from 'react'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuth } from '@/contexts/AuthContext'

export default function BackgroundPollManager() {
  const { user, isLoading: authLoading } = useAuth()
  const { appDataCapabilities } = useOverlayCapabilities()
  const authUserId = user?.id ?? null
  const { sessions, completeSession, activeViewerIds } = useAsyncSessions()
  const sessionsRef = useRef(sessions)
  const completeSessionRef = useRef(completeSession)
  const activeViewerIdsRef = useRef(activeViewerIds)

  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { completeSessionRef.current = completeSession }, [completeSession])
  useEffect(() => { activeViewerIdsRef.current = activeViewerIds }, [activeViewerIds])

  /** Warm personalized chat starters cache early so empty-chat chips rarely wait on the network. */
  useEffect(() => {
    if (authLoading || !authUserId) return
    if (appDataCapabilities.provider === 'postgres') return
    const run = () => {
      void fetch('/api/v1/chat-suggestions', { credentials: 'same-origin' }).catch(() => {})
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 8000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(run, 2000)
    return () => window.clearTimeout(t)
  }, [appDataCapabilities.provider, authLoading, authUserId])

  useEffect(() => {
    if (authLoading || !authUserId) return
    const interval = setInterval(async () => {
      const pending = Object.values(sessionsRef.current).filter(
        (session) => session.status === 'streaming' && !session.id.startsWith('__overlay_'),
      )
      if (pending.length === 0) return

      await Promise.all(
        pending.map(async (session) => {
          try {
            const url = `/api/v1/conversations?conversationId=${session.id}&messages=true`
            const res = await fetch(url)
            if (!res.ok) return
            const data = await res.json()
            const messages: unknown[] = data.messages || []
            if (messages.length > session.messageCountAtStart + 1) {
              const currentViewer = activeViewerIdsRef.current.conversation
              completeSessionRef.current(session.id, currentViewer === session.id)
            }
          } catch {
            // ignore transient errors
          }
        })
      )
    }, 5000)

    return () => clearInterval(interval)
  }, [authLoading, authUserId])

  return null
}
