'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ChevronDown, Laptop } from 'lucide-react'
import { Button, DialogFrame, Input, ListboxSelect } from '@overlay/ui/primitives'
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

const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']

export function AgentEditorDialog({
  open,
  agent,
  busy,
  error,
  onOpenChange,
  onSave,
  onArchive,
}: {
  open: boolean
  agent?: WorkspaceAgentDirectoryItem | null
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
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(
    // A brand new agent starts with the read-and-remember groups checked; an
    // existing one shows exactly what it was granted, including nothing.
    () => (agent
      ? enabledAgentToolGroupIds(agent.allowedToolIds)
      : new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)),
  )
  const [advanced, setAdvanced] = useState(false)
  const [execution, setExecution] = useState<'overlay' | 'connected'>('overlay')
  const [environments, setEnvironments] = useState<Array<{
    id: string
    name: string
    status: string
    capabilities: Record<string, unknown>
    filesystemGrant?: { mode: 'selected_roots'; roots: string[] } | { mode: 'all_user_files' }
  }>>([])
  const [environmentId, setEnvironmentId] = useState('')
  const [adapterId, setAdapterId] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState('')

  useEffect(() => {
    if (!open || !activeWorkspaceId) return
    void Promise.all([
      overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' }),
      agent ? overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId, agent.id) : Promise.resolve({ bindings: [] }),
    ]).then(([environmentResult, bindingResult]) => {
      const available = environmentResult.environments.filter((environment) => (
        environment.status !== 'pending' && environment.status !== 'revoked'
      ))
      setEnvironments(available)
      const binding = bindingResult.bindings[0]
      if (!binding) return
      setExecution('connected')
      setEnvironmentId(binding.environmentId)
      setAdapterId(typeof binding.adapterConfig.adapterId === 'string' ? binding.adapterConfig.adapterId : '')
      setWorkingDirectory(typeof binding.adapterConfig.workingDirectory === 'string' ? binding.adapterConfig.workingDirectory : '')
      setAdvanced(true)
    }).catch(() => undefined)
  }, [activeWorkspaceId, agent, open])

  const selectedEnvironment = environments.find((environment) => environment.id === environmentId)
  const adapterOptions = Array.isArray(selectedEnvironment?.capabilities.adapters)
    ? (selectedEnvironment.capabilities.adapters as Array<Record<string, unknown>>)
        .filter((adapter) => adapter.protocol === 'acp' && typeof adapter.id === 'string')
        .map((adapter) => ({ value: String(adapter.id), label: typeof adapter.displayName === 'string' ? adapter.displayName : String(adapter.id) }))
    : []

  const toggleToolGroup = (groupId: string) => {
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Same catalog the personal chat model picker offers: every model the
  // workspace has enabled in settings, not just the curated defaults.
  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

  const isDefaultMaster = Boolean(agent?.isDefault || agent?.name.toLowerCase() === 'overlay')
  const bindingValid = execution === 'overlay' || (environmentId && adapterId && workingDirectory.trim())
  const valid = name.trim() && instructions.trim() && modelId.trim() && bindingValid
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      className="max-h-[92vh] !w-[min(760px,94vw)] overflow-y-auto"
      title={agent ? `Edit ${agent.name}` : 'Create agent'}
      description={isDefaultMaster ? 'Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).' : 'Give this workspace a named teammate with a clear job and its own identity.'}
      footer={(
        <>
          {agent && onArchive && !isDefaultMaster ? <Button variant="danger" onClick={onArchive} disabled={busy}>Archive agent</Button> : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="secondary"
            disabled={busy || !valid}
            onClick={() => onSave({
              name: name.trim(),
              description: description.trim() || undefined,
              instructions: instructions.trim(),
              harness: 'overlay',
              modelId: modelId.trim(),
              avatarColor,
              allowedToolIds: toolIdsForEnabledGroups(enabledToolGroups),
              teamIds: agent?.teamIds ?? [],
            }, execution === 'connected' ? {
              environmentId,
              adapterId,
              workingDirectory: workingDirectory.trim(),
            } : environments.length > 0 ? null : undefined)}
          >
            {busy ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}
          </Button>
        </>
      )}
    >
      <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
        <div>
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--border)] text-white shadow-sm"
            style={{ backgroundColor: avatarColor }}
          >
            <Bot size={38} strokeWidth={1.5} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                onClick={() => setAvatarColor(color)}
                className="flex h-7 items-center justify-center rounded-md border border-[var(--border)]"
                style={{ backgroundColor: color }}
              >
                {avatarColor === color ? <Check size={12} className="text-white" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <label className="block text-xs font-medium">
            Agent name
            <Input autoFocus className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder="Research partner" />
          </label>
          <label className="block text-xs font-medium">
            Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
            <Input className="mt-1.5" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Finds evidence and challenges assumptions" />
          </label>
          <label className="block text-xs font-medium">
            Agent instructions
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Describe what this agent should do, how it should respond, and when it should stop."
              className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--muted)]"
            />
          </label>
          <label className="block text-xs font-medium">
            Model
            <ListboxSelect
              className="mt-1.5"
              aria-label="Agent model"
              value={modelOptions.some((option) => option.value === modelId) ? modelId : (modelOptions[0]?.value ?? modelId)}
              options={modelOptions.length > 0 ? modelOptions : [{ value: modelId, label: modelId }]}
              onChange={setModelId}
              portal
              buttonClassName="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </label>
          <div>
            <p className="text-xs font-medium">Tools</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
              Grant this agent the same tools the personal chat can use. It only acts on what you enable here.
            </p>
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {AGENT_TOOL_GROUPS.map((group) => {
                const active = enabledToolGroups.has(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => toggleToolGroup(group.id)}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? 'border-[var(--muted)] bg-[var(--surface-subtle)]'
                        : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        active ? 'border-[var(--muted)] bg-[var(--muted)] text-[var(--background)]' : 'border-[var(--border)]'
                      }`}
                    >
                      {active ? <Check size={11} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--foreground)]">{group.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{group.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <button type="button" onClick={() => setAdvanced((value) => !value)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            Advanced <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />
          </button>
          {advanced ? (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              <p className="text-[11px] leading-4 text-[var(--muted)]">
                Mention-first is enforced. One-to-one agent DMs invoke implicitly; channels and group DMs require a human mention or reply in the agent’s thread.
              </p>
              {environments.length > 0 ? (
                <div className="space-y-3 border-t border-[var(--border)] pt-3">
                  <label className="block text-xs font-medium">Execution
                    <ListboxSelect
                      className="mt-1.5"
                      aria-label="Agent execution"
                      value={execution}
                      options={[{ value: 'overlay', label: 'Overlay' }, { value: 'connected', label: 'Connected environment' }]}
                      onChange={(value) => setExecution(value as 'overlay' | 'connected')}
                      portal
                    />
                  </label>
                  {execution === 'connected' ? (
                    <>
                      <label className="block text-xs font-medium">Environment
                        <ListboxSelect
                          className="mt-1.5"
                          aria-label="Connected environment"
                          value={environmentId}
                          options={environments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.status}` }))}
                          onChange={(value) => {
                            setEnvironmentId(value)
                            const selected = environments.find((environment) => environment.id === value)
                            const firstAdapter = Array.isArray(selected?.capabilities.adapters)
                              ? (selected.capabilities.adapters as Array<Record<string, unknown>>).find((candidate) => candidate.protocol === 'acp') : undefined
                            setAdapterId(typeof firstAdapter?.id === 'string' ? firstAdapter.id : '')
                            const firstRoot = selected?.filesystemGrant?.mode === 'selected_roots' ? selected.filesystemGrant.roots[0] : ''
                            setWorkingDirectory(firstRoot ?? '')
                          }}
                          portal
                        />
                      </label>
                      <label className="block text-xs font-medium">Harness
                        <ListboxSelect className="mt-1.5" aria-label="ACP harness" value={adapterId} options={adapterOptions} onChange={setAdapterId} portal />
                      </label>
                      <label className="block text-xs font-medium">Working directory
                        <Input className="mt-1.5" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder="/Users/you/Projects/app" />
                      </label>
                      <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Laptop size={12} /> Work runs on this environment and streams back into the room.</p>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </div>
    </DialogFrame>
  )
}
