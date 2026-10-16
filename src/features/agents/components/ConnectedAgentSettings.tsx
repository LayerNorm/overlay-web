'use client'

import { useCallback, useState } from 'react'
import type { WorkspaceAgentUpdateInput } from '@overlay/workspace-contracts'
import { ListboxSelect, SegmentedControl } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { agentOffersModelChoice, byoModelId, parseByoModelId } from '@/shared/agents/agent-model'
import { AgentModelField } from './AgentModelField'
import { environmentAgentOptions } from '@/shared/agents/agent-options'
import { useAgentOptions } from './use-agent-options'
import { FieldLabel } from './InfoTip'

const MODE_LABELS: Record<string, string> = { default: 'Manual', acceptEdits: 'Edits', plan: 'Plan', auto: 'Auto', bypassPermissions: 'Bypass' }

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
  const [confirmBypass, setConfirmBypass] = useState(false)
  const { environment, error: optionsError } = useAgentOptions(activeWorkspaceId, agentId)
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
      setConfirmBypass(false)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not change the model.')
    } finally {
      setBusy(false)
    }
  }, [activeWorkspaceId, agentId, busy, current])

  if (!current || (!options && !agentOffersModelChoice(current.adapterId))) {
    return error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null
  }
  return (
    <div className="space-y-4">
      <AgentModelField adapterId={current.adapterId} model={current.model} options={options}
        onChange={(model) => void choose({ modelId: byoModelId(current.adapterId, model) })} disabled={busy || !environment} />
      {options?.mode ? <div>
        <FieldLabel info="The permission modes offered by this agent. Requests that still require a decision appear in the conversation.">Permissions</FieldLabel>
        <SegmentedControl ariaLabel="Permissions" layout="stretch" disabled={busy}
          value={mode ?? (environment?.kind === 'overlay_cloud' && options.mode.values.some(value => value.id === 'auto') ? 'auto'
            : options.mode.values.some(value => value.id === 'acceptEdits') ? 'acceptEdits' : options.mode.currentValue ?? '')}
          options={options.mode.values.map(value => ({ value: value.id, label: MODE_LABELS[value.id] ?? value.label, description: value.description }))}
          onChange={permissionMode => {
            if (permissionMode === 'bypassPermissions' && environment?.kind !== 'overlay_cloud') setConfirmBypass(true)
            else void choose({ permissionMode })
          }} />
        <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">Applies to commands and file changes on the agent&apos;s machine.</p>
      </div> : null}
      {options?.effort ? <div>
        <FieldLabel info="The reasoning levels offered by this agent. Higher levels may take longer and use more of your subscription.">Effort</FieldLabel>
        <ListboxSelect aria-label="Effort" value={reasoning ?? options.effort.currentValue ?? options.effort.values[0]!.id}
          disabled={busy} options={options.effort.values.map(value => ({ value: value.id, label: value.label }))}
          onChange={effort => void choose({ effort })} portal />
      </div> : null}
      <p className="-mt-2 text-[11px] leading-4 text-(--muted)">Applies from the agent&apos;s next message.</p>
      {optionsError ? <p role="status" className="text-xs text-(--muted)">{optionsError}</p> : null}
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      <ConfirmDialog isOpen={confirmBypass} title="Bypass permissions on your machine?"
        description="This agent can run commands and change or delete files within its granted access without asking. Only enable this on a machine and folder you trust it to control."
        confirmLabel="Enable bypass" busy={busy} busyLabel="Saving…" onCancel={() => setConfirmBypass(false)}
        onConfirm={() => void choose({ permissionMode: 'bypassPermissions' })} />
    </div>
  )
}
