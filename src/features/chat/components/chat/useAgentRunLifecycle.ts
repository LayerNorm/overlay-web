'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunResource } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { trackAgentRunRecovery } from '@/shared/observability/client-metrics'
import { useQuery } from '@/components/providers/convex-hooks'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'waiting_for_approval'])
const TERMINAL_SYNC_GRACE_MS = 10_000

// Adaptive polling fallback intervals (only used when Convex subscription is unavailable).
const RECOVERY_POLL_SHORT_MS = 2_000
const RECOVERY_POLL_MEDIUM_MS = 5_000
const RECOVERY_POLL_LONG_MS = 15_000
const RECOVERY_ESCALATION_SHORT_TICKS = 5 // 5 ticks at 2s = 10s
const RECOVERY_ESCALATION_MEDIUM_TICKS = 12 // 12 ticks at 5s = 60s

type ConvexAgentRunDoc = {
  _id: string
  _creationTime: number
  conversationId: string
  status: string
  updatedAt: number
  createdAt: number
  metrics?: {
    browserDisconnectedAt?: number
    browserReconnectedAt?: number
  }
} | null

// The Convex doc has fewer fields than AgentRunResource.  We only use
// id, conversationId, status, and metrics in this hook, so we cast.
function toAgentRunResource(doc: ConvexAgentRunDoc): AgentRunResource | null {
  if (!doc) return null
  return {
    id: doc._id,
    conversationId: doc.conversationId,
    status: doc.status as AgentRunResource['status'],
    metrics: doc.metrics as AgentRunResource['metrics'],
  } as unknown as AgentRunResource
}

export function useAgentRunLifecycle({
  conversationId,
  enabled,
  localStreamActive,
  convexAccessToken,
  enableConvexLiveSync,
  userId,
}: {
  conversationId: string | null
  enabled: boolean
  localStreamActive: boolean
  convexAccessToken?: string | null
  enableConvexLiveSync?: boolean
  userId?: string | null
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

  // --- Convex subscription path ---
  const useConvexSubscription = Boolean(enabled && conversationId && enableConvexLiveSync && convexAccessToken && userId)
  const convexQueryArgs = useConvexSubscription && conversationId && userId && convexAccessToken
    ? {
        conversationId: conversationId as Id<'conversations'>,
        userId,
        accessToken: convexAccessToken,
      }
    : 'skip'

  const convexRunDoc = useQuery(
    api.chat.conversations.watchAgentRun,
    convexQueryArgs === 'skip' ? 'skip' : convexQueryArgs,
  ) as ConvexAgentRunDoc | undefined

  // When the Convex subscription delivers a run, update the snapshot.
  // The setState calls here are intentional — we're syncing external
  // subscription state (Convex realtime) into React state.
  useEffect(() => {
    if (!enabled || !conversationId || !enableConvexLiveSync) return
    if (convexRunDoc === undefined) return // still loading
    const nextRun = toAgentRunResource(convexRunDoc)
    const current = snapshotRef.current
    const currentRun = current.conversationId === conversationId ? current.run : null
    const wasActive = Boolean(currentRun && ACTIVE_STATUSES.has(currentRun.status))
    const isActive = Boolean(nextRun && ACTIVE_STATUSES.has(nextRun.status))
    if (wasActive && !isActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTerminalSyncUntil(Date.now() + TERMINAL_SYNC_GRACE_MS)
      setTerminalSyncConversationId(conversationId)
      const prevRun = currentRun
      if (prevRun) {
        const disconnected = prevRun.metrics?.browserDisconnectedAt !== undefined
        const reconnectedAt = prevRun.metrics?.browserReconnectedAt
        const disconnectDuration = disconnected && reconnectedAt && reconnectedAt >= (prevRun.metrics?.browserDisconnectedAt ?? 0)
          ? reconnectedAt - (prevRun.metrics?.browserDisconnectedAt ?? 0)
          : undefined
        trackAgentRunRecovery({
          runId: prevRun.id,
          disconnected,
          disconnectDurationMs: disconnectDuration,
          completedAfterReconnect: disconnected && (nextRun?.status === 'completed'),
        })
      }
    }
    const nextSnapshot = { conversationId, run: nextRun }
    snapshotRef.current = nextSnapshot
    setSnapshot(nextSnapshot)
    if (
      nextRun && isActive &&
      nextRun.metrics?.browserDisconnectedAt !== undefined &&
      (nextRun.metrics.browserReconnectedAt ?? 0) < nextRun.metrics.browserDisconnectedAt &&
      !reconnectedRunIdsRef.current.has(nextRun.id)
    ) {
      reconnectedRunIdsRef.current.add(nextRun.id)
      void overlayAppClient.conversations.recordRunMetricEvent({
        conversationId,
        agentRunId: nextRun.id,
        event: 'browser_reconnected',
      }, { credentials: 'same-origin', keepalive: true }).catch(() => undefined)
    }
  }, [convexRunDoc, conversationId, enabled, enableConvexLiveSync])

  // --- HTTP polling fallback (adaptive, only when Convex is unavailable) ---
  const usePolling = !enableConvexLiveSync || !convexAccessToken
  const pollTickRef = useRef(0)

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
        const prevRun = currentRun
        if (prevRun) {
          const disconnected = prevRun.metrics?.browserDisconnectedAt !== undefined
          const reconnectedAt = prevRun.metrics?.browserReconnectedAt
          const disconnectDuration = disconnected && reconnectedAt && reconnectedAt >= (prevRun.metrics?.browserDisconnectedAt ?? 0)
            ? reconnectedAt - (prevRun.metrics?.browserDisconnectedAt ?? 0)
            : undefined
          trackAgentRunRecovery({
            runId: prevRun.id,
            disconnected,
            disconnectDurationMs: disconnectDuration,
            completedAfterReconnect: disconnected && (next.run?.status === 'completed'),
          })
        }
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

  // Initial fetch on mount (for both Convex and polling paths).
  useEffect(() => {
    if (usePolling) {
      const timeout = window.setTimeout(() => void refresh(), 0)
      return () => window.clearTimeout(timeout)
    }
  }, [refresh, usePolling])

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

  // Adaptive polling fallback: 2s → 5s → 15s, only when Convex is unavailable.
  useEffect(() => {
    if (!usePolling || !enabled || !conversationId || (!localStreamActive && !active)) return
    pollTickRef.current = 0
    const getInterval = () => {
      const tick = pollTickRef.current
      if (tick < RECOVERY_ESCALATION_SHORT_TICKS) return RECOVERY_POLL_SHORT_MS
      if (tick < RECOVERY_ESCALATION_MEDIUM_TICKS) return RECOVERY_POLL_MEDIUM_MS
      return RECOVERY_POLL_LONG_MS
    }
    let intervalId: number
    const scheduleNext = () => {
      intervalId = window.setTimeout(async () => {
        pollTickRef.current += 1
        await refresh()
        scheduleNext()
      }, getInterval())
    }
    scheduleNext()
    return () => window.clearTimeout(intervalId)
  }, [active, conversationId, enabled, localStreamActive, refresh, usePolling])

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
