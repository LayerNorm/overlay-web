'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentProps } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { WorkspaceAgentCreateInput, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  getModelsByIntelligence,
  getGatewayCatalogRevision,
} from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useWorkspaceTextModelAccess, buildSelectableTextModels } from '@/components/providers/useWorkspaceTextModelAccess'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { parseByoModelId } from '@/shared/agents/agent-model'
import { buildWorkspaceAgentInput, isAgentEditorValid, isDefaultMasterAgent } from '../lib/agent-editor-input'
import { buildAgentsDirectoryHref } from '../lib/agent-chat'
import { getInitialEditorState, getShowcaseAgent } from '../lib/agent-editor-state'
import { useByoConnection } from './use-byo-connection'
import { useAgentSurfaces } from './use-agent-surfaces'
import { useAgentEditorBootstrap } from './use-agent-editor-bootstrap'
import { useAgentRuntime } from './use-agent-runtime'
import { useAgentEditorForm } from './use-agent-editor-form'
import { useAgentComputer } from './use-agent-computer'
import { useAgentEditorActions } from './use-agent-editor-actions'
import { AgentEditorView } from './AgentEditorPage.parts'

export type AgentEditorPageProps = {
  mode: 'new' | 'edit'
  agentId?: string
  showcase?: boolean
  presentation?: 'page' | 'panel'
  embedded?: boolean
  panelMode?: 'dialog' | 'side'
  onTogglePanelMode?: () => void
  onClose?: () => void
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
  onSaved?: () => void
  keepOpenOnSave?: boolean
}

export function AgentEditorPage(props: AgentEditorPageProps) {
  const { viewProps } = useAgentEditorController(props)
  return createAgentEditorPageView(viewProps)
}

export function createAgentEditorPageView(viewProps: ComponentProps<typeof AgentEditorView>) {
  return <AgentEditorView {...viewProps} />
}

export function useAgentEditorController({
  mode,
  agentId,
  showcase = false,
  presentation = 'page',
  embedded = false,
  panelMode,
  onTogglePanelMode,
  onClose,
  onCreated,
  onArchived,
  onSaved,
  keepOpenOnSave = false,
}: AgentEditorPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showHello = searchParams?.get('hello') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const { capabilities } = useOverlayCapabilities()
  const { settings } = useAppSettings()
  const { user: authUser } = useAuth()
  const computersAvailable = capabilities.computers === true
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const modelAccess = useWorkspaceTextModelAccess({
    activeWorkspaceId,
    billingEnabled: capabilities.billing === true,
    catalogRevision: revision,
    onlyAllowZdrModels: settings.onlyAllowZdrModels,
  })
  const { loadSubscription } = modelAccess
  useEffect(() => {
    void loadSubscription()
  }, [loadSubscription])

  const showcaseAgent = getShowcaseAgent(showcase, mode, agentId)
  // One initializer keeps per-field fallbacks out of the component body.
  const [initial] = useState(() => getInitialEditorState({ showcase, mode, agent: showcaseAgent }))
  const [busy, setBusy] = useState(false)

  const bootstrap = useAgentEditorBootstrap({ showcase, mode, agentId, activeWorkspaceId, initial })
  const { agent, setAgent, loading, loadFailed, canCreate, connectedAgentsEnabled, connectedAgentsChecked } = bootstrap

  const runtime = useAgentRuntime({ showcaseAgent })

  const byo = useByoConnection({
    activeWorkspaceId, showcase, agent, agentType: runtime.agentType, connectedAgentsEnabled,
    setAgentType: runtime.setAgentType, onLegacyHostedBinding: runtime.onLegacyHostedBinding,
    onCloudBinding: runtime.onCloudBinding,
  })

  const form = useAgentEditorForm({
    initial, showcaseAgent, agent, showcase, activeWorkspaceId,
    setLegacyHostedRuntime: runtime.setLegacyHostedRuntime,
    setAgentType: runtime.setAgentType,
  })

  const surfaces = useAgentSurfaces({ activeWorkspaceId, showcase, agent, agentType: runtime.agentType })
  const computer = useAgentComputer({
    showcase, computersAvailable, activeWorkspaceId, agent, agentType: runtime.agentType,
    enabledToolGroups: form.enabledToolGroups, setEnabledToolGroups: form.setEnabledToolGroups,
    markDirty: form.markDirty,
  })

  const allTextModels = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getModelsByIntelligence(false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
  }, [revision])
  const modelField = useMemo(() => {
    const accessUnresolved = capabilities.billing === true && !modelAccess.entitlements
    const selectableTextModels = modelAccess.loading || accessUnresolved
      ? buildSelectableTextModels({
          isModelAccessRestricted: true,
          effectiveOnlyAllowZdrModels: false,
        })
      : modelAccess.selectableTextModels
    return {
      favoriteScope: authUser?.id ?? null,
      isFreeTier: modelAccess.isFreeTier || modelAccess.loading || accessUnresolved,
      isFreeTierWorkspace: modelAccess.isFreeTier,
      modelPickerLabel: allTextModels.find((model) => model.id === form.modelId)?.name ?? form.modelId,
      selectableTextModels,
      textModelsLoading: false,
    }
  }, [
    allTextModels,
    authUser?.id,
    capabilities.billing,
    form.modelId,
    modelAccess.entitlements,
    modelAccess.isFreeTier,
    modelAccess.loading,
    modelAccess.selectableTextModels,
  ])

  const isDefaultMaster = isDefaultMasterAgent(agent)
  const valid = isAgentEditorValid({
    name: form.name, instructions: form.instructions, modelId: form.modelId,
    agentType: runtime.agentType, legacyHostedRuntime: runtime.legacyHostedRuntime, connectedAgentsEnabled,
    bindingValid: byo.bindingValid || runtime.cloudAgent,
  })

  const directoryHref = buildAgentsDirectoryHref(activeWorkspaceId, showcase)
  const closeEditor = () => onClose ? onClose() : router.push(directoryHref)

  const buildInput = useCallback((): WorkspaceAgentCreateInput => {
    const harnessLabel = byo.selectedHarness?.label ?? byo.adapterId
    const built = {
      ...buildWorkspaceAgentInput({
        name: form.name,
        description: form.description,
        instructions: form.instructions,
        agentType: runtime.agentType,
        harnessLabel,
        adapterId: byo.adapterId,
        modelId: form.modelId,
        avatarColor: form.avatarColor,
        avatarShape: form.avatarShape,
        enabledToolGroups: form.enabledToolGroups,
        visibility: form.visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }
    // An Overlay Cloud agent's Overlay access is set by its own control on this page, not by Save; sending the
    // editor's copy (empty for connected agents) would wipe it.
    // Its model is likewise set by its own control (Model).
    if (runtime.cloudAgent) {
      delete built.allowedToolIds
      delete (built as { modelId?: string }).modelId
    }
    if (agent && runtime.agentType === 'byo' && parseByoModelId(agent.modelId)?.adapterId === byo.adapterId) {
      // The separate settings controls own this choice; an identity edit must not reset it.
      delete (built as { modelId?: string }).modelId
    }
    return built
  }, [runtime.cloudAgent, byo.selectedHarness, byo.adapterId, form.name, form.description, form.instructions,
    runtime.agentType,
    form.modelId, form.avatarColor, form.avatarShape, form.enabledToolGroups, form.visibility,
    agent])

  const { persistNew, saveEdit, cancelEdit, archiveAgent, sayHello } = useAgentEditorActions({
    showcase,
    presentation,
    activeWorkspaceId,
    router,
    busy,
    setBusy,
    agent,
    setAgent,
    directoryHref,
    closeEditor,
    buildInput,
    computersAvailable,
    runtime,
    byo,
    form,
    computer,
    onCreated,
    onArchived,
    onSaved,
    keepOpenOnSave,
  })

  const title = useMemo(() => {
    if (mode === 'new') return 'New agent'
    if (loading) return 'Agent'
    if (agent) return form.name.trim() || agent.name
    return 'Agent not found'
  }, [agent, loading, mode, form.name])

  // In panel presentation the editor lives inside an elevated surface (dialog
  // card or docked side panel), so the shell/body stay transparent instead of
  // painting a second, darker background inside the panel frame.
  const inPanel = presentation === 'panel'

  const viewProps: ComponentProps<typeof AgentEditorView> = {
    presentation,
    embedded,
    panelMode,
    onTogglePanelMode,
    title,
    inPanel,
    showHello,
    mode,
    agent,
    loading,
    loadFailed,
    canCreate,
    isDefaultMaster,
    valid,
    busy,
    showcase,
    computersAvailable,
    connectedAgentsEnabled,
    connectedAgentsChecked,
    modelField,
    form,
    runtime,
    byo,
    computer,
    surfaces,
    closeEditor,
    sayHello,
    persistNew,
    saveEdit,
    cancelEdit,
    archiveAgent,
  }

  return {
    viewProps,
    mode,
    agent,
    loading,
    loadFailed,
    connectedAgentsChecked,
    isDefaultMaster,
    valid,
    busy,
    showcase,
    computersAvailable,
    connectedAgentsEnabled,
    modelField,
    form,
    runtime,
    byo,
    computer,
    surfaces,
    saveEdit,
    archiveAgent,
  }
}
