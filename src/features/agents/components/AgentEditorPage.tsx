'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell, AppScreenSidePanel } from '@overlay/modules-react/shell'
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
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import { buildWorkspaceAgentInput, isAgentEditorValid } from '../lib/agent-editor-input'
import { buildAgentEditorHref, buildAgentsDirectoryHref, startAgentChat } from '../lib/agent-chat'
import { SHOWCASE_AGENTS } from '../lib/showcase-agents'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import {
  AccessSelector,
  AgentAvatar,
  AgentTypeSelector,
  AVATAR_COLORS,
  ByoAgentFields,
  DangerZone,
  OverlayAgentFields,
  type AgentType,
} from './AgentEditorForm'
import { useByoConnection } from './use-byo-connection'
import { useAgentFormHydration, useAgentPersistence } from './use-agent-persistence'

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

  const isDefaultMaster = Boolean(agent?.isDefault || agent?.name.toLowerCase() === 'overlay')
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

  const persistence = useAgentPersistence({
    mode, showcase, loading, agent, activeWorkspaceId, agentType,
    environmentId, adapterId, workingDirectory, valid, busy, setBusy,
    setError, buildInput,
    afterCreate: (saved) => {
      if (onCreated) onCreated(saved)
      else router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.id)}?hello=1`)
    },
    afterEdit: (saved) => setAgent(saved),
  })
  const { savedFlash, markDirty } = persistence

  // Reset the form whenever a different agent loads. The persistence hook
  // owns the saved indicator; it clears only on agent switches, surviving
  // saves.
  useAgentFormHydration({
    agent,
    onHydrate: (loaded) => {
      setName(loaded.name)
      setDescription(loaded.description ?? '')
      setInstructions(loaded.instructions)
      setModelId(loaded.modelId)
      setAvatarColor(loaded.avatarColor ?? AVATAR_COLORS[0]!)
      setAvatarShape(loaded.avatarShape ?? 'circle')
      setVisibility(loaded.visibility)
      setEnabledToolGroups(enabledAgentToolGroupIds(loaded.allowedToolIds))
    },
    onAgentSwitch: () => persistence.resetSaveState(),
  })

  const persistNew = () => {
    if (showcase) {
      router.push(directoryHref)
      return
    }
    void persistence.persistNew()
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
    return agent?.name ?? 'Agent not found'
  }, [agent?.name, loading, mode])

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
            <AgentTypeSelector
              hidden={isDefaultMaster || !connectedAgentsEnabled}
              value={agentType}
              onChange={(value) => { setAgentType(value); markDirty() }}
            />
            {isDefaultMaster ? (
              <p className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-xs leading-5 text-[var(--muted)]">
                Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).
              </p>
            ) : null}

            <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
              <AgentAvatar
                color={avatarColor}
                shape={avatarShape}
                onChange={(color) => { setAvatarColor(color); markDirty() }}
                onShapeChange={(next) => { setAvatarShape(next); markDirty() }}
              />
              <div className="space-y-4">
                <label className="block text-xs font-medium">
                  Agent name
                  <Input autoFocus className="mt-1.5" value={name} onChange={(event) => { setName(event.target.value); markDirty() }} placeholder={agentType === 'byo' ? 'Local Codex' : 'Research partner'} />
                </label>
                <label className="block text-xs font-medium">
                  Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
                  <Input className="mt-1.5" value={description} onChange={(event) => { setDescription(event.target.value); markDirty() }} placeholder={agentType === 'byo' ? 'Works in my product repository' : 'Finds evidence and challenges assumptions'} />
                </label>

                {agentType === 'overlay' ? (
                  <OverlayAgentFields
                    instructions={instructions}
                    onInstructionsChange={(value) => { setInstructions(value); markDirty() }}
                    modelId={modelId}
                    onModelChange={(value) => { setModelId(value); markDirty() }}
                    modelOptions={modelOptions}
                    enabledToolGroups={enabledToolGroups}
                    onToggleToolGroup={toggleToolGroup}
                    advanced={advanced}
                    onAdvancedChange={setAdvanced}
                  />
                ) : connectedAgentsEnabled ? (
                  <ByoAgentFields
                    adapterId={adapterId}
                    harnessOptions={harnessOptions}
                    onHarnessChange={(value) => { chooseHarness(value); markDirty() }}
                    choice={environmentChoice}
                    onChoiceChange={(value) => { setEnvironmentChoice(value); markDirty() }}
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
                ) : (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-xs leading-5 text-[var(--muted)]">
                    This connected agent is unchanged. Connected-agent editing is not available for this workspace right now.
                  </div>
                )}

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
                {mode === 'new' ? (
                  <Button
                    className="mt-2 w-full"
                    disabled={busy || !valid}
                    onClick={() => void persistNew()}
                  >
                    {busy ? 'Creating…' : 'Create agent'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )

  if (presentation === 'panel') {
    return (
      <AppScreenSidePanel
        title={title}
        actions={savedFlash && mode === 'edit'
          ? <span role="status" className="text-[11px] text-[var(--muted)]">Saved</span>
          : undefined}
        onClose={closeEditor}
        closeLabel="Close agent settings"
        bodyClassName="overflow-hidden"
      >
        {editor}
      </AppScreenSidePanel>
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
