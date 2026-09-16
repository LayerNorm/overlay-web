'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type {
  AgentBinding,
  Computer,
  ComputerSize,
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { ApiRequestError, type AgentEnvironmentResource, type ManagedHarnessPicker } from '@overlay/api-client'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
} from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useByokModels } from '@/components/providers/useByokModels'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  COMPUTER_TOOL_IDS,
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '@/shared/agents/tool-groups'
import { workspaceAgentUsesByo, workspaceAgentUsesManagedHarness } from '../lib/byo-agent-setup'
import { buildWorkspaceAgentInput, isAgentEditorValid, isDefaultMasterAgent, isManagedHarnessRuntime } from '../lib/agent-editor-input'
import { buildAgentEditorHref, buildAgentsDirectoryHref, startAgentChat } from '../lib/agent-chat'
import { getInitialEditorState, getShowcaseAgent } from '../lib/agent-editor-state'
import { dispatchAgentDirectoryChanged, dispatchAgentDraftPreview } from '@/shared/workspace/sidebar-events'
import {
  AccessSelector,
  AgentAvatar,
  AgentBehaviorFields,
  AgentTypeSelector,
  AVATAR_COLORS,
  DangerZone,
  MasterAgentNotice,
  type AgentType,
} from './AgentEditorForm'
import {
  AgentEditorDialog,
  AgentEditorSidePanel,
  SayHelloButton,
} from './AgentEditorPresentation'
import { useByoConnection } from './use-byo-connection'

export function AgentEditorPage({
  mode,
  agentId,
  freshDraft = false,
  showcase = false,
  presentation = 'page',
  panelMode,
  onTogglePanelMode,
  onClose,
  onCreated,
  onArchived,
  onSaved,
}: {
  mode: 'new' | 'edit'
  agentId?: string
  /** The create flow inserts a draft row then opens edit mode — a fresh draft's runtime is still pickable until first save. */
  freshDraft?: boolean
  showcase?: boolean
  presentation?: 'page' | 'panel'
  panelMode?: 'dialog' | 'side'
  onTogglePanelMode?: () => void
  onClose?: () => void
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
  onSaved?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showHello = searchParams?.get('hello') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const { capabilities } = useOverlayCapabilities()
  const computersAvailable = capabilities.computers === true
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const { settings } = useAppSettings()
  const enabledModelIds = settings.enabledChatModelIds

  const showcaseAgent = getShowcaseAgent(showcase, mode, agentId)
  // One initializer keeps per-field fallbacks out of the component body.
  const [initial] = useState(() => getInitialEditorState({ showcase, mode, agent: showcaseAgent }))
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(initial.agent)
  const [loading, setLoading] = useState(initial.loading)
  const [loadFailed, setLoadFailed] = useState(false)
  const [canCreate, setCanCreate] = useState(initial.canCreate)
  const [connectedAgentsEnabled, setConnectedAgentsEnabled] = useState(false)

  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [modelId, setModelId] = useState<string>(initial.modelId)
  const [avatarColor, setAvatarColor] = useState(initial.avatarColor)
  const [avatarShape, setAvatarShape] = useState<WorkspaceAgentCreatureShape>(initial.avatarShape)
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>(initial.visibility)
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => (showcaseAgent
    ? enabledAgentToolGroupIds(showcaseAgent.allowedToolIds)
    : new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)))
  const [advanced, setAdvanced] = useState(false)
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

  const {
    environmentChoice, setEnvironmentChoice, environmentsLoading, environmentId, adapterId,
    workingDirectory, setWorkingDirectory, harnessOptions, selectedHarness, compatibleEnvironments,
    setupEnvironment, environmentBusy, environmentError, command, copied, setupRoots, setSetupRoots,
    bindingValid, chooseHarness, chooseEnvironment, beginConnection, approveSetupEnvironment, copyCommand,
  } = useByoConnection({
    activeWorkspaceId, showcase, agent, agentType, connectedAgentsEnabled, setAgentType, onManagedBinding,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentComputer, setAgentComputer] = useState<Computer | null>(null)
  const [computerSize, setComputerSize] = useState<ComputerSize>('default')
  const [computerOpenBusy, setComputerOpenBusy] = useState(false)
  const [computerLifecycleBusy, setComputerLifecycleBusy] = useState<'start' | 'stop' | 'delete' | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Explicit save model: every change marks the form dirty; nothing persists
  // until Save. Cancel discards back to the loaded agent and closes.
  const markDirty = useCallback(() => {
    setSavedFlash(false)
    setDirty(true)
  }, [])

  // Load the agent (edit) or the create permission (new).
  useEffect(() => {
    if (showcase) return
    if (!activeWorkspaceId) return
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    if (mode === 'edit' && agentId) {
      void overlayAppClient.agents.get(activeWorkspaceId, agentId).then(
        (result) => { if (!cancelled) { setAgent(result.agent); setLoading(false) } },
        () => { if (!cancelled) { setAgent(null); setLoadFailed(true); setLoading(false) } },
      )
    } else {
      void overlayAppClient.agents.list(activeWorkspaceId).then(
        (result) => { if (!cancelled) { setCanCreate(result.canCreate); setLoading(false) } },
        () => { if (!cancelled) { setLoadFailed(true); setLoading(false) } },
      )
    }
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId, mode, showcase])

  // Connected-agent availability gates the BYO type.
  useEffect(() => {
    if (showcase || !activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId)
      .then(() => { if (!cancelled) setConnectedAgentsEnabled(true) })
      .catch(() => { if (!cancelled) setConnectedAgentsEnabled(false) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, showcase])

  // Managed-harness picker: the server applies every gate (feature, rollout,
  // workspace policy, provider credentials). A 404 means the hosted branch
  // offers only the native Overlay runtime — silent, correct. Any other
  // failure (expired session, 5xx, network) must be visible: silently
  // degrading to Overlay-only is how an agent gets created on the wrong
  // runtime.
  const managedHarnessAgentsEnabled = capabilities.managedHarnessAgents === true
  const [managedPickerFailed, setManagedPickerFailed] = useState(false)
  const [managedPickerRetry, setManagedPickerRetry] = useState(0)
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

  // Load this agent's computer (edit mode, Overlay agents, capability on).
  // A bound machine implies the Computer tool group: force it on so the merged
  // toggle never shows "off" above a live machine.
  useEffect(() => {
    if (showcase || !computersAvailable || !activeWorkspaceId || !agent || agentType !== 'overlay') return
    let cancelled = false
    void overlayAppClient.computers.list(activeWorkspaceId).then(
      (result) => {
        if (cancelled) return
        const existing = result.computers.find(
          (computer) => computer.ownerType === 'agent' && computer.ownerId === agent.id,
        ) ?? null
        setAgentComputer(existing)
        if (existing) {
          setComputerSize(existing.size)
          if (!enabledAgentToolGroupIds(agent.allowedToolIds).has('computer')) {
            setEnabledToolGroups((current) => new Set(current).add('computer'))
            markDirty()
          }
        }
      },
      () => undefined,
    )
    return () => { cancelled = true }
  }, [showcase, computersAvailable, activeWorkspaceId, agent, agentType, markDirty])

  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

  const isDefaultMaster = isDefaultMasterAgent(agent)
  const valid = isAgentEditorValid({
    name, instructions, modelId, agentType, hostedRuntime, harnessBillingModelId,
    managedHarnessEnabled: Boolean(managedPicker), connectedAgentsEnabled, bindingValid,
  })

  const toggleToolGroup = (groupId: string) => {
    markDirty()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const directoryHref = buildAgentsDirectoryHref(activeWorkspaceId, showcase)
  const closeEditor = () => onClose ? onClose() : router.push(directoryHref)

  const buildInput = useCallback((): WorkspaceAgentCreateInput => {
    const harnessLabel = selectedHarness?.label ?? adapterId
    return {
      ...buildWorkspaceAgentInput({
        name, description, instructions, agentType, hostedRuntime, harnessBillingModelId,
        harnessLabel, adapterId, modelId, avatarColor, avatarShape, enabledToolGroups, visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }
  }, [selectedHarness, adapterId, name, description, instructions, agentType, hostedRuntime,
    harnessBillingModelId, modelId, avatarColor, avatarShape, enabledToolGroups, visibility, agent])

  // Reset the form whenever a different agent loads.
  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(agent.modelId)
    setAvatarColor(agent.avatarColor ?? AVATAR_COLORS[0]!)
    setAvatarShape(agent.avatarShape ?? 'circle')
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    // The agent record marks a managed harness via `harness`; the binding load
    // (`onManagedBinding`) fills in the environment and picked model.
    setHostedRuntime(workspaceAgentUsesManagedHarness(agent) ? agent.harness : 'overlay')
    setAgentType(workspaceAgentUsesByo(agent) ? 'byo' : 'overlay')
    // `onManagedBinding` restores the saved access for managed agents.
    setModelAccess('overlay')
    setDirty(false)
    setSavedFlash(false)
  }, [agent])

  // Stream unsaved identity drafts so the sidebar roster and the conversation
  // header update while typing; a clean form or an unmounted editor clears the
  // override.
  useEffect(() => {
    if (showcase || !agent || !activeWorkspaceId) return
    dispatchAgentDraftPreview({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      principalId: agent.principalId,
      patch: dirty
        ? { name: name.trim() || 'Untitled agent', description, avatarColor, avatarShape }
        : null,
    })
  }, [showcase, agent, activeWorkspaceId, dirty, name, description, avatarColor, avatarShape])

  useEffect(() => {
    if (!agent || !activeWorkspaceId) return
    const { id: agentIdForCleanup, principalId } = agent
    const workspaceId = activeWorkspaceId
    return () => {
      dispatchAgentDraftPreview({ workspaceId, agentId: agentIdForCleanup, principalId, patch: null })
    }
  }, [agent, activeWorkspaceId])

  const persistNew = () => {
    if (showcase) {
      router.push(directoryHref)
      return
    }
    if (!activeWorkspaceId || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.create(activeWorkspaceId, buildInput())
        if (managedRuntimeSelected && managedHarnessEntry) {
          // Durable identity first, then the managed sandbox, then the binding —
          // a failure after create lands on the edit page so retry never
          // duplicates the agent.
          await (async () => {
            const provisioned = await overlayAppClient.agentEnvironments.createManaged(activeWorkspaceId, {
              mode: 'harness',
              harnessId: managedHarnessEntry.id,
            })
            await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
              agentId: saved.agent.id,
              environmentId: provisioned.environment.id,
              adapterId: managedHarnessEntry.id,
              workingDirectory: managedWorkingDirectory,
              ...(harnessModelOption?.value ? { model: harnessModelOption.value } : {}),
              ...(modelAccess !== 'overlay'
                ? { modelBilling: 'byok' as const, byokConnectionId: modelAccess }
                : { modelBilling: 'overlay' as const }),
            })
          })().catch(async (bindingError) => {
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw bindingError
          })
        } else if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          }).catch(async (bindingError) => {
            // Agent identity may already be durable even if its remote binding
            // fails. Land on the edit page so a retry never creates a duplicate.
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw bindingError
          })
        }
        if (agentType === 'overlay' && computersAvailable && enabledToolGroups.has('computer')) {
          await overlayAppClient.computers.provision(activeWorkspaceId, {
            ownerType: 'agent',
            ownerId: saved.agent.id,
            size: computerSize,
            name: `${saved.agent.name} computer`,
          }).catch(async (computerError) => {
            // The agent is durable even if its computer fails to provision —
            // land on the edit page so a retry never creates a duplicate agent.
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw computerError
          })
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        if (onCreated) onCreated(saved.agent)
        else router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const saveEdit = () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    if (
      agentType === 'overlay' && agentComputer && !enabledToolGroups.has('computer')
      && !window.confirm(`Delete ${agent.name}'s computer? Its disk state is destroyed permanently.`)
    ) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.update(activeWorkspaceId, agent.id, buildInput())
        // null unless the managed branch rebinds — any other path means the
        // loaded managed environment (if any) is being retired.
        let nextManagedEnvironment: AgentEnvironmentResource | null = null
        if (managedRuntimeSelected && managedHarnessEntry) {
          // Same harness → rebind on the existing environment; a runtime switch
          // needs a fresh sandbox since each environment advertises one harness.
          const reuseEnvironment = managedEnvironment && boundHarnessId === hostedRuntime
          const environment = reuseEnvironment
            ? managedEnvironment
            : (await overlayAppClient.agentEnvironments.createManaged(activeWorkspaceId, {
                mode: 'harness',
                harnessId: managedHarnessEntry.id,
              })).environment
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId: environment.id,
            adapterId: managedHarnessEntry.id,
            workingDirectory: managedWorkingDirectory,
            ...(harnessModelOption?.value ? { model: harnessModelOption.value } : {}),
            ...(modelAccess !== 'overlay'
              ? { modelBilling: 'byok' as const, byokConnectionId: modelAccess }
              : { modelBilling: 'overlay' as const }),
          })
          nextManagedEnvironment = environment
          setManagedEnvironment(environment)
          setBoundHarnessId(managedHarnessEntry.id)
          setBoundHarnessModel(harnessModelOption?.value ?? '')
          setBoundModelAccess(modelAccess)
        } else if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } else if (workspaceAgentUsesByo(agent) || managedEnvironment) {
          // Switched a connected agent back to Overlay: drop its binding once.
          await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
            .catch(() => undefined)
          nextManagedEnvironment = null
          setManagedEnvironment(null)
          setBoundHarnessId(null)
          setBoundHarnessModel('')
          setBoundModelAccess('overlay')
          setModelAccess('overlay')
        }
        // An environment this agent no longer uses keeps no sandbox: clearing
        // sessions + deleting the instance now beats waiting out the idle timeout.
        if (managedEnvironment && managedEnvironment.id !== nextManagedEnvironment?.id) {
          await overlayAppClient.agentEnvironments.resetHarness(activeWorkspaceId, managedEnvironment.id)
            .catch(() => undefined)
        }
        if (agentType === 'overlay' && computersAvailable) {
          // An `error`-status computer is a dead row from a failed provision —
          // saving retries the provision; the service reclaims the dead row.
          if (enabledToolGroups.has('computer') && (!agentComputer || agentComputer.status === 'error')) {
            const provisioned = await overlayAppClient.computers.provision(activeWorkspaceId, {
              ownerType: 'agent',
              ownerId: saved.agent.id,
              size: computerSize,
              name: `${saved.agent.name} computer`,
            })
            setAgentComputer(provisioned.computer)
          } else if (!enabledToolGroups.has('computer') && agentComputer) {
            await overlayAppClient.computers.destroy(activeWorkspaceId, agentComputer.id)
            setAgentComputer(null)
          }
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        setAgent(saved.agent)
        setDirty(false)
        setSavedFlash(true)
        if (onSaved) onSaved()
        // Panel presentations close on save — the saved flash only matters on
        // the standalone editor page. onSaved must run first: it clears the
        // workspace's never-saved marker before closeEditor can act on it.
        if (presentation === 'panel') closeEditor()
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const cancelEdit = () => {
    if (!agent) {
      closeEditor()
      return
    }
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(agent.modelId)
    setAvatarColor(agent.avatarColor ?? AVATAR_COLORS[0]!)
    setAvatarShape(agent.avatarShape ?? 'circle')
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    setHostedRuntime(boundHarnessId ?? 'overlay')
    setHarnessModel(boundHarnessModel)
    setModelAccess(boundModelAccess)
    setDirty(false)
    setError(null)
    closeEditor()
  }

  const archiveAgent = async () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    if (!window.confirm(`Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`)) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      if (onArchived) onArchived()
      else router.push(directoryHref)
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not archive agent.')
    } finally {
      setBusy(false)
    }
  }

  const openAgentComputer = async () => {
    if (!activeWorkspaceId || !agentComputer) return
    setComputerOpenBusy(true)
    setError(null)
    try {
      const ticket = await overlayAppClient.computers.openDesktop(activeWorkspaceId, agentComputer.id)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open the desktop.')
    } finally {
      setComputerOpenBusy(false)
    }
  }

  const toggleAgentComputerPower = async () => {
    if (!activeWorkspaceId || !agentComputer || computerLifecycleBusy) return
    const action = agentComputer.status === 'ready' ? 'stop' : 'start'
    setComputerLifecycleBusy(action)
    setError(null)
    try {
      const result = action === 'stop'
        ? await overlayAppClient.computers.stop(activeWorkspaceId, agentComputer.id)
        : await overlayAppClient.computers.start(activeWorkspaceId, agentComputer.id)
      setAgentComputer(result.computer)
    } catch (powerError) {
      setError(powerError instanceof Error ? powerError.message : `Could not ${action} the computer.`)
    } finally {
      setComputerLifecycleBusy(null)
    }
  }

  const deleteAgentComputer = async () => {
    if (!activeWorkspaceId || !agentComputer || computerLifecycleBusy || !agent) return
    if (!window.confirm(`Delete ${agentComputer.name ?? "this agent's computer"}? Its disk state is destroyed permanently.`)) return
    setComputerLifecycleBusy('delete')
    setError(null)
    try {
      await overlayAppClient.computers.destroy(activeWorkspaceId, agentComputer.id)
      // The machine is already gone, so persist the merged toggle off right
      // away — otherwise the saved grant would keep offering computer tools
      // the agent can no longer use. Strip computer ids from the *stored*
      // grant so the user's other unsaved edits stay unsaved.
      const nextGroups = new Set(enabledToolGroups)
      nextGroups.delete('computer')
      setEnabledToolGroups(nextGroups)
      await overlayAppClient.agents.update(activeWorkspaceId, agent.id, {
        allowedToolIds: agent.allowedToolIds.filter((id) => !(COMPUTER_TOOL_IDS as readonly string[]).includes(id)),
      })
      setAgentComputer(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the computer.')
    } finally {
      setComputerLifecycleBusy(null)
    }
  }

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

  const sayHello = () => {
    if (!agent) return
    void startAgentChat({
      workspaceId: activeWorkspaceId,
      agentPrincipalId: agent.principalId,
      showcase,
      push: (href) => router.push(href),
    }).catch((chatError) => {
      setError(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    })
  }

  const title = useMemo(() => {
    if (mode === 'new') return 'New agent'
    if (loading) return 'Agent'
    if (agent) return name.trim() || agent.name
    return 'Agent not found'
  }, [agent, loading, mode, name])

  // In panel presentation the editor lives inside an elevated surface (dialog
  // card or docked side panel), so the shell/body stay transparent instead of
  // painting a second, darker background inside the panel frame.
  const inPanel = presentation === 'panel'

  const editor = (
    <AppScreenShell
      style={inPanel ? { background: 'transparent' } : undefined}
      header={presentation === 'page' ? (
        <AppScreenHeader
          title={title}
          leading={(
            <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Back to agents">
              <ArrowLeft size={14} /> Agents
            </Button>
          )}
          actions={(
            <SayHelloButton
              mode={mode}
              hasAgent={Boolean(agent)}
              highlight={showHello}
              showcase={showcase}
              onSayHello={sayHello}
            />
          )}
        />
      ) : undefined}
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full" style={inPanel ? { background: 'transparent' } : undefined}>
        {loading ? (
          <div className="mx-auto w-full max-w-2xl space-y-4" aria-label="Loading agent">
            <div className="h-9 w-48 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
            <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
            <div className="h-36 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
          </div>
        ) : loadFailed || (mode === 'edit' && !agent) ? (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">Agent not found</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">It may have been archived, or you may not have access to it.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={closeEditor}>Back to agents</Button>
          </div>
        ) : mode === 'new' && !canCreate ? (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">You cannot create agents in this workspace</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Guests can chat with agents but cannot create new ones.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={closeEditor}>Back to agents</Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl pb-24">
            {isDefaultMaster ? <MasterAgentNotice /> : null}

            <div className="mt-5 space-y-5">
              <AgentAvatar
                color={avatarColor}
                shape={avatarShape}
                name={name}
                description={description}
                namePlaceholder={agentType === 'byo' ? 'Local Codex' : 'Research partner'}
                descriptionPlaceholder={agentType === 'byo' ? 'Works in my product repository' : 'Finds evidence and challenges assumptions'}
                onNameChange={(value) => { setName(value); markDirty() }}
                onDescriptionChange={(value) => { setDescription(value); markDirty() }}
                onChange={(color) => { setAvatarColor(color); markDirty() }}
                onShapeChange={(next) => { setAvatarShape(next); markDirty() }}
              />
              <AgentTypeSelector
                hidden={isDefaultMaster || !connectedAgentsEnabled}
                value={agentType}
                onChange={(value) => { setAgentType(value); markDirty() }}
              />
              <div className="space-y-4">
                <AgentBehaviorFields
                  agentType={agentType}
                  connectedAgentsEnabled={connectedAgentsEnabled}
                  computersAvailable={computersAvailable}
                  instructions={instructions}
                  onInstructionsChange={(value) => { setInstructions(value); markDirty() }}
                  modelId={modelId}
                  onModelChange={(value) => { setModelId(value); markDirty() }}
                  modelOptions={modelOptions}
                  enabledToolGroups={enabledToolGroups}
                  onToggleToolGroup={toggleToolGroup}
                  advanced={advanced}
                  onAdvancedChange={setAdvanced}
                  hostedRuntime={hostedRuntime}
                  hostedRuntimeLocked={mode === 'edit' && !freshDraft}
                  managedPickerFailed={managedPickerFailed}
                  onManagedPickerRetry={() => setManagedPickerRetry((count) => count + 1)}
                  onHostedRuntimeChange={(value) => {
                    setHostedRuntime(value)
                    // Reset the model pick so the new runtime's default applies.
                    setHarnessModel('')
                    // A different runtime supports a different connection set.
                    setModelAccess('overlay')
                    markDirty()
                  }}
                  managedHarnesses={managedPicker?.harnesses ?? []}
                  harnessModel={harnessModel}
                  onHarnessModelChange={(value) => { setHarnessModel(value); markDirty() }}
                  managedModelAccess={modelAccess}
                  onManagedModelAccessChange={(value) => { setModelAccess(value); markDirty() }}
                  managedByokConnections={managedByokConnections}
                  managedProvider={managedProvider}
                  managedWorkingDirectory={managedWorkingDirectory}
                  managedSandboxStatus={managedEnvironment?.status ?? null}
                  managedResetBusy={managedResetBusy}
                  onManagedReset={managedEnvironment ? () => void resetManagedHarness() : undefined}
                  adapterId={adapterId}
                  harnessOptions={harnessOptions}
                  onHarnessChange={(value) => { chooseHarness(value); markDirty() }}
                  environmentChoice={environmentChoice}
                  onEnvironmentChoiceChange={(value) => { setEnvironmentChoice(value); markDirty() }}
                  compatibleEnvironments={compatibleEnvironments}
                  environmentsLoading={environmentsLoading}
                  environmentId={environmentId}
                  onEnvironmentChange={(value) => { chooseEnvironment(value); markDirty() }}
                  workingDirectory={workingDirectory}
                  onWorkingDirectoryChange={(value) => { setWorkingDirectory(value); markDirty() }}
                  selectedHarnessConnectable={Boolean(selectedHarness?.connectable)}
                  environmentBusy={environmentBusy}
                  environmentError={environmentError}
                  command={command}
                  copied={copied}
                  onCopyCommand={copyCommand}
                  onBeginConnection={beginConnection}
                  setupEnvironment={setupEnvironment}
                  setupRoots={setupRoots}
                  onSetupRootsChange={(value) => { setSetupRoots(value); markDirty() }}
                  onApproveSetup={approveSetupEnvironment}
                  computer={agentType === 'overlay' && computersAvailable ? {
                    size: computerSize,
                    onSizeChange: (next: ComputerSize) => { setComputerSize(next); markDirty() },
                    computer: agentComputer,
                    openBusy: computerOpenBusy,
                    lifecycleBusy: computerLifecycleBusy,
                    onOpenDesktop: () => void openAgentComputer(),
                    onTogglePower: () => void toggleAgentComputerPower(),
                    onDelete: () => void deleteAgentComputer(),
                    disabled: showcase,
                  } : undefined}
                />

                <AccessSelector value={visibility} onChange={(value) => { setVisibility(value); markDirty() }} />

                <DangerZone
                  mode={mode}
                  hasAgent={Boolean(agent)}
                  isDefaultMaster={isDefaultMaster}
                  busy={busy}
                  agentName={agent?.name ?? 'this agent'}
                  onArchive={() => void archiveAgent()}
                />

                {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
                {savedFlash && mode === 'edit'
                  ? <p role="status" className="text-xs text-[var(--muted)]">Saved.</p>
                  : null}
                {mode === 'new' ? (
                  <>
                    <Button
                      className="mt-2 w-full"
                      disabled={busy || !valid}
                      onClick={() => persistNew()}
                    >
                      {busy ? 'Creating…' : 'Create agent'}
                    </Button>
                    <Button variant="ghost" className="w-full" disabled={busy} onClick={closeEditor}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="mt-2 w-full"
                      disabled={busy || !valid || !dirty}
                      onClick={() => saveEdit()}
                    >
                      {busy ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button variant="ghost" className="w-full" disabled={busy} onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )

  if (presentation === 'panel') {
    if (panelMode === 'side') {
      return (
        <AgentEditorSidePanel
          title={title}
          mode={mode}
          savedFlash={savedFlash}
          onTogglePanelMode={onTogglePanelMode}
          onClose={closeEditor}
        >
          {editor}
        </AgentEditorSidePanel>
      )
    }
    return (
      <AgentEditorDialog
        title={title}
        onTogglePanelMode={onTogglePanelMode}
        onClose={closeEditor}
      >
        {editor}
      </AgentEditorDialog>
    )
  }

  return editor
}
