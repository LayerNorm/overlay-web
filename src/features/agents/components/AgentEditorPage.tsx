'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type {
  WorkspaceAgentCreateInput,
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
  availableByoHarnesses,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  workspaceAgentUsesByo,
  type BuiltInByoHarnessId,
} from '../lib/byo-agent-setup'
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
  OverlayAgentFields,
  parseRoots,
  type AgentType,
  type EnvironmentChoice,
} from './AgentEditorForm'

export function AgentEditorPage({ mode, agentId, showcase = false }: {
  mode: 'new' | 'edit'
  agentId?: string
  showcase?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showHello = searchParams?.get('hello') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const { settings } = useAppSettings()
  const enabledModelIds = settings.enabledChatModelIds

  const showcaseAgent = showcase && mode === 'edit'
    ? SHOWCASE_AGENTS.find((candidate) => candidate.id === agentId)
    : undefined
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(showcaseAgent ?? null)
  const [loading, setLoading] = useState(!showcase)
  const [loadFailed, setLoadFailed] = useState(false)
  const [canCreate, setCanCreate] = useState(showcase || mode === 'edit')
  const [connectedAgentsEnabled, setConnectedAgentsEnabled] = useState(false)

  const [name, setName] = useState(showcaseAgent?.name ?? '')
  const [description, setDescription] = useState(showcaseAgent?.description ?? '')
  const [instructions, setInstructions] = useState(showcaseAgent?.instructions ?? '')
  const [modelId, setModelId] = useState<string>(showcaseAgent?.modelId ?? DEFAULT_MODEL_ID)
  const [avatarColor, setAvatarColor] = useState(showcaseAgent?.avatarColor ?? AVATAR_COLORS[0]!)
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>(showcaseAgent?.visibility ?? 'workspace')
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => (showcaseAgent
    ? enabledAgentToolGroupIds(showcaseAgent.allowedToolIds)
    : new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)))
  const [advanced, setAdvanced] = useState(false)
  const [agentType, setAgentType] = useState<AgentType>(() => (
    workspaceAgentUsesByo(showcaseAgent) ? 'byo' : 'overlay'
  ))
  const [environmentChoice, setEnvironmentChoice] = useState<EnvironmentChoice>('existing')
  const [environments, setEnvironments] = useState<AgentEnvironmentResource[]>([])
  const [environmentsLoading, setEnvironmentsLoading] = useState(false)
  const [environmentId, setEnvironmentId] = useState('')
  const [adapterId, setAdapterId] = useState('codex')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [environmentBusy, setEnvironmentBusy] = useState<string | null>(null)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)
  const [setupEnvironmentId, setSetupEnvironmentId] = useState<string | null>(null)
  const [setupRoots, setSetupRoots] = useState('')
  const [enrollmentBaselineIds, setEnrollmentBaselineIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

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

  // Reset the form whenever the loaded agent changes (initial load, save).
  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(agent.modelId)
    setAvatarColor(agent.avatarColor ?? AVATAR_COLORS[0]!)
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    setSavedFlash(false)
  }, [agent])

  const refreshEnvironments = useCallback(async () => {
    if (!activeWorkspaceId || showcase) return []
    const result = await overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' })
    setEnvironments(result.environments)
    return result.environments
  }, [activeWorkspaceId, showcase])

  useEffect(() => {
    if (!activeWorkspaceId || showcase || !connectedAgentsEnabled || (!agent && agentType !== 'byo')) return
    let cancelled = false
    setEnvironmentsLoading(true)
    setEnvironmentError(null)
    void Promise.all([
      overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' }),
      agent ? overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId, agent.id) : Promise.resolve({ bindings: [] }),
    ]).then(([environmentResult, bindingResult]) => {
      if (cancelled) return
      setEnvironments(environmentResult.environments)
      const binding = bindingResult.bindings[0]
      if (!binding) return
      const bindingAdapterId = typeof binding.adapterConfig.adapterId === 'string'
        ? binding.adapterConfig.adapterId : 'codex'
      setAgentType('byo')
      setEnvironmentChoice('existing')
      setEnvironmentId(binding.environmentId)
      setAdapterId(bindingAdapterId)
      setWorkingDirectory(typeof binding.adapterConfig.workingDirectory === 'string'
        ? binding.adapterConfig.workingDirectory : '')
    }).catch((value) => {
      if (!cancelled) setEnvironmentError(value instanceof Error ? value.message : 'Could not load environments.')
    }).finally(() => {
      if (!cancelled) setEnvironmentsLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, agent, agentType, connectedAgentsEnabled, showcase])

  useEffect(() => {
    if (!command || setupEnvironmentId) return
    const timer = window.setInterval(() => {
      void refreshEnvironments().catch((value) => {
        setEnvironmentError(value instanceof Error ? value.message : 'Could not refresh environments.')
      })
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [command, refreshEnvironments, setupEnvironmentId])

  useEffect(() => {
    if (!command || setupEnvironmentId) return
    const baseline = new Set(enrollmentBaselineIds)
    const pending = [...environments]
      .filter((environment) => environment.status === 'pending' && !baseline.has(environment.id))
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    if (pending) setSetupEnvironmentId(pending.id)
  }, [command, enrollmentBaselineIds, environments, setupEnvironmentId])

  const harnessOptions = useMemo(() => availableByoHarnesses(environments), [environments])
  const selectedHarness = harnessOptions.find((harness) => harness.id === adapterId) ?? harnessOptions[0]!
  const compatibleEnvironments = useMemo(() => environments.filter((environment) => (
    environment.status !== 'pending'
      && environment.status !== 'revoked'
      && environmentSupportsHarness(environment, adapterId)
  )), [adapterId, environments])
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId)
  const setupEnvironment = environments.find((environment) => environment.id === setupEnvironmentId)

  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

  const isDefaultMaster = Boolean(agent?.isDefault || agent?.name.toLowerCase() === 'overlay')
  const bindingValid = Boolean(environmentId && adapterId && workingDirectory.trim())
  const valid = isAgentEditorValid({
    name, instructions, modelId, agentType, connectedAgentsEnabled, bindingValid,
  })

  const toggleToolGroup = (groupId: string) => {
    setSavedFlash(false)
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const chooseHarness = (nextAdapterId: string) => {
    setAdapterId(nextAdapterId)
    setEnvironmentError(null)
    setCommand('')
    setSetupEnvironmentId(null)
    setSetupRoots('')
    if (selectedEnvironment && !environmentSupportsHarness(selectedEnvironment, nextAdapterId)) {
      setEnvironmentId('')
      setWorkingDirectory('')
    }
    const nextHarness = harnessOptions.find((harness) => harness.id === nextAdapterId)
    if (nextHarness && !nextHarness.connectable && environmentChoice !== 'existing') {
      setEnvironmentChoice('existing')
    }
  }

  const chooseEnvironment = (nextEnvironmentId: string) => {
    const environment = environments.find((candidate) => candidate.id === nextEnvironmentId)
    setEnvironmentId(nextEnvironmentId)
    setWorkingDirectory(defaultWorkingDirectory(environment))
  }

  const beginConnection = async () => {
    if (showcase) {
      setEnvironmentError('Sign in to connect an environment.')
      return
    }
    if (!activeWorkspaceId || !selectedHarness?.connectable) return
    setEnvironmentBusy('connect')
    setEnvironmentError(null)
    setCommand('')
    setSetupEnvironmentId(null)
    setSetupRoots('')
    setEnrollmentBaselineIds(environments.map((environment) => environment.id))
    try {
      const result = await overlayAppClient.agentEnvironments.createEnrollment(activeWorkspaceId, {
        adapterId: adapterId as BuiltInByoHarnessId,
      })
      setCommand(result.command)
    } catch (value) {
      setEnvironmentError(value instanceof Error ? value.message : 'Could not create the connection command.')
    } finally {
      setEnvironmentBusy(null)
    }
  }

  const approveSetupEnvironment = async () => {
    if (!activeWorkspaceId || !setupEnvironmentId) return
    const roots = parseRoots(setupRoots)
    if (roots.length === 0) {
      setEnvironmentError('Enter at least one absolute project root.')
      return
    }
    setEnvironmentBusy('approve')
    setEnvironmentError(null)
    try {
      await overlayAppClient.agentEnvironments.approve(activeWorkspaceId, setupEnvironmentId, {
        mode: 'selected_roots', roots,
      })
      await refreshEnvironments()
      setEnvironmentId(setupEnvironmentId)
      setWorkingDirectory(roots[0]!)
      setEnvironmentChoice('existing')
      setCommand('')
      setSetupEnvironmentId(null)
      setSetupRoots('')
    } catch (value) {
      setEnvironmentError(value instanceof Error ? value.message : 'Environment approval failed.')
    } finally {
      setEnvironmentBusy(null)
    }
  }

  const copyCommand = async () => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setEnvironmentError('Could not copy the command. Select it and copy it manually.')
    }
  }

  const directoryHref = buildAgentsDirectoryHref(activeWorkspaceId, showcase)

  const save = async () => {
    if (showcase) {
      router.push(directoryHref)
      return
    }
    if (!activeWorkspaceId) return
    const harnessLabel = selectedHarness?.label ?? adapterId
    const input: WorkspaceAgentCreateInput = {
      ...buildWorkspaceAgentInput({
        name, description, instructions, agentType, harnessLabel, adapterId,
        modelId, avatarColor, enabledToolGroups, visibility,
      }),
      teamIds: agent?.teamIds ?? [],
    }
    const binding = agentType === 'byo'
      ? { environmentId, adapterId, workingDirectory: workingDirectory.trim() }
      : agent ? null : undefined
    setBusy(true)
    setError(null)
    setSavedFlash(false)
    try {
      const saved = agent
        ? await overlayAppClient.agents.update(activeWorkspaceId, agent.id, input)
        : await overlayAppClient.agents.create(activeWorkspaceId, input)
      if (binding) {
        try {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            ...binding,
          })
        } catch (bindingError) {
          // Agent identity may already be durable even if its remote binding
          // fails. Land on the edit page so a retry never creates a duplicate.
          router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
          throw bindingError
        }
      } else if (binding === null && agent) {
        await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
      }
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      if (!agent) {
        router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
      } else {
        setAgent(saved.agent)
        setSavedFlash(true)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
    } finally {
      setBusy(false)
    }
  }

  const archiveAgent = async () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    if (!window.confirm(`Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`)) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      router.push(directoryHref)
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

  const title = mode === 'new' ? 'New agent' : loading ? 'Agent' : agent?.name ?? 'Agent not found'

  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title={title}
          leading={(
            <Button variant="ghost" size="sm" onClick={() => router.push(directoryHref)} aria-label="Back to agents">
              <ArrowLeft size={14} /> Agents
            </Button>
          )}
          actions={mode === 'edit' && agent && (showHello || showcase) ? (
            <Button variant="secondary" size="sm" onClick={sayHello}><MessageSquare size={13} /> Say hello</Button>
          ) : null}
        />
      )}
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
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push(directoryHref)}>Back to agents</Button>
          </div>
        ) : mode === 'new' && !canCreate ? (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 text-center">
            <p className="text-sm font-medium text-[var(--foreground)]">You cannot create agents in this workspace</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Guests can chat with agents but cannot create new ones.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push(directoryHref)}>Back to agents</Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl pb-24">
            {!isDefaultMaster && connectedAgentsEnabled ? (
              <AgentTypeSelector value={agentType} onChange={(value) => { setAgentType(value); setSavedFlash(false) }} />
            ) : null}
            {isDefaultMaster ? (
              <p className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-xs leading-5 text-[var(--muted)]">
                Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).
              </p>
            ) : null}

            <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
              <AgentAvatar color={avatarColor} onChange={(color) => { setAvatarColor(color); setSavedFlash(false) }} />
              <div className="space-y-4">
                <label className="block text-xs font-medium">
                  Agent name
                  <Input autoFocus className="mt-1.5" value={name} onChange={(event) => { setName(event.target.value); setSavedFlash(false) }} placeholder={agentType === 'byo' ? 'Local Codex' : 'Research partner'} />
                </label>
                <label className="block text-xs font-medium">
                  Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
                  <Input className="mt-1.5" value={description} onChange={(event) => { setDescription(event.target.value); setSavedFlash(false) }} placeholder={agentType === 'byo' ? 'Works in my product repository' : 'Finds evidence and challenges assumptions'} />
                </label>

                {agentType === 'overlay' ? (
                  <OverlayAgentFields
                    instructions={instructions}
                    onInstructionsChange={(value) => { setInstructions(value); setSavedFlash(false) }}
                    modelId={modelId}
                    onModelChange={(value) => { setModelId(value); setSavedFlash(false) }}
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
                    onHarnessChange={chooseHarness}
                    choice={environmentChoice}
                    onChoiceChange={setEnvironmentChoice}
                    compatibleEnvironments={compatibleEnvironments}
                    environmentsLoading={environmentsLoading}
                    environmentId={environmentId}
                    onEnvironmentChange={chooseEnvironment}
                    workingDirectory={workingDirectory}
                    onWorkingDirectoryChange={setWorkingDirectory}
                    selectedHarnessConnectable={Boolean(selectedHarness?.connectable)}
                    environmentBusy={environmentBusy}
                    environmentError={environmentError}
                    command={command}
                    copied={copied}
                    onCopyCommand={copyCommand}
                    onBeginConnection={beginConnection}
                    setupEnvironment={setupEnvironment}
                    setupRoots={setupRoots}
                    onSetupRootsChange={setSetupRoots}
                    onApproveSetup={approveSetupEnvironment}
                  />
                ) : (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-xs leading-5 text-[var(--muted)]">
                    This connected agent is unchanged. Connected-agent editing is not available for this workspace right now.
                  </div>
                )}

                <AccessSelector value={visibility} onChange={(value) => { setVisibility(value); setSavedFlash(false) }} />

                {mode === 'edit' && agent && !isDefaultMaster ? (
                  <section className="rounded-xl border border-red-500/25 p-4">
                    <p className="text-xs font-medium text-[var(--foreground)]">Danger zone</p>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Archiving removes the agent from rooms and teams. Its message history remains.</p>
                    <Button variant="danger" size="sm" className="mt-3" onClick={archiveAgent} disabled={busy}>Archive agent</Button>
                  </section>
                ) : null}

                {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
                {savedFlash ? <p role="status" className="text-xs text-[var(--muted)]">Saved.</p> : null}
              </div>
            </div>

            <div className="sticky bottom-0 mt-8 border-t border-[var(--border)] bg-[var(--background)]/95 py-3 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="flex-1" />
                <Button variant="ghost" onClick={() => router.push(directoryHref)} disabled={busy}>Cancel</Button>
                <Button variant="secondary" disabled={busy || !valid} onClick={save}>
                  {busy ? 'Saving…' : mode === 'new' ? 'Create agent' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
