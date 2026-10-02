'use client'

import { useCallback, useEffect, useState } from 'react'
import { SegmentedControl } from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  MCP_ACCESS_DESCRIPTION,
  MCP_ACCESS_LABEL,
  MCP_ACCESS_LEVELS,
  mcpAccessForGrant,
  mcpToolGrantFor,
  type McpAccessLevel,
} from '@/shared/mcp/access'
import { FieldLabel } from './InfoTip'

type Choice = McpAccessLevel | 'none'

const OPTIONS = [
  { value: 'none', label: 'None' },
  ...MCP_ACCESS_LEVELS.map((level) => ({ value: level, label: MCP_ACCESS_LABEL[level] })),
] as const

const NONE_DESCRIPTION = 'The agent can only use what is on its own machine.'

/**
 * What the agent can do in Overlay (notes, files, memory, knowledge…), given to it through Overlay's MCP
 * server. Without this an agent on its own machine cannot see any of the person's Overlay data.
 */
export function CloudAgentAccess({ agentId }: { agentId: string }) {
  const { activeWorkspaceId } = useWorkspace()
  const [grant, setGrant] = useState<readonly string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agents.get(activeWorkspaceId, agentId).then(
      (result) => { if (!cancelled) setGrant(result.agent.allowedToolIds) },
      () => { if (!cancelled) setError('Could not load the agent.') },
    )
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId])

  const choose = useCallback(async (choice: Choice) => {
    if (!activeWorkspaceId || busy) return
    const next = choice === 'none' ? [] : mcpToolGrantFor(choice)
    setBusy(true)
    setError(null)
    try {
      const result = await overlayAppClient.agents.update(activeWorkspaceId, agentId, { allowedToolIds: next })
      setGrant(result.agent.allowedToolIds)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not change access.')
    } finally {
      setBusy(false)
    }
  }, [activeWorkspaceId, agentId, busy])

  if (grant === null) return error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null
  const current = mcpAccessForGrant(grant)
  return (
    <div>
      <FieldLabel info="What this agent can do with your Overlay notes, files, memory, and knowledge. It acts as whoever messages it, and never gets more than that person has.">
        Overlay access
      </FieldLabel>
      <SegmentedControl
        ariaLabel="Overlay access"
        layout="stretch"
        value={current === 'custom' ? ('none' as Choice) : current}
        options={[...OPTIONS]}
        onChange={(value) => void choose(value)}
      />
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
        {current === 'custom' ? 'A custom set of tools. Choose a level to replace it.' : current === 'none' ? NONE_DESCRIPTION : MCP_ACCESS_DESCRIPTION[current]}
      </p>
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
