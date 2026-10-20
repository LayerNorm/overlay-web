'use client'

import { useCallback, useState } from 'react'
import type { WorkspaceAgentUpdateInput } from '@overlay/workspace-contracts'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { agentOffersModelChoice, byoModelId, parseByoModelId } from '@/shared/agents/agent-model'
import { AgentRuntimeSettingsFields } from './AgentRuntimeSettingsFields'
import { agentModeNeedsConfirmation, defaultAgentPermissionMode, environmentAgentOptions, resolvedAgentModelChoice } from '@/shared/agents/agent-options'
import { useAgentOptions } from './use-agent-options'

/** Choices advertised by the bound agent, saved for its next turn. */
export function ConnectedAgentSettings({ agentId, modelId, permissionMode, effort }: {
  agentId: string; modelId: string; permissionMode?: string; effort?: string
}) {
  const { activeWorkspaceId } = useWorkspace()
  // The agent was already loaded by the page, so this starts with its model rather than fetching it again.
  const [current, setCurrent] = useState<{ adapterId: string; model: string } | null>(() => {
    const parsed = parseByoModelId(modelId)
    return parsed ? { adapterId: parsed.adapterId, model: parsed.model ?? '' } : null
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(permissionMode)
  const [reasoning, setReasoning] = useState(effort)
  const [pendingMode, setPendingMode] = useState<string | null>(null)
  const { environment, error: optionsError, loading } = useAgentOptions(activeWorkspaceId, agentId)
  const options = environment && current ? environmentAgentOptions(environment.capabilities, current.adapterId) : undefined

  const choose = useCallback(async (patch: WorkspaceAgentUpdateInput) => {
    if (!activeWorkspaceId || !current || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await overlayAppClient.agents.update(activeWorkspaceId, agentId, patch)
      const parsed = parseByoModelId(result.agent.modelId)
      setCurrent({ adapterId: current.adapterId, model: parsed?.model ?? '' })
      setMode(result.agent.permissionMode)
      setReasoning(result.agent.effort)
      setPendingMode(null)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not save agent settings.')
    } finally {
      setBusy(false)
    }
  }, [activeWorkspaceId, agentId, busy, current])

  if (!current || (!options && !agentOffersModelChoice(current.adapterId))) {
    return error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null
  }
  const selected = resolvedAgentModelChoice(options, current.model, reasoning)
  return (
    <div className="space-y-4">
      <AgentRuntimeSettingsFields adapterId={current.adapterId} model={selected.model} options={options}
        effort={selected.effort ?? ''} mode={mode ?? defaultAgentPermissionMode(options, environment?.kind === 'overlay_cloud')}
        disabled={busy || loading || !environment || Boolean(optionsError)}
        onModel={model => void choose({ modelId: byoModelId(current.adapterId, model),
          ...(selected.effort ? { effort: selected.effort } : {}) })}
        onEffort={effort => void choose({ effort })}
        onMode={permissionMode => {
          if (agentModeNeedsConfirmation(permissionMode)) setPendingMode(permissionMode)
          else void choose({ permissionMode })
        }} />
      <p role="status" className="text-xs text-(--muted)">{optionsError ?? (loading ? 'Loading agent settings…'
        : !environment ? 'Connect this agent to a machine to load its settings.'
        : !options ? 'This host has not reported settings. Update or reconnect the host to discover available choices.'
        : !options.model || !options.mode || !options.effort ? 'Some settings are not reported by this agent. Available changes apply to its next message.'
        : 'Applies to the next message.')}</p>
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      <ConfirmDialog isOpen={pendingMode !== null} title="Allow full access?"
        description="This agent can run commands and change or delete files within its granted access without asking. Only enable this on a machine and folder you trust it to control."
        confirmLabel="Allow full access" busy={busy} busyLabel="Saving…" onCancel={() => setPendingMode(null)}
        onConfirm={() => { if (pendingMode) void choose({ permissionMode: pendingMode }) }} />
    </div>
  )
}
