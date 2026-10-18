'use client'

import { useEffect, useState } from 'react'
import type { RemoteRunLiveness as Liveness } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { remoteRunLivenessLabel } from '@/shared/agents/remote-run-liveness'

/** Heartbeat reads never rewrite transcript rows or borrow another agent's status in a channel. */
export function RemoteRunLiveness({ conversationId, runId, workspaceId }: {
  conversationId: string
  runId: string
  workspaceId?: string
}) {
  const [liveness, setLiveness] = useState<Liveness>()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!workspaceId) return
    const controller = new AbortController()
    let stopped = false
    let reading = false
    const read = async () => {
      if (reading || stopped) return
      reading = true
      try {
        const result = await overlayAppClient.conversations.currentRemoteRun({ conversationId, runId },
          { signal: controller.signal, headers: { 'x-overlay-workspace-id': workspaceId } })
        if (!stopped) setLiveness(result.run?.liveness)
      } catch { /* A transient read failure keeps the last confirmed heartbeat. */ }
      finally { reading = false }
    }
    void read()
    const timer = setInterval(() => { void read() }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { stopped = true; controller.abort(); clearInterval(timer); clearInterval(clock) }
  }, [conversationId, runId, workspaceId])
  if (!liveness) return null
  return <span className="ml-1 text-xs text-(--muted)" role="status" aria-live="off">{remoteRunLivenessLabel(liveness, now)}</span>
}
