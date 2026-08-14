'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunResource } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'waiting_for_approval'])
const POLL_INTERVAL_MS = 2_000
const TERMINAL_SYNC_GRACE_MS = 10_000

export function useAgentRunLifecycle({
  conversationId,
  enabled,
  localStreamActive,
}: {
  conversationId: string | null
  enabled: boolean
  localStreamActive: boolean
}) {
  const [snapshot, setSnapshot] = useState<{
    conversationId: string | null
    run: AgentRunResource | null
  }>({ conversationId: null, run: null })
  const snapshotRef = useRef(snapshot)
  const activeRunRef = useRef<AgentRunResource | null>(null)
  const reconnectedRunIdsRef = useRef(new Set<string>())
  const [terminalSyncUntil, setTerminalSyncUntil] = useState(0)
  const [terminalSyncConversationId, setTerminalSyncConversationId] = useState<string | null>(null)
  const run = snapshot.conversationId === conversationId ? snapshot.run : null

  const refresh = useCallback(async () => {
    if (!enabled || !conversationId) {
      const nextSnapshot = { conversationId, run: null }
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      return null
    }
    try {
      const next = await overlayAppClient.conversations.currentRun(conversationId, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const current = snapshotRef.current
      const currentRun = current.conversationId === conversationId ? current.run : null
      const wasActive = Boolean(currentRun && ACTIVE_STATUSES.has(currentRun.status))
      const isActive = Boolean(next.run && ACTIVE_STATUSES.has(next.run.status))
      if (wasActive && !isActive) {
        setTerminalSyncUntil(Date.now() + TERMINAL_SYNC_GRACE_MS)
        setTerminalSyncConversationId(conversationId)
      }
      const nextSnapshot = { conversationId, run: next.run }
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      if (
        next.run && isActive &&
        next.run.metrics?.browserDisconnectedAt !== undefined &&
        (next.run.metrics.browserReconnectedAt ?? 0) < next.run.metrics.browserDisconnectedAt &&
        !reconnectedRunIdsRef.current.has(next.run.id)
      ) {
        reconnectedRunIdsRef.current.add(next.run.id)
        void overlayAppClient.conversations.recordRunMetricEvent({
          conversationId,
          agentRunId: next.run.id,
          event: 'browser_reconnected',
        }, { credentials: 'same-origin', keepalive: true }).catch(() => undefined)
      }
      return next.run
    } catch {
      return null
    }
  }, [conversationId, enabled])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  const active = Boolean(run && ACTIVE_STATUSES.has(run.status))
  useEffect(() => {
    activeRunRef.current = active ? run : null
  }, [active, run])
  useEffect(() => {
    const recordDisconnect = () => {
      const activeRun = activeRunRef.current
      if (!activeRun) return
      void overlayAppClient.conversations.recordRunMetricEvent({
        conversationId: activeRun.conversationId,
        agentRunId: activeRun.id,
        event: 'browser_disconnected',
      }, { credentials: 'same-origin', keepalive: true }).catch(() => undefined)
    }
    window.addEventListener('pagehide', recordDisconnect)
    return () => window.removeEventListener('pagehide', recordDisconnect)
  }, [])
  useEffect(() => {
    if (!enabled || !conversationId || (!localStreamActive && !active)) return
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [active, conversationId, enabled, localStreamActive, refresh])

  useEffect(() => {
    if (terminalSyncUntil <= Date.now()) return
    const timeout = window.setTimeout(() => setTerminalSyncUntil(0), terminalSyncUntil - Date.now())
    return () => window.clearTimeout(timeout)
  }, [terminalSyncUntil])

  return useMemo(() => ({
    active,
    run,
    refresh,
    shouldSyncMessages: active || (
      terminalSyncConversationId === conversationId && terminalSyncUntil > 0
    ),
  }), [active, conversationId, refresh, run, terminalSyncConversationId, terminalSyncUntil])
}
