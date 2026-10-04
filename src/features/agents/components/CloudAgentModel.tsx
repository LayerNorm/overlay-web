'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { agentOffersModelChoice, byoModelId, parseByoModelId } from '@/shared/agents/agent-model'
import { AgentModelField } from './AgentModelField'

/** The model a Claude Code or Codex agent uses; saved as soon as it is chosen, like Overlay access. */
export function CloudAgentModel({ agentId }: { agentId: string }) {
  const { activeWorkspaceId } = useWorkspace()
  const [current, setCurrent] = useState<{ adapterId: string; model: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agents.get(activeWorkspaceId, agentId).then(
      (result) => {
        const parsed = parseByoModelId(result.agent.modelId)
        if (!cancelled && parsed) setCurrent({ adapterId: parsed.adapterId, model: parsed.model ?? '' })
      },
      () => { if (!cancelled) setError('Could not load the agent.') },
    )
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId])

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
