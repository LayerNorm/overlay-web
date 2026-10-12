'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type {
  ComputerSize,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { Button, DialogFrame, Input, ListboxSelect, SegmentedControl, Textarea, Toggle } from '@overlay/ui/primitives'
import { getEnabledChatModels, getGatewayCatalogRevision } from '@/shared/ai/gateway/model-data'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  AGENT_TOOL_GROUPS,
  AGENT_TOOL_PRESETS,
  agentToolPresetFor,
  type AgentToolPreset,
} from '@/shared/agents/tool-groups'
import { rememberAgentOpened } from '@/shared/agents/last-agent-by-workspace'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { buildWorkspaceAgentInput } from '../lib/agent-editor-input'
import { AgentAvatarPicker } from './AgentAvatarPicker'
import { FieldLabel } from './InfoTip'
import { CloudAgentProgress } from './CloudAgentProgress'
import { OtherAgentFields } from './OtherAgentFields'
import { initialOtherAgentDraft, isOtherAgentDraftValid, type OtherAgentDraft } from './cloud-agent-draft'
import { useCloudAgentCreate } from './use-cloud-agent-create'
import { useIsFreePlan } from './use-paid-plan'

export type NewAgentDraft = {
  kind: 'overlay' | 'other'
  other: OtherAgentDraft
  name: string
  instructions: string
  avatarShape: WorkspaceAgentCreatureShape
  avatarColor: string
  computer: boolean
  computerSize: ComputerSize
  visibility: WorkspaceAgentVisibility
  modelId: string
  toolGroups: ReadonlySet<string>
}

export function initialNewAgentDraft(): NewAgentDraft {
  return {
    kind: 'overlay',
    other: initialOtherAgentDraft(),
    name: '',
    instructions: '',
    avatarShape: 'hexagon',
    avatarColor: '#14b8a6',
    computer: false,
    computerSize: 'default',
    visibility: 'creator',
    modelId: DEFAULT_MODEL_ID,
    toolGroups: new Set(AGENT_TOOL_PRESETS.everything),
  }
}

/** Overlay agents need a name and instructions; nothing else is required. */
export function isNewAgentDraftValid(draft: NewAgentDraft): boolean {
  if (draft.kind === 'other') return isOtherAgentDraftValid(draft.name, draft.other)
  return Boolean(draft.name.trim() && draft.instructions.trim() && draft.modelId.trim())
}

const COMPUTER_SIZE_OPTIONS = [
  { value: 'small', label: 'Small · 2 vCPU, 4 GB' },
  { value: 'default', label: 'Default · 4 vCPU, 8 GB' },
  { value: 'large', label: 'Large · 8 vCPU, 16 GB' },
] as const

const TYPE_OPTIONS = [
  { value: 'overlay', label: 'Overlay agent' },
  { value: 'other', label: 'Other agent' },
] as const

const ACCESS_OPTIONS = [
  { value: 'creator', label: 'Only me' },
  { value: 'workspace', label: 'Everyone in this workspace' },
] as const

const PRESET_OPTIONS = [
  { value: 'everything', label: 'Everything' },
  { value: 'standard', label: 'Standard' },
  { value: 'readonly', label: 'Read only' },
] as const

const PRESET_SUMMARY: Record<AgentToolPreset, string> = {
  everything: 'All tools',
  standard: 'Standard tools',
  readonly: 'Read-only tools',
}

type ModelOption = { value: string; label: string }

/** The draft's model when it is offered, else the first enabled model (e.g. free tier without the paid default). */
export function resolveDraftModelId(modelId: string, options: readonly ModelOption[]): string {
  return options.some((option) => option.value === modelId) ? modelId : (options[0]?.value ?? modelId)
}

function AdvancedSection({ draft, onChange, modelOptions }: {
  draft: NewAgentDraft
  onChange(patch: Partial<NewAgentDraft>): void
  modelOptions: ModelOption[]
}) {
  const [open, setOpen] = useState(false)
  const preset = agentToolPresetFor(draft.toolGroups)
  const modelLabel = modelOptions.find((option) => option.value === draft.modelId)?.label ?? draft.modelId
  const toolsLabel = preset ? PRESET_SUMMARY[preset] : `${[...draft.toolGroups].length} tools`
  const toggleGroup = (id: string) => {
    const next = new Set(draft.toolGroups)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ toolGroups: next })
  }
  return (
    <div className="rounded-xl border border-[var(--border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-muted)]"
      >
        <span className="text-xs font-medium">Advanced</span>
        <span className={`min-w-0 flex-1 truncate text-right text-[11px] text-[var(--muted)] ${open ? 'invisible' : ''}`}>
          {modelLabel} · {toolsLabel}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-4 px-3 pb-3 pt-0.5">
          <div>
            <FieldLabel>Model</FieldLabel>
            <ListboxSelect
              aria-label="Agent model"
              value={draft.modelId}
              options={modelOptions.length > 0 ? modelOptions : [{ value: draft.modelId, label: draft.modelId }]}
              onChange={(modelId) => onChange({ modelId })}
              portal
            />
          </div>
          <div>
            <FieldLabel>Tools</FieldLabel>
            <SegmentedControl
              ariaLabel="Tool preset"
              layout="stretch"
              value={preset ?? ('custom' as AgentToolPreset)}
              options={PRESET_OPTIONS}
              onChange={(value) => onChange({ toolGroups: new Set(AGENT_TOOL_PRESETS[value]) })}
            />
            <div className="mt-1.5">
              {AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer').map((group) => (
                <div key={group.id} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 text-xs" title={group.description}>{group.label}</span>
                  <Toggle
                    checked={draft.toolGroups.has(group.id)}
                    onCheckedChange={() => toggleGroup(group.id)}
                    aria-label={group.label}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ComputerSection({ draft, onChange }: {
  draft: NewAgentDraft
  onChange(patch: Partial<NewAgentDraft>): void
}) {
  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 [&>div]:mb-0">
          <FieldLabel info="A machine of its own with a desktop. Created when you save; billed while it runs.">Computer</FieldLabel>
        </div>
        <Toggle checked={draft.computer} onCheckedChange={(computer) => onChange({ computer })} aria-label="Computer" />
      </div>
      {draft.computer ? (
        <div className="px-3 pb-3">
          <ListboxSelect
            aria-label="Computer size"
            value={draft.computerSize}
            options={[...COMPUTER_SIZE_OPTIONS]}
            onChange={(computerSize) => onChange({ computerSize: computerSize as ComputerSize })}
            portal
          />
        </div>
      ) : null}
    </div>
  )
}

/** The dialog's fields. Presentational: all state lives in `draft`. */
export function NewAgentFields({ draft, onChange, modelOptions, computersAvailable, otherAgentsAvailable = false, otherAgentsNote = 'Coming soon', onOpenMachineSetup }: {
  draft: NewAgentDraft
  onChange(patch: Partial<NewAgentDraft>): void
  modelOptions: ModelOption[]
  computersAvailable: boolean
  /** Overlay Cloud agents are offered only where the deployment supports them. */
  otherAgentsAvailable?: boolean
  /** Why Other agent is unavailable ("Coming soon", or "Paid plans" on a free plan). */
  otherAgentsNote?: string
  onOpenMachineSetup?(): void
}) {
  const other = draft.kind === 'other'
  const patchOther = useCallback((patch: Partial<OtherAgentDraft>) => onChange({ other: { ...draft.other, ...patch } }), [draft.other, onChange])
  return (
    <div className="space-y-3.5">
      <AgentAvatarPicker
        shape={draft.avatarShape}
        color={draft.avatarColor}
        onShapeChange={(avatarShape) => onChange({ avatarShape })}
        onColorChange={(avatarColor) => onChange({ avatarColor })}
      />
      <div>
        <FieldLabel htmlFor="new-agent-name">Name</FieldLabel>
        <Input
          id="new-agent-name"
          autoFocus
          autoComplete="off"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Research partner"
        />
      </div>
      <div>
        <FieldLabel htmlFor="new-agent-description" info="What it does, how it should respond, and when it should stop. This becomes the agent's instructions.">
          Description
        </FieldLabel>
        <Textarea
          id="new-agent-description"
          value={draft.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="Finds evidence and challenges assumptions."
          className="min-h-20 !resize-none"
        />
      </div>
      <div>
        <FieldLabel info="Overlay agents are built into Overlay. Other agents (Claude Code, Codex) bring their own tools and run on a machine.">Type</FieldLabel>
        <SegmentedControl
          ariaLabel="Agent type"
          layout="stretch"
          value={draft.kind}
          options={otherAgentsAvailable ? TYPE_OPTIONS : TYPE_OPTIONS.map((option) => (option.value === 'other' ? { ...option, description: otherAgentsNote, disabled: true } : option))}
          onChange={(kind) => onChange({ kind })}
        />
      </div>
      {other ? (
        <OtherAgentFields
          other={draft.other}
          size={draft.computerSize}
          onChange={patchOther}
          onSizeChange={(computerSize) => onChange({ computerSize })}
          onOpenMachineSetup={() => onOpenMachineSetup?.()}
          active
        />
      ) : null}
      {!other && computersAvailable ? <ComputerSection draft={draft} onChange={onChange} /> : null}
      <div>
        <FieldLabel info="Who can see, chat with, or @-mention this agent.">Access</FieldLabel>
        <SegmentedControl
          ariaLabel="Access"
          layout="stretch"
          value={draft.visibility}
          options={ACCESS_OPTIONS}
          onChange={(visibility) => onChange({ visibility })}
        />
      </div>
      {other ? null : <AdvancedSection draft={draft} onChange={onChange} modelOptions={modelOptions} />}
    </div>
  )
}

function useModelOptions(): ModelOption[] {
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const { settings } = useAppSettings()
  const enabledModelIds = settings.enabledChatModelIds
  return useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])
}

/** Creates the agent (and its computer when asked for), then refreshes the roster. */
async function createAgentFromDraft(workspaceId: string, draft: NewAgentDraft, computersAvailable: boolean) {
  const toolGroups = new Set(draft.toolGroups)
  const withComputer = computersAvailable && draft.computer
  if (withComputer) toolGroups.add('computer')
  const created = await overlayAppClient.agents.create(workspaceId, {
    ...buildWorkspaceAgentInput({
      name: draft.name,
      description: '',
      instructions: draft.instructions,
      agentType: 'overlay',
      harnessLabel: '',
      adapterId: '',
      modelId: draft.modelId,
      avatarColor: draft.avatarColor,
      avatarShape: draft.avatarShape,
      enabledToolGroups: toolGroups,
      visibility: draft.visibility,
    }),
    teamIds: [],
  })
  let computerError: string | null = null
  if (withComputer) {
    await overlayAppClient.computers.provision(workspaceId, {
      ownerType: 'agent',
      ownerId: created.agent.id,
      size: draft.computerSize,
      name: `${created.agent.name} computer`,
    }).catch((error: unknown) => {
      // The agent is durable either way; report and let the editor retry.
      computerError = error instanceof Error ? error.message : 'Could not create the computer.'
    })
  }
  dispatchAgentDirectoryChanged(workspaceId)
  rememberAgentOpened(workspaceId, created.agent.id)
  return { agent: created.agent, computerError }
}

/** New-agent dialog: an Overlay agent, or an agent (Claude Code, Codex) on Overlay Cloud. */
export function NewAgentDialog({ open, workspaceId, onClose, onCreated, onOpenMachineSetup }: {
  open: boolean
  workspaceId: string | null
  onClose(): void
  onCreated(agent: WorkspaceAgentDirectoryItem, warning: string | null): void
  /** Opens the full agent editor, where "Your machine" agents are connected. */
  onOpenMachineSetup?(): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const computersAvailable = capabilities.computers === true
  const freePlan = useIsFreePlan(open && capabilities.cloudAgents === true && capabilities.billing === true, workspaceId)
  const otherAgentsAvailable = capabilities.cloudAgents === true && !freePlan
  const otherAgentsNote = freePlan ? 'Paid plans' : 'Coming soon'
  const modelOptions = useModelOptions()
  const [rawDraft, setDraft] = useState(initialNewAgentDraft)
  const draft = { ...rawDraft, modelId: resolveDraftModelId(rawDraft.modelId, modelOptions) }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = useCallback((patch: Partial<NewAgentDraft>) => setDraft((current) => ({ ...current, ...patch })), [])
  const cloud = useCloudAgentCreate({
    workspaceId,
    onReady: (agent) => { setDraft(initialNewAgentDraft()); cloud.reset(); onCreated(agent, null) },
  })
  const working = busy || cloud.busy

  const close = () => {
    if (working) return
    // Closing while a machine starts keeps the agent; its page shows the same progress.
    if (cloud.view) {
      const agent = cloud.view.agent
      cloud.reset()
      setDraft(initialNewAgentDraft())
      onCreated(agent, null)
      return
    }
    setDraft(initialNewAgentDraft())
    setError(null)
    onClose()
  }

  const submit = async () => {
    if (!workspaceId || working || !isNewAgentDraftValid(draft)) return
    if (draft.kind === 'other') {
      await cloud.create({
        name: draft.name,
        description: draft.instructions,
        avatarShape: draft.avatarShape,
        avatarColor: draft.avatarColor,
        visibility: draft.visibility,
      }, draft.other, draft.computerSize)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { agent, computerError } = await createAgentFromDraft(workspaceId, draft, computersAvailable)
      setDraft(initialNewAgentDraft())
      onCreated(agent, computerError)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the agent.')
    } finally {
      setBusy(false)
    }
  }

  const shownError = error ?? cloud.error
  const failed = cloud.view?.phase === 'failed'

  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title={cloud.view ? `Starting ${cloud.view.agent.name}` : 'New agent'}
      aria-label="New agent"
      className="flex max-h-[min(860px,calc(100vh-32px))] !w-[min(440px,94vw)] flex-col !rounded-[20px] !p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-4"
      actions={(
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
        {cloud.view ? (
          <>
            <CloudAgentProgress phase={cloud.view.phase} />
            {failed ? <p role="alert" className="mt-2 text-xs text-red-500">{cloud.view.error}</p> : (
              <p className="mt-2 text-xs text-[var(--muted)]">This takes about a minute. You can close this; the agent keeps starting.</p>
            )}
          </>
        ) : (
          <NewAgentFields
            draft={draft}
            onChange={update}
            modelOptions={modelOptions}
            computersAvailable={computersAvailable}
            otherAgentsAvailable={otherAgentsAvailable}
            otherAgentsNote={otherAgentsNote}
            {...(onOpenMachineSetup ? { onOpenMachineSetup } : {})}
          />
        )}
        {shownError && !failed ? <p role="alert" className="mt-3 text-xs text-red-500">{shownError}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
        {cloud.view ? (
          <>
            <Button variant="secondary" size="sm" onClick={close}>{failed ? 'Close' : 'Continue in background'}</Button>
            {failed ? <Button variant="primary" size="sm" onClick={() => void cloud.retry(draft.other, draft.computerSize)}>Try again</Button> : null}
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={working}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={working || !isNewAgentDraftValid(draft)}>
              {working ? 'Creating…' : 'Create agent'}
            </Button>
          </>
        )}
      </div>
    </DialogFrame>
  )
}
