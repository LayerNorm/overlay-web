import { agentHeartbeatPayloadSchema } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'

import type { RemoteRunLiveness } from '@overlay/workspace-contracts'
export type { RemoteRunLiveness } from '@overlay/workspace-contracts'

/** Liveness is separate from transcript text. A quiet but healthy tool is still running. */
export function recordRemoteRunLiveness(previous: RemoteRunLiveness | undefined, events: AgentRemoteEvent[], now: number, terminal = false): RemoteRunLiveness | undefined {
  let result = previous
  for (const event of events) {
    if (event.type === 'heartbeat') {
      const { openTools, quietMs, stalled } = agentHeartbeatPayloadSchema.parse(event.payload)
      result = { lastActivityAt: now - quietMs, lastHeartbeatAt: now, quietMs, openTools, stalled: stalled === true }
    } else if (event.type !== 'process_observation') {
      const elapsed = Math.max(0, now - (result?.lastHeartbeatAt ?? now))
      let openTools = (result?.openTools ?? []).map(tool => ({ ...tool, runningMs: tool.runningMs + elapsed }))
      if (event.type === 'action' && typeof event.payload.actionId === 'string') {
        const actionId = event.payload.actionId
        if (event.payload.status === 'completed' || event.payload.status === 'failed') openTools = openTools.filter(tool => tool.actionId !== actionId)
        else if (typeof event.payload.title === 'string') {
          const existing = openTools.find(tool => tool.actionId === actionId)
          if (existing) existing.title = event.payload.title
          else openTools.push({ actionId, title: event.payload.title, runningMs: 0 })
        }
      }
      // Output and tool events prove the connection too, including on checkpoint-only hosts.
      result = { lastActivityAt: now, lastHeartbeatAt: now, quietMs: 0,
        openTools: ['completed', 'cancelled', 'failed'].includes(event.type) ? [] : openTools.slice(-20), stalled: false }
    }
  }
  // Lifecycle v2 can confirm Stop through a process observation rather than a cancelled event.
  return terminal && result ? { ...result, openTools: [], quietMs: 0, stalled: false } : result
}

export function remoteRunLivenessLabel(liveness: RemoteRunLiveness, now: number): string {
  const elapsed = Math.max(0, now - Math.max(liveness.lastHeartbeatAt, liveness.lastActivityAt))
  if (elapsed > 30_000) return `Waiting for agent connection · last update ${Math.floor(elapsed / 1000)}s ago`
  const tool = liveness.openTools[0]
  const seconds = Math.floor(Math.max(0, tool ? tool.runningMs + now - liveness.lastHeartbeatAt : now - liveness.lastActivityAt) / 1000)
  if (tool) return `${liveness.stalled ? 'Waiting on' : 'Running'} ${tool.title} · ${seconds}s`
  return `Working · last update ${seconds}s ago`
}
