'use client'

import { useEffect, useState } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { RemoteRunLiveness as Liveness } from '@overlay/workspace-contracts'
import { remoteRunLivenessLabel } from '@/shared/agents/remote-run-liveness'
import { api } from '../../../../../convex/_generated/api'

/**
 * A remote agent's heartbeat in a room, live from the run record (no polling). The one-second clock only advances
 * the "last update" label locally. Heartbeat reads never rewrite transcript rows or borrow another agent's status.
 */
export function RemoteRunLiveness({ conversationId, runId, workspaceId }: {
  conversationId: string
  runId: string
  workspaceId?: string
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const liveness = useQuery(
    api.collaboration.rooms.runLiveness,
    workspaceId && isAuthenticated && !isLoading
      ? { workspaceId, conversationId: conversationId as Id<'conversations'>, runId }
      : 'skip',
  ) as Liveness | null | undefined
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [])
  if (!liveness) return null
  return <span className="ml-1 text-xs text-(--muted)" role="status" aria-live="off">{remoteRunLivenessLabel(liveness, now)}</span>
}
