'use client'

import { unstyledButton } from '@overlay/ui/control-reset'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type {
  ComputerSize,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentReasoningLevel,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { Button, DialogFrame, Input, ListboxSelect, SegmentedControl, Textarea, Toggle, toast } from '@overlay/ui/primitives'
import { ChatModelPicker } from '@overlay/chat-react'
import { MODEL_RECOMMENDATIONS, getModelsByIntelligence, getGatewayCatalogRevision } from '@/shared/ai/gateway/model-data'
import { NEW_AGENT_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import {
  AGENT_TOOL_GROUPS,
  AGENT_TOOL_PRESETS,
  agentToolPresetFor,
  type AgentToolPreset,
} from '@/shared/agents/tool-groups'
import { rememberAgentOpened } from '@/shared/agents/last-agent-by-workspace'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useWorkspaceTextModelAccess } from '@/components/providers/useWorkspaceTextModelAccess'
import { useAuth } from '@/contexts/AuthContext'
import type { AgentModelFieldProps } from './AgentEditorForm'
import { buildWorkspaceAgentInput, workspaceAgentReasoningForSave } from '../lib/agent-editor-input'
import { AgentAvatarPicker } from './AgentAvatarPicker'
import { FieldLabel } from './InfoTip'

export type NewAgentDraft = {
  name: string
  instructions: string
  avatarShape: WorkspaceAgentCreatureShape
  avatarColor: string
  computer: boolean
  computerSize: ComputerSize
  visibility: WorkspaceAgentVisibility
  modelId: string
  reasoningByModel: Readonly<Record<string, WorkspaceAgentReasoningLevel | undefined>>
  toolGroups: ReadonlySet<string>
}

export function initialNewAgentDraft(): NewAgentDraft {
  return {
    name: '',
    instructions: '',
    avatarShape: 'hexagon',
    avatarColor: '#14b8a6',
    computer: true,
    computerSize: 'default',
    visibility: 'creator',
    modelId: NEW_AGENT_DEFAULT_MODEL_ID,
    reasoningByModel: {},
    toolGroups: new Set(AGENT_TOOL_PRESETS.everything),
  }
}

/** Overlay agents need a name and instructions; nothing else is required. */
export function isNewAgentDraftValid(draft: NewAgentDraft): boolean {
  return Boolean(draft.name.trim() && draft.instructions.trim() && draft.modelId.trim())
}

const COMPUTER_SIZE_OPTIONS = [
  { value: 'small', label: 'Small · 2 vCPU, 4 GB' },
  { value: 'default', label: 'Default · 4 vCPU, 8 GB' },
  { value: 'large', label: 'Large · 8 vCPU, 16 GB' },
] as const

const TYPE_OPTIONS = [
  { value: 'overlay', label: 'Overlay agent' },
  { value: 'other', label: 'Connect your agent' },
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

/** Keep BYOK drafts unchanged; otherwise use the draft when offered or the first enabled model. */
export function resolveDraftModelId(modelId: string, modelIds: readonly string[]): string {
  if (isByokModelId(modelId)) return modelId
  return modelIds.includes(modelId) ? modelId : (modelIds[0] ?? modelId)
}

function AdvancedSection({ draft, onChange, modelField }: {
  draft: NewAgentDraft
  onChange(patch: Partial<NewAgentDraft>): void
  modelField: AgentModelFieldProps
}) {
  const [open, setOpen] = useState(false)
  const preset = agentToolPresetFor(draft.toolGroups)
  const modelLabel = modelField.modelPickerLabel
  const toolsLabel = preset ? PRESET_SUMMARY[preset] : `${[...draft.toolGroups].length} tools`
  const toggleGroup = (id: string) => {
    const next = new Set(draft.toolGroups)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ toolGroups: next })
  }
  return (
    <div className="rounded-xl border border-(--border)">
      <Button variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={unstyledButton(`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-(--surface-muted)`)}
      >
        <span className="text-xs font-medium">Advanced</span>
        <span className={`min-w-0 flex-1 truncate text-right text-[11px] text-(--muted) ${open ? 'invisible' : ''}`}>
          {modelLabel} · {toolsLabel}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-(--muted) transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div className="space-y-4 px-3 pb-3 pt-0.5">
          <div>
            <FieldLabel>Model</FieldLabel>
            <ChatModelPicker
              placement='field'
              modelPickerLabel={modelField.modelPickerLabel}
              selectableTextModels={modelField.selectableTextModels}
              selectedActModel={draft.modelId}
              onToggleTextModel={(modelId) => onChange({ modelId })}
              reasoning={draft.reasoningByModel[draft.modelId]}
              onReasoningChange={(level) => onChange({
                reasoningByModel: { ...draft.reasoningByModel, [draft.modelId]: level ?? 'provider-default' },
              })}
              reasoningByModel={draft.reasoningByModel}
              onModelReasoningChange={(modelId, level) => onChange({
                reasoningByModel: { ...draft.reasoningByModel, [modelId]: level ?? 'provider-default' },
              })}
              favoriteScope={modelField.favoriteScope}
              modelRecommendations={MODEL_RECOMMENDATIONS}
              textModelsLoading={modelField.textModelsLoading}
              generationMode='text'
              lockedGenerationMode='text'
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
    <div className="rounded-xl border border-(--border)">
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
export function NewAgentFields({ draft, onChange, modelField, computersAvailable, onOpenMachineSetup }: {
  draft: NewAgentDraft
  onChange(patch: Partial<NewAgentDraft>): void
  modelField: AgentModelFieldProps
  computersAvailable: boolean
  onOpenMachineSetup?(): void
}) {
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
          className="min-h-20 resize-none!"
        />
      </div>
      {onOpenMachineSetup ? <div>
        <FieldLabel info="Overlay agents are built into Overlay. Connect a user-owned Agent Host to use an external agent.">Type</FieldLabel>
        <SegmentedControl
          ariaLabel="Agent type"
          layout="stretch"
          value="overlay"
          options={TYPE_OPTIONS}
          onChange={(kind) => { if (kind === 'other') onOpenMachineSetup() }}
        />
      </div> : null}
      {computersAvailable ? <ComputerSection draft={draft} onChange={onChange} /> : null}
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
      <AdvancedSection draft={draft} onChange={onChange} modelField={modelField} />
    </div>
  )
}

/** Same model access as the agent editor, so the dialog offers exactly the models the agent can run. */
function useNewAgentModelField(workspaceId: string | null, draftModelId: string): { modelField: AgentModelFieldProps; modelId: string } {
  const { capabilities } = useOverlayCapabilities()
  const { settings } = useAppSettings()
  const { user: authUser } = useAuth()
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const modelAccess = useWorkspaceTextModelAccess({
    activeWorkspaceId: workspaceId,
    billingEnabled: capabilities.billing === true,
    catalogRevision: revision,
    onlyAllowZdrModels: settings.onlyAllowZdrModels,
  })
  const { loadSubscription } = modelAccess
  useEffect(() => {
    void loadSubscription()
  }, [loadSubscription])
  const allTextModels = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getModelsByIntelligence()
  }, [revision])
  const selectableTextModels = modelAccess.pickerTextModels
  const modelId = resolveDraftModelId(draftModelId, selectableTextModels.map((model) => model.id))
  const modelField = {
    favoriteScope: authUser?.id ?? null,
    modelPickerLabel: selectableTextModels.find((model) => model.id === modelId)?.name ?? allTextModels.find((model) => model.id === modelId)?.name ?? modelId,
    selectableTextModels,
    textModelsLoading: modelAccess.connectionsLoading,
  }
  return { modelField, modelId }
}

/** Creates the agent (and its computer when asked for), then refreshes the roster. */
async function createAgentFromDraft(
  workspaceId: string,
  draft: NewAgentDraft,
  computersAvailable: boolean,
  reasoningModels: AgentModelFieldProps['selectableTextModels'],
) {
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
      reasoning: workspaceAgentReasoningForSave({
        modelId: draft.modelId,
        reasoning: draft.reasoningByModel[draft.modelId],
        reasoningModels,
      }),
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
  rememberAgentOpened(workspaceId, created.agent.id)
  return { agent: created.agent, computerError }
}

/** New-agent dialog for native Overlay agents, with a direct path to BYOM setup. */
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
  const [rawDraft, setDraft] = useState(initialNewAgentDraft)
  const { modelField, modelId } = useNewAgentModelField(workspaceId, rawDraft.modelId)
  const draft = { ...rawDraft, modelId }
  const [busy, setBusy] = useState(false)
  const update = useCallback((patch: Partial<NewAgentDraft>) => setDraft((current) => ({ ...current, ...patch })), [])
  const working = busy

  const close = () => {
    if (working) return
    setDraft(initialNewAgentDraft())
    onClose()
  }

  const submit = async () => {
    if (!workspaceId || working || !isNewAgentDraftValid(draft)) return
    setBusy(true)
    try {
      const { agent, computerError } = await createAgentFromDraft(
        workspaceId,
        draft,
        computersAvailable,
        modelField.selectableTextModels,
      )
      setDraft(initialNewAgentDraft())
      toast.success('Agent created.')
      onCreated(agent, computerError)
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : 'Could not create the agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => { if (!next) close() }}
      title="New agent"
      aria-label="New agent"
      className="flex max-h-[min(860px,calc(100vh-32px))] w-[min(440px,94vw)]! flex-col rounded-[20px]! p-0! [&>div:first-child]:px-5 [&>div:first-child]:pt-4"
      actions={(
        <Button variant="ghost"
          type="button"
          aria-label="Close"
          onClick={close}
          className={unstyledButton(`flex h-7 w-7 items-center justify-center rounded-lg text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        >
          <X size={16} strokeWidth={1.75} />
        </Button>
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
        <NewAgentFields
          draft={draft}
          onChange={update}
          modelField={modelField}
          computersAvailable={computersAvailable}
          {...(capabilities.connectedAgents === true && onOpenMachineSetup ? { onOpenMachineSetup } : {})}
        />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-(--border) px-5 py-3">
        <Button variant="secondary" size="sm" onClick={close} disabled={working}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={working || !isNewAgentDraftValid(draft)}>
          {working ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </DialogFrame>
  )
}
