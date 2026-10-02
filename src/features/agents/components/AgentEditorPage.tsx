'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { WorkspaceAgentCreateInput, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
} from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useWorkspace } from '@/contexts/WorkspaceContext'
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

export function AgentEditorPage({
  mode,
  agentId,
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bootstrap = useAgentEditorBootstrap({ showcase, mode, agentId, activeWorkspaceId, initial })
  const { agent, setAgent, loading, loadFailed, canCreate, connectedAgentsEnabled } = bootstrap

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
    markDirty: form.markDirty, setError,
  })

  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

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
    if (runtime.cloudAgent) delete built.allowedToolIds
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
    setError,
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

  return (
    <AgentEditorView
      presentation={presentation}
      panelMode={panelMode}
      onTogglePanelMode={onTogglePanelMode}
      title={title}
      inPanel={inPanel}
      showHello={showHello}
      mode={mode}
      agent={agent}
      loading={loading}
      loadFailed={loadFailed}
      canCreate={canCreate}
      isDefaultMaster={isDefaultMaster}
      valid={valid}
      busy={busy}
      error={error}
      showcase={showcase}
      computersAvailable={computersAvailable}
      connectedAgentsEnabled={connectedAgentsEnabled}
      modelOptions={modelOptions}
      form={form}
      runtime={runtime}
      byo={byo}
      computer={computer}
      surfaces={surfaces}
      closeEditor={closeEditor}
      sayHello={sayHello}
      persistNew={persistNew}
      saveEdit={saveEdit}
      cancelEdit={cancelEdit}
      archiveAgent={archiveAgent}
    />
  )
}
