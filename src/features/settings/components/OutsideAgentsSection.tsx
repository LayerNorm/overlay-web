'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Pause, Play, Trash2 } from 'lucide-react'
import type { McpAgentResource } from '@overlay/api-client'
import { Button, toast } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { MCP_AGENT_AVAILABILITY_LABEL } from '@/shared/mcp/agent-network'

const REFRESH_MS = 10_000

type Action = 'approve' | 'decline' | 'pause' | 'resume' | 'remove'

function detail(agent: McpAgentResource): string {
  if (agent.status === 'pending') return agent.ownedByYou ? 'Waiting for a workspace admin to approve' : 'Wants to join this workspace'
  const state = agent.availability ? MCP_AGENT_AVAILABILITY_LABEL[agent.availability] : 'Away'
  return agent.availability === 'away' ? `${state} · sees new messages when it next connects` : state
}

/**
 * Outside agents (ChatGPT, Claude Code, Codex…) that joined this workspace over MCP, and the requests waiting for
 * an admin. An agent only becomes a member once someone here approves it.
 */
export function OutsideAgentsSection() {
  const [data, setData] = useState<{ canApprove: boolean; agents: McpAgentResource[] } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<McpAgentResource | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await overlayAppClient.mcpAccess.agents())
    } catch {
      // Keeps what is shown; the next refresh tries again.
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const act = async (agent: McpAgentResource, action: Action) => {
    setBusyId(agent.id)
    try {
      await overlayAppClient.mcpAccess.updateAgent({ id: agent.id, action })
      await load()
      if (action === 'approve') toast.success(`${agent.name} joined the workspace.`)
      if (action === 'remove') toast.success(`${agent.name} was removed.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the agent.')
    } finally {
      setBusyId(null)
      setRemoving(null)
    }
  }

  if (!data || data.agents.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">Agents in this workspace</h3>
      {data.agents.map((agent) => {
        const busy = busyId === agent.id
        const canChange = agent.ownedByYou || data.canApprove
        return (
          <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--surface-subtle) text-(--muted)"><Bot size={16} /></span>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium text-(--foreground)">{agent.name}</h4>
              <p className="mt-0.5 truncate text-xs text-(--muted)">{detail(agent)}{agent.description ? ` · ${agent.description}` : ''}</p>
            </div>
            {agent.status === 'pending' && data.canApprove ? (
              <>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(agent, 'decline')}>Decline</Button>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void act(agent, 'approve')}>Approve</Button>
              </>
            ) : null}
            {agent.status === 'approved' && canChange ? (
              <Button variant="ghost" size="sm" disabled={busy} aria-label={agent.paused ? `Resume ${agent.name}` : `Pause ${agent.name}`} onClick={() => void act(agent, agent.paused ? 'resume' : 'pause')}>
                {agent.paused ? <Play size={14} /> : <Pause size={14} />}
              </Button>
            ) : null}
            {canChange && !(agent.status === 'pending' && data.canApprove) ? (
              <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${agent.name}`} onClick={() => setRemoving(agent)}>
                <Trash2 size={14} />
              </Button>
            ) : null}
          </div>
        )
      })}
      <ConfirmDialog
        isOpen={removing !== null}
        title="Remove this agent?"
        description={removing ? `${removing.name} leaves the workspace and can no longer read or post. Its past messages stay.` : ''}
        confirmLabel="Remove"
        destructive
        busy={busyId !== null}
        onConfirm={() => { if (removing) void act(removing, 'remove') }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
