'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgentBinding, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { ApiRequestError, type AgentEnvironmentResource, type ManagedHarnessPicker } from '@overlay/api-client'
import { useByokModels } from '@/components/providers/useByokModels'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { workspaceAgentUsesByo, workspaceAgentUsesManagedHarness } from '../lib/byo-agent-setup'
import { isManagedHarnessRuntime } from '../lib/agent-editor-input'
import type { AgentType } from './AgentEditorForm'

export function useAgentRuntime({
  showcase,
  activeWorkspaceId,
  managedHarnessAgentsEnabled,
  showcaseAgent,
  agent,
  setError,
}: {
  showcase: boolean
  activeWorkspaceId: string | null
  managedHarnessAgentsEnabled: boolean
  showcaseAgent: WorkspaceAgentDirectoryItem | null
  agent: WorkspaceAgentDirectoryItem | null
  setError: Dispatch<SetStateAction<string | null>>
}) {
  const [agentType, setAgentType] = useState<AgentType>(() => (
    workspaceAgentUsesByo(showcaseAgent) ? 'byo' : 'overlay'
  ))
  // Hosted-branch runtime: 'overlay' is the native agent; a managed harness id
  // selects a HarnessAgent running in an Overlay Cloud sandbox.
  const [hostedRuntime, setHostedRuntime] = useState<string>(() => (
    showcaseAgent && workspaceAgentUsesManagedHarness(showcaseAgent) ? showcaseAgent.harness : 'overlay'
  ))
  const [harnessModel, setHarnessModel] = useState('')
  const [managedPicker, setManagedPicker] = useState<ManagedHarnessPicker | null>(null)
  const [managedEnvironment, setManagedEnvironment] = useState<AgentEnvironmentResource | null>(null)
  // The binding as loaded — the baseline a save compares against to detect a
  // runtime switch and to restore on cancel.
  const [boundHarnessId, setBoundHarnessId] = useState<string | null>(null)
  const [boundHarnessModel, setBoundHarnessModel] = useState('')
  /** `'overlay'` or a provider-connection id — who funds the harness's model usage. */
  const [modelAccess, setModelAccess] = useState('overlay')
  const [boundModelAccess, setBoundModelAccess] = useState('overlay')
  const [managedResetBusy, setManagedResetBusy] = useState(false)
  const [managedPickerFailed, setManagedPickerFailed] = useState(false)
  const [managedPickerRetry, setManagedPickerRetry] = useState(0)

  const onManagedBinding = useCallback((binding: AgentBinding, environment?: AgentEnvironmentResource) => {
    setAgentType('overlay')
    const harnessId = typeof binding.adapterConfig.harnessId === 'string' ? binding.adapterConfig.harnessId : ''
    if (harnessId) {
      setHostedRuntime(harnessId)
      setBoundHarnessId(harnessId)
    }
    const model = typeof binding.adapterConfig.model === 'string' ? binding.adapterConfig.model : ''
    setHarnessModel(model)
    setBoundHarnessModel(model)
    const boundConnection = typeof binding.adapterConfig.byokConnectionId === 'string'
      ? binding.adapterConfig.byokConnectionId : ''
    const access = binding.adapterConfig.modelBilling === 'byok' && boundConnection ? boundConnection : 'overlay'
    setModelAccess(access)
    setBoundModelAccess(access)
    setManagedEnvironment(environment ?? null)
  }, [])

  // Managed-harness picker: the server applies every gate (feature, rollout,
  // workspace policy, provider credentials). A 404 means the hosted branch
  // offers only the native Overlay runtime — silent, correct. Any other
  // failure (expired session, 5xx, network) must be visible: silently
  // degrading to Overlay-only is how an agent gets created on the wrong
  // runtime.
  useEffect(() => {
    if (showcase || !activeWorkspaceId || !managedHarnessAgentsEnabled) return
    let cancelled = false
    void overlayAppClient.agentEnvironments.managedHarnesses(activeWorkspaceId).then(
      (picker) => { if (!cancelled) { setManagedPicker(picker); setManagedPickerFailed(false) } },
      (error) => {
        if (cancelled) return
        setManagedPicker(null)
        // 404 = gated off for this workspace — not a failure worth surfacing.
        setManagedPickerFailed(!(error instanceof ApiRequestError && error.status === 404))
      },
    )
    return () => { cancelled = true }
  }, [activeWorkspaceId, managedHarnessAgentsEnabled, managedPickerRetry, showcase])

  const managedHarnessEntry = useMemo(
    () => managedPicker?.harnesses.find((entry) => entry.id === hostedRuntime),
    [managedPicker, hostedRuntime],
  )
  // The picker's catalog value; absent a selection the entry's default applies.
  const harnessModelOption = managedHarnessEntry?.models.find((model) => model.value === harnessModel)
    ?? managedHarnessEntry?.models[0]
  const harnessBillingModelId = harnessModelOption?.billingModelId ?? ''
  const managedProviderId = managedPicker?.providers[0] ?? 'vercel'
  const managedProvider = managedProviderId === 'vercel' ? 'Vercel Sandbox'
    : managedProviderId === 'daytona' ? 'Daytona'
    : managedProviderId
  const managedWorkingDirectory = managedPicker?.workingDirectory ?? '/workspace'
  const managedRuntimeSelected = agentType === 'overlay' && isManagedHarnessRuntime(hostedRuntime)

  // BYOK "Model access" options: the actor's active provider connections whose
  // provider the selected harness can authenticate (`byokProviders`).
  const { connections: byokConnections } = useByokModels({ enabled: managedRuntimeSelected })
  const managedByokConnections = useMemo(() => (
    !managedHarnessEntry || managedHarnessEntry.byokProviders.length === 0 ? [] :
      byokConnections
        .filter((connection) => connection.status === 'active'
          && managedHarnessEntry.byokProviders.includes(connection.providerId))
        .map((connection) => ({ id: connection._id, label: connection.displayName }))
  ), [byokConnections, managedHarnessEntry])

  const resetManagedHarness = async () => {
    if (!activeWorkspaceId || !managedEnvironment || managedResetBusy) return
    if (!window.confirm(`Reset ${agent?.name ?? 'this agent'}'s session? Its sandbox is destroyed and rebuilt fresh on the next message.`)) return
    setManagedResetBusy(true)
    setError(null)
    try {
      await overlayAppClient.agentEnvironments.resetHarness(activeWorkspaceId, managedEnvironment.id)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the agent session.')
    } finally {
      setManagedResetBusy(false)
    }
  }

  return {
    agentType,
    setAgentType,
    hostedRuntime,
    setHostedRuntime,
    harnessModel,
    setHarnessModel,
    managedPicker,
    managedPickerFailed,
    managedPickerRetry,
    setManagedPickerRetry,
    managedEnvironment,
    setManagedEnvironment,
    boundHarnessId,
    setBoundHarnessId,
    boundHarnessModel,
    setBoundHarnessModel,
    modelAccess,
    setModelAccess,
    boundModelAccess,
    setBoundModelAccess,
    managedResetBusy,
    resetManagedHarness,
    onManagedBinding,
    managedHarnessEntry,
    harnessModelOption,
    harnessBillingModelId,
    managedProvider,
    managedWorkingDirectory,
    managedRuntimeSelected,
    managedByokConnections,
  }
}
