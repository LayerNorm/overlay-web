'use client'

import { useCallback, useState } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { agentOffersModelChoice, byoModelId, parseByoModelId } from '@/shared/agents/agent-model'
import { AgentModelField } from './AgentModelField'

/** The model a Claude Code or Codex agent uses; saved as soon as it is chosen, like Overlay access. */
export function CloudAgentModel({ agentId, modelId }: { agentId: string; modelId: string }) {
  const { activeWorkspaceId } = useWorkspace()
  // The agent was already loaded by the page, so this starts with its model rather than fetching it again.
  const [current, setCurrent] = useState<{ adapterId: string; model: string } | null>(() => {
    const parsed = parseByoModelId(modelId)
    return parsed ? { adapterId: parsed.adapterId, model: parsed.model ?? '' } : null
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = useCallback(async (model: string) => {
    if (!activeWorkspaceId || !current || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await overlayAppClient.agents.update(activeWorkspaceId, agentId, { modelId: byoModelId(current.adapterId, model) })
      const parsed = parseByoModelId(result.agent.modelId)
      setCurrent({ adapterId: current.adapterId, model: parsed?.model ?? '' })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not change the model.')
    } finally {
      setBusy(false)
    }
  }, [activeWorkspaceId, agentId, busy, current])

  if (!current || !agentOffersModelChoice(current.adapterId)) {
    return error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null
  }
  return (
    <div className="space-y-4">
      <AgentModelField adapterId={current.adapterId} model={current.model} onChange={(model) => void choose(model)} disabled={busy} />
      <p className="-mt-2 text-[11px] leading-4 text-[var(--muted)]">Applies from the agent&apos;s next message.</p>
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
