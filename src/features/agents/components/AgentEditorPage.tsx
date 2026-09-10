'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
} from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '@/shared/agents/tool-groups'
import {
  dispatchAgentIdentityPreview,
} from '@/shared/agents/agent-identity-preview'
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import { buildWorkspaceAgentInput, isAgentEditorValid, isDefaultMasterAgent } from '../lib/agent-editor-input'
import { buildAgentEditorHref, buildAgentsDirectoryHref, startAgentChat } from '../lib/agent-chat'
import { SHOWCASE_AGENTS } from '../lib/showcase-agents'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
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
import { useByoConnection } from './use-byo-connection'

export function AgentEditorPage({
  mode,
  agentId,
  showcase = false,
  presentation = 'page',
  onClose,
  onCreated,
  onArchived,
}: {
  mode: 'new' | 'edit'
  agentId?: string
  showcase?: boolean
  presentation?: 'page' | 'panel'
  onClose?: () => void
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showHello = searchParams?.get('hello') === '1'
  const { activeWorkspaceId } = useWorkspace()
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
  const {
    environmentChoice, setEnvironmentChoice, environmentsLoading, environmentId, adapterId,
    workingDirectory, setWorkingDirectory, harnessOptions, selectedHarness, compatibleEnvironments,
    setupEnvironment, environmentBusy, environmentError, command, copied, setupRoots, setSetupRoots,
    bindingValid, chooseHarness, chooseEnvironment, beginConnection, approveSetupEnvironment, copyCommand,
  } = useByoConnection({ activeWorkspaceId, showcase, agent, agentType, connectedAgentsEnabled, setAgentType })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [dirty, setDirty] = useState(false)
  const latestAgentRef = useRef(agent)
  const latestWorkspaceIdRef = useRef(activeWorkspaceId)
  const latestEditorModeRef = useRef({ mode, showcase })

  useEffect(() => {
    latestAgentRef.current = agent
    latestWorkspaceIdRef.current = activeWorkspaceId
    latestEditorModeRef.current = { mode, showcase }
  }, [activeWorkspaceId, agent, mode, showcase])

  useEffect(() => {
    if (mode !== 'edit' || showcase || !agent || !activeWorkspaceId) return
    dispatchAgentIdentityPreview({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      principalId: agent.principalId,
      name: name.trim() || agent.name,
      avatarColor,
      avatarShape,
    })
  }, [activeWorkspaceId, agent, avatarColor, avatarShape, mode, name, showcase])

  useEffect(() => () => {
    const currentAgent = latestAgentRef.current
    const workspaceId = latestWorkspaceIdRef.current
    const { mode: currentMode, showcase: isShowcase } = latestEditorModeRef.current
    if (currentMode !== 'edit' || isShowcase || !currentAgent || !workspaceId) return
    dispatchAgentIdentityPreview({
      workspaceId,
      agentId: currentAgent.id,
      principalId: currentAgent.principalId,
      name: currentAgent.name,
      avatarColor: currentAgent.avatarColor,
      avatarShape: currentAgent.avatarShape,
    })
  }, [])

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

  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

  const isDefaultMaster = isDefaultMasterAgent(agent)
  const valid = isAgentEditorValid({
    name, instructions, modelId, agentType, connectedAgentsEnabled, bindingValid,
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
        name, description, instructions, agentType, harnessLabel, adapterId,
        modelId, avatarColor, avatarShape, enabledToolGroups, visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }
  }, [selectedHarness, adapterId, name, description, instructions, agentType, modelId,
    avatarColor, avatarShape, enabledToolGroups, visibility, agent])

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
    setDirty(false)
    setSavedFlash(false)
  }, [agent])

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
        if (agentType === 'byo') {
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
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.update(activeWorkspaceId, agent.id, buildInput())
        if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } else if (workspaceAgentUsesByo(agent)) {
          // Switched a connected agent back to Overlay: drop its binding once.
          await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
            .catch(() => undefined)
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        setAgent(saved.agent)
        setDirty(false)
        setSavedFlash(true)
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
    return agent ? name.trim() || agent.name : 'Agent not found'
  }, [agent, loading, mode, name])

  const editor = (
    <AppScreenShell
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
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
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
                  instructions={instructions}
                  onInstructionsChange={(value) => { setInstructions(value); markDirty() }}
                  modelId={modelId}
                  onModelChange={(value) => { setModelId(value); markDirty() }}
                  modelOptions={modelOptions}
                  enabledToolGroups={enabledToolGroups}
                  onToggleToolGroup={toggleToolGroup}
                  advanced={advanced}
                  onAdvancedChange={setAdvanced}
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
    return (
      <DialogFrame
        open
        onOpenChange={(next) => { if (!next) closeEditor() }}
        title={title}
        className="max-h-[88vh] w-[min(560px,94vw)] overflow-y-auto"
      >
        {editor}
      </DialogFrame>
    )
  }

  return editor
}

function getShowcaseAgent(
  showcase: boolean,
  mode: 'new' | 'edit',
  agentId: string | undefined,
): WorkspaceAgentDirectoryItem | null {
  if (!showcase || mode !== 'edit') return null
  return SHOWCASE_AGENTS.find((candidate) => candidate.id === agentId) ?? null
}

function getInitialEditorState(args: {
  showcase: boolean
  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
}) {
  const { agent } = args
  return {
    agent,
    loading: !args.showcase,
    canCreate: args.showcase || args.mode === 'edit',
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    instructions: agent?.instructions ?? '',
    modelId: agent?.modelId ?? DEFAULT_MODEL_ID,
    avatarColor: agent?.avatarColor ?? AVATAR_COLORS[0]!,
    avatarShape: agent?.avatarShape ?? 'circle',
    visibility: agent?.visibility ?? 'workspace',
  }
}

function SayHelloButton({ mode, hasAgent, highlight, showcase, onSayHello }: {
  mode: 'new' | 'edit'
  hasAgent: boolean
  highlight: boolean
  showcase: boolean
  onSayHello(): void
}) {
  if (mode !== 'edit' || !hasAgent || (!highlight && !showcase)) return null
  return <Button variant="secondary" size="sm" onClick={onSayHello}><MessageSquare size={13} /> Say hello</Button>
}
