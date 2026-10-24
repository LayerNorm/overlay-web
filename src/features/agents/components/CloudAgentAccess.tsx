'use client'

import { useCallback, useState } from 'react'
import { SegmentedControl, toast } from '@overlay/ui/primitives'
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
export function CloudAgentAccess({ agentId, allowedToolIds }: { agentId: string; allowedToolIds: readonly string[] }) {
  const { activeWorkspaceId } = useWorkspace()
  // The agent was already loaded by the page, so this starts with its grant rather than fetching it again.
  const [grant, setGrant] = useState<readonly string[] | null>(allowedToolIds)
  const [busy, setBusy] = useState(false)

  const choose = useCallback(async (choice: Choice) => {
    if (!activeWorkspaceId || busy) return
    const next = choice === 'none' ? [] : mcpToolGrantFor(choice)
    setBusy(true)
    try {
      const result = await overlayAppClient.agents.update(activeWorkspaceId, agentId, { allowedToolIds: next })
      setGrant(result.agent.allowedToolIds)
      toast.success('Overlay access updated.')
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Could not change access.')
    } finally {
      setBusy(false)
    }
  }, [activeWorkspaceId, agentId, busy])

  if (grant === null) return null
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
      <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">
        {current === 'custom' ? 'A custom set of tools. Choose a level to replace it.' : current === 'none' ? NONE_DESCRIPTION : MCP_ACCESS_DESCRIPTION[current]}
      </p>
    </div>
  )
}
