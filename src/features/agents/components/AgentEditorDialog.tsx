'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronDown, Copy, Laptop, Loader2, Server, ShieldCheck, Sparkles, Terminal } from 'lucide-react'
import { Button, DialogFrame, Input, ListboxSelect } from '@overlay/ui/primitives'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceManagementItem,
} from '@overlay/workspace-contracts'
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
  AGENT_TOOL_GROUPS,
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
  toolIdsForEnabledGroups,
} from '@/shared/agents/tool-groups'
import {
  availableByoHarnesses,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  generatedAgentSetupPrompt,
  generatedByoInstructions,
  workspaceAgentUsesByo,
  workspaceHarnessForByo,
  type BuiltInByoHarnessId,
} from '../lib/byo-agent-setup'

const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']
type AgentType = 'overlay' | 'byo'
type EnvironmentChoice = 'existing' | 'connect'

export function AgentEditorDialog({
  open,
  agent,
  showcase = false,
  connectedAgentsEnabled = false,
  busy,
  error,
  onOpenChange,
  onSave,
  onArchive,
}: {
  open: boolean
  agent?: WorkspaceAgentDirectoryItem | null
  showcase?: boolean
  connectedAgentsEnabled?: boolean
  teams: WorkspaceManagementItem[]
  busy: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onSave(input: WorkspaceAgentCreateInput, binding?: {
    environmentId: string
    adapterId: string
    workingDirectory: string
  } | null): void
  onArchive?(): void
}) {
  const { revision } = useGatewayModelCatalog({ enabled: open })
  const { activeWorkspaceId } = useWorkspace()
  const { settings } = useAppSettings()
  const enabledModelIds = settings.enabledChatModelIds
  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [modelId, setModelId] = useState<string>(agent?.modelId ?? DEFAULT_MODEL_ID)
  const [avatarColor, setAvatarColor] = useState(agent?.avatarColor ?? AVATAR_COLORS[0]!)
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => (agent
    ? enabledAgentToolGroupIds(agent.allowedToolIds)
    : new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)))
  const [advanced, setAdvanced] = useState(false)
  const [agentType, setAgentType] = useState<AgentType>(() => (
    workspaceAgentUsesByo(agent) ? 'byo' : 'overlay'
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

  const refreshEnvironments = useCallback(async () => {
    if (!activeWorkspaceId || showcase) return []
    const result = await overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' })
    setEnvironments(result.environments)
    return result.environments
  }, [activeWorkspaceId, showcase])

  useEffect(() => {
    if (!open || !activeWorkspaceId || showcase || !connectedAgentsEnabled || (!agent && agentType !== 'byo')) return
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
  }, [activeWorkspaceId, agent, agentType, connectedAgentsEnabled, open, showcase])

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
  const valid = Boolean(name.trim() && (agentType === 'overlay'
    ? instructions.trim() && modelId.trim()
    : connectedAgentsEnabled && bindingValid))

  const toggleToolGroup = (groupId: string) => {
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

  const save = () => {
    const byo = agentType === 'byo'
    const harnessLabel = selectedHarness?.label ?? adapterId
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      instructions: byo ? generatedByoInstructions(harnessLabel) : instructions.trim(),
      harness: byo ? workspaceHarnessForByo(adapterId) : 'overlay',
      modelId: byo ? `byo/${adapterId}` : modelId.trim(),
      avatarColor,
      allowedToolIds: byo ? [] : toolIdsForEnabledGroups(enabledToolGroups),
      teamIds: agent?.teamIds ?? [],
    }, byo ? {
      environmentId,
      adapterId,
      workingDirectory: workingDirectory.trim(),
    } : agent ? null : undefined)
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      className="max-h-[92vh] !w-[min(820px,94vw)] overflow-y-auto"
      title={agent ? `Edit ${agent.name}` : 'Create agent'}
      description={isDefaultMaster
        ? 'Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).'
        : agentType === 'byo'
          ? 'Connect a harness that runs on your computer, VPS, or sandbox.'
          : 'Give this workspace a named teammate with a clear job and its own identity.'}
      footer={(
        <>
          {agent && onArchive && !isDefaultMaster ? <Button variant="danger" onClick={onArchive} disabled={busy}>Archive agent</Button> : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="secondary" disabled={busy || !valid} onClick={save}>
            {busy ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}
          </Button>
        </>
      )}
    >
      {!isDefaultMaster && connectedAgentsEnabled ? <AgentTypeSelector value={agentType} onChange={setAgentType} /> : null}

      <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
        <AgentAvatar color={avatarColor} onChange={setAvatarColor} />
        <div className="space-y-4">
          <label className="block text-xs font-medium">
            Agent name
            <Input autoFocus className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder={agentType === 'byo' ? 'Local Codex' : 'Research partner'} />
          </label>
          <label className="block text-xs font-medium">
            Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
            <Input className="mt-1.5" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={agentType === 'byo' ? 'Works in my product repository' : 'Finds evidence and challenges assumptions'} />
          </label>

          {agentType === 'overlay' ? (
            <OverlayAgentFields instructions={instructions} onInstructionsChange={setInstructions} modelId={modelId} onModelChange={setModelId} modelOptions={modelOptions} enabledToolGroups={enabledToolGroups} onToggleToolGroup={toggleToolGroup} advanced={advanced} onAdvancedChange={setAdvanced} />
          ) : connectedAgentsEnabled ? (
            <ByoAgentFields adapterId={adapterId} harnessOptions={harnessOptions} onHarnessChange={chooseHarness} choice={environmentChoice} onChoiceChange={setEnvironmentChoice} compatibleEnvironments={compatibleEnvironments} environmentsLoading={environmentsLoading} environmentId={environmentId} onEnvironmentChange={chooseEnvironment} workingDirectory={workingDirectory} onWorkingDirectoryChange={setWorkingDirectory} selectedHarnessConnectable={Boolean(selectedHarness?.connectable)} environmentBusy={environmentBusy} environmentError={environmentError} command={command} copied={copied} onCopyCommand={copyCommand} onBeginConnection={beginConnection} setupEnvironment={setupEnvironment} setupRoots={setupRoots} onSetupRootsChange={setSetupRoots} onApproveSetup={approveSetupEnvironment} />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-xs leading-5 text-[var(--muted)]">
              This connected agent is unchanged. Connected-agent editing is not available for this workspace right now.
            </div>
          )}
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </div>
    </DialogFrame>
  )
}

function AgentTypeSelector({ value, onChange }: { value: AgentType; onChange(value: AgentType): void }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-subtle)] p-1" role="radiogroup" aria-label="Agent type">
      <button type="button" role="radio" aria-checked={value === 'overlay'} onClick={() => onChange('overlay')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${value === 'overlay' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Bot size={16} /> Overlay agent</button>
      <button type="button" role="radio" aria-checked={value === 'byo'} onClick={() => onChange('byo')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${value === 'byo' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Server size={16} /> Bring your own agent</button>
    </div>
  )
}

function AgentAvatar({ color, onChange }: { color: string; onChange(color: string): void }) {
  return (
    <div>
      <div className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--border)] text-white shadow-sm" style={{ backgroundColor: color }}><Bot size={38} strokeWidth={1.5} /></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {AVATAR_COLORS.map((avatarColor) => <button key={avatarColor} type="button" aria-label={`Use ${avatarColor}`} onClick={() => onChange(avatarColor)} className="flex h-7 items-center justify-center rounded-md border border-[var(--border)]" style={{ backgroundColor: avatarColor }}>{color === avatarColor ? <Check size={12} className="text-white" /> : null}</button>)}
      </div>
    </div>
  )
}

function OverlayAgentFields({ instructions, onInstructionsChange, modelId, onModelChange, modelOptions, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange }: { instructions: string; onInstructionsChange(value: string): void; modelId: string; onModelChange(value: string): void; modelOptions: Array<{ value: string; label: string }>; enabledToolGroups: Set<string>; onToggleToolGroup(groupId: string): void; advanced: boolean; onAdvancedChange(value: boolean): void }) {
  return (
    <>
      <label className="block text-xs font-medium">Agent instructions<textarea value={instructions} onChange={(event) => onInstructionsChange(event.target.value)} placeholder="Describe what this agent should do, how it should respond, and when it should stop." className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--muted)]" /></label>
      <label className="block text-xs font-medium">Model<ListboxSelect className="mt-1.5" aria-label="Agent model" value={modelOptions.some((option) => option.value === modelId) ? modelId : (modelOptions[0]?.value ?? modelId)} options={modelOptions.length > 0 ? modelOptions : [{ value: modelId, label: modelId }]} onChange={onModelChange} portal buttonClassName="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]" /></label>
      <div>
        <p className="text-xs font-medium">Tools</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Grant this agent the same tools the personal chat can use. It only acts on what you enable here.</p>
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          {AGENT_TOOL_GROUPS.map((group) => {
            const active = enabledToolGroups.has(group.id)
            return <button key={group.id} type="button" role="switch" aria-checked={active} onClick={() => onToggleToolGroup(group.id)} className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${active ? 'border-[var(--muted)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-[var(--muted)] bg-[var(--muted)] text-[var(--background)]' : 'border-[var(--border)]'}`}>{active ? <Check size={11} /> : null}</span><span className="min-w-0"><span className="block text-xs font-medium text-[var(--foreground)]">{group.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{group.description}</span></span></button>
          })}
        </div>
      </div>
      <button type="button" onClick={() => onAdvancedChange(!advanced)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">Advanced <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} /></button>
      {advanced ? <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] leading-4 text-[var(--muted)]">Mention-first is enforced. One-to-one agent DMs invoke implicitly; channels and group DMs require a human mention or reply in the agent’s thread.</div> : null}
    </>
  )
}

function ByoAgentFields({ adapterId, harnessOptions, onHarnessChange, choice, onChoiceChange, compatibleEnvironments, environmentsLoading, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange, selectedHarnessConnectable, environmentBusy, environmentError, command, copied, onCopyCommand, onBeginConnection, setupEnvironment, setupRoots, onSetupRootsChange, onApproveSetup }: { adapterId: string; harnessOptions: Array<{ id: string; label: string; description: string; connectable: boolean }>; onHarnessChange(value: string): void; choice: EnvironmentChoice; onChoiceChange(value: EnvironmentChoice): void; compatibleEnvironments: AgentEnvironmentResource[]; environmentsLoading: boolean; environmentId: string; onEnvironmentChange(value: string): void; workingDirectory: string; onWorkingDirectoryChange(value: string): void; selectedHarnessConnectable: boolean; environmentBusy: string | null; environmentError: string | null; command: string; copied: boolean; onCopyCommand(): void; onBeginConnection(): void; setupEnvironment?: AgentEnvironmentResource; setupRoots: string; onSetupRootsChange(value: string): void; onApproveSetup(): void }) {
  const [setupMode, setSetupMode] = useState<'paste' | 'manual'>('paste')
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [prevCommand, setPrevCommand] = useState(command)
  const setupPrompt = useMemo(() => (command ? generatedAgentSetupPrompt(command) : ''), [command])
  if (prevCommand !== command) {
    setPrevCommand(command)
    setSetupMode('paste')
    setCopiedPrompt(false)
    setCopyError(null)
  }
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(setupPrompt)
      setCopiedPrompt(true)
      window.setTimeout(() => setCopiedPrompt(false), 1_500)
    } catch {
      setCopyError('Could not copy the prompt. Select it and copy it manually.')
    }
  }
  return (
    <div className="space-y-5">
      <section>
        <p className="text-xs font-medium">Harness</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Choose the coding agent Overlay will invoke.</p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">{harnessOptions.map((harness) => <button key={harness.id} type="button" onClick={() => onHarnessChange(harness.id)} className={`rounded-xl border p-3 text-left transition-colors ${adapterId === harness.id ? 'border-[var(--muted)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}><span className="block text-xs font-medium text-[var(--foreground)]">{harness.label}</span><span className="mt-1 block text-[11px] leading-4 text-[var(--muted)]">{harness.description}</span></button>)}</div>
      </section>
      <section>
        <p className="text-xs font-medium">Where it runs</p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Agent environment">
          <EnvironmentChoiceButton active={choice === 'existing'} icon={<Server size={15} />} label="Existing" onClick={() => onChoiceChange('existing')} />
          <EnvironmentChoiceButton active={choice === 'connect'} icon={<Laptop size={15} />} label="My machine" disabled={!selectedHarnessConnectable} onClick={() => onChoiceChange('connect')} />
        </div>
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          {choice === 'existing' ? environmentsLoading ? <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Loader2 size={14} className="animate-spin" /> Loading environments…</p> : compatibleEnvironments.length > 0 ? <div className="space-y-3"><label className="block text-xs font-medium">Environment<ListboxSelect className="mt-1.5" aria-label="Connected environment" value={environmentId} options={compatibleEnvironments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.status}` }))} onChange={onEnvironmentChange} portal /></label><label className="block text-xs font-medium">Default working directory<Input className="mt-1.5" value={workingDirectory} onChange={(event) => onWorkingDirectoryChange(event.target.value)} placeholder="/Users/you/Projects/app" /></label><p className="text-[11px] leading-4 text-[var(--muted)]">This must be inside the environment’s approved roots. The environment may host other agents too.</p></div> : <div className="text-xs text-[var(--muted)]"><p>No connected environment currently advertises this harness.</p>{selectedHarnessConnectable ? <p className="mt-1">Connect a computer, VPS, or sandbox to continue.</p> : null}</div> : null}
          {choice === 'connect' ? <div className="space-y-3"><div><p className="text-xs font-medium text-[var(--foreground)]">Connect any computer, VPS, or sandbox</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Outbound-only. No inbound port is opened.</p></div>{!command ? <Button variant="secondary" size="sm" disabled={environmentBusy !== null} onClick={onBeginConnection}>{environmentBusy === 'connect' ? 'Creating…' : 'Create connection'}</Button> : <div className="space-y-2.5"><div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-subtle)] p-1" role="radiogroup" aria-label="Setup mode"><button type="button" role="radio" aria-checked={setupMode === 'paste'} onClick={() => setSetupMode('paste')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'paste' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Sparkles size={12} /> Automatic setup</button><button type="button" role="radio" aria-checked={setupMode === 'manual'} onClick={() => setSetupMode('manual')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'manual' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Terminal size={12} /> Manual setup</button></div>{setupMode === 'paste' ? <div className="space-y-2"><p className="text-[11px] leading-4 text-[var(--muted)]">Paste this into a chat with the agent on this machine — it runs the connection command for you and keeps it alive.</p><div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5"><pre className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words px-0.5 font-mono text-[11px] leading-4 text-[var(--foreground)]">{setupPrompt}</pre></div><Button variant="secondary" size="sm" onClick={copyPrompt} className="gap-1.5">{copiedPrompt ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy prompt</>}</Button></div> : <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2"><code className="min-w-0 flex-1 overflow-x-auto px-1 text-[11px] text-[var(--foreground)]">{command}</code><button type="button" aria-label="Copy connection command" onClick={onCopyCommand} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>}</div>}{command && !setupEnvironment ? <p className="flex items-center gap-2 text-[11px] text-[var(--muted)]"><Loader2 size={13} className="animate-spin" /> Waiting for the host to connect…</p> : null}</div> : null}
          {setupEnvironment ? <EnvironmentApprovalPanel environment={setupEnvironment} roots={setupRoots} busy={environmentBusy === 'approve'} onRootsChange={onSetupRootsChange} onApprove={onApproveSetup} /> : null}
        </div>
      </section>
      {(environmentError || copyError) ? <p role="alert" className="text-xs text-red-500">{environmentError ?? copyError}</p> : null}
    </div>
  )
}

function EnvironmentChoiceButton({ active, icon, label, disabled = false, onClick }: { active: boolean; icon: ReactNode; label: string; disabled?: boolean; onClick(): void }) {
  return <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-[var(--muted)] bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'}`}>{icon}{label}</button>
}

function EnvironmentApprovalPanel({ environment, roots, busy, onRootsChange, onApprove }: { environment: AgentEnvironmentResource; roots: string; busy: boolean; onRootsChange(value: string): void; onApprove(): void }) {
  return <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4"><div className="flex items-center gap-2 text-xs text-[var(--foreground)]"><ShieldCheck size={15} className="text-[var(--muted)]" /> Verify phrase: <strong>{environment.verificationPhrase ?? 'waiting…'}</strong></div><label className="block text-xs font-medium">Approved project roots<textarea value={roots} onChange={(event) => onRootsChange(event.target.value)} placeholder={environment.kind === 'overlay_cloud' ? '/workspace' : '/Users/you/Projects'} className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]" /></label><p className="text-[11px] leading-4 text-[var(--muted)]">Overlay can dispatch work only inside these explicit roots. You can change or revoke access later.</p><Button variant="secondary" size="sm" disabled={busy || !environment.verificationPhrase} onClick={onApprove}>{busy ? 'Approving…' : 'Approve and continue'}</Button></div>
}

function parseRoots(value: string) {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}
