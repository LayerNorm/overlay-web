'use client'

import { unstyledButton, unstyledTextarea } from '@overlay/ui/control-reset'

import { Fragment, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, Loader2, Lock, Monitor, Trash2, Users } from 'lucide-react'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, ListboxSelect,
  SegmentedControl, Textarea, Toggle, toast,
} from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import type { Computer, ComputerSize, WorkspaceAgentCreatureShape, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { ChatModelPicker, type ChatModelPickerProps } from '@overlay/chat-react'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import { MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useMemories } from '@/hooks/use-memories'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { AgentAvatarPicker } from './AgentAvatarPicker'
import { AgentComputerRecoveryNotice } from './AgentComputerRecoveryNotice'
import { FieldLabel } from './InfoTip'
import { useEditorLoad } from './EditorLoadGate'

export type AgentModelFieldProps = Pick<
  ChatModelPickerProps,
  'favoriteScope' | 'selectableTextModels' | 'textModelsLoading' | 'reasoningByModel' | 'onModelReasoningChange'
> & {
  modelPickerLabel: string
}

/**
 * Single-column stacked option row (radio behavior). One control per row,
 * everywhere — never a side-by-side card grid.
 */
export function OptionRow({ checked, onSelect, label, description, icon, labelledBy, disabled }: {
  checked: boolean
  onSelect(): void
  label: string
  description?: string
  icon?: ReactNode
  labelledBy?: string
  disabled?: boolean
}) {
  return (
    <Button variant="ghost"
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={labelledBy ?? label}
      disabled={disabled}
      onClick={onSelect}
      className={unstyledButton(`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'border-(--muted) bg-(--surface-subtle)' : 'border-(--border) hover:bg-(--surface-subtle)'}`)}
    >
      <span
        className={`relative mt-0.5 h-4 w-4 shrink-0 rounded-full border ${checked ? 'border-(--foreground)' : 'border-(--muted-light)'}`}
      >
        {checked ? (
          <span className='absolute inset-[3px] rounded-full bg-(--foreground)' />
        ) : null}
      </span>
      {icon ? (
        <span className='mt-0.5 shrink-0 text-(--muted)'>{icon}</span>
      ) : null}
      <span className="min-w-0">
        <span className='block text-xs font-medium text-(--foreground)'>
          {label}
        </span>
        {description ? (
          <span className='mt-0.5 block text-[11px] leading-4 text-(--muted)'>
            {description}
          </span>
        ) : null}
      </span>
    </Button>
  )
}

/**
 * Settings-style toggle row: title + description on the left, Toggle on the
 * right. The only on/off control in the app — never a checkbox.
 */
export function ToggleRow({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange(next: boolean): void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-(--foreground)">{label}</p>
        {description ? (
          <p className='mt-0.5 text-[11px] leading-4 text-(--muted)'>
            {description}
          </p>
        ) : null}
      </div>
      <Toggle checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}

interface AgentMemoryRow {
  memoryId: string
  content: string
  fullContent?: string
  type?: string
  canDelete?: boolean
  createdAt: number
}

const MEMORY_PREVIEW_COUNT = 5

/**
 * What this agent remembers — the rows it owns in the workspace memory store.
 * Edit mode only; rows delete through the same endpoint as the Memories page,
 * and "view all" deep-links into that page pre-filtered to this agent.
 */
export function AgentMemoriesSection({
  agentPrincipalId,
  sidebarCompact = false,
}: {
  agentPrincipalId: string
  sidebarCompact?: boolean
}) {
  const live = useMemories(agentPrincipalId)
  const rows = live === undefined ? null : (live ?? []) as AgentMemoryRow[]
  const [deletingId, setDeletingId] = useState<string | null>(null)
  useEditorLoad(rows === null)

  const remove = async (memoryId: string) => {
    if (deletingId) return
    setDeletingId(memoryId)
    try {
      await overlayAppClient.memory.deleteResponse({ memoryId })
    } finally {
      setDeletingId(null)
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-(--muted)">
        <Loader2 size={12} className="animate-spin" /> Loading memories…
      </div>
    )
  }
  if (rows.length === 0) return null

  const preview = rows.slice(0, MEMORY_PREVIEW_COUNT)
  return (
    <div>
      <p className={`text-xs font-medium ${sidebarCompact ? 'text-(--muted)' : ''}`}>
        Memories{' '}
        <span className='font-normal text-(--muted-light)'>
          {rows.length}
        </span>
      </p>
      <div className={`mt-1.5 overflow-hidden rounded-[10px] ${
        sidebarCompact ? 'bg-(--surface-elevated)' : 'border border-(--border)'
      }`}>
        {preview.map((row) => (
          <div
            key={row.memoryId}
            className="group flex items-center gap-3 border-b border-(--border) px-3 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className='truncate text-xs text-(--foreground)'>
                {row.fullContent ?? row.content}
              </p>
              <p className="mt-0.5 text-[11px] text-(--muted-light)">
                {
                  // Locale is pinned to 'en-US', so SSR and client output are identical.
                  // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
                  `${row.type ?? 'fact'} · ${new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                }
              </p>
            </div>
            {row.canDelete && (
              <Button variant="ghost"
                type="button"
                onClick={() => void remove(row.memoryId)}
                disabled={deletingId === row.memoryId}
                aria-label="Delete memory"
                className={unstyledButton(`shrink-0 text-(--muted-light) opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-40`)}
              >
                {deletingId === row.memoryId ? (
                  <Loader2 size={13} className='animate-spin' />
                ) : (
                  <Trash2 size={13} />
                )}
              </Button>
            )}
          </div>
        ))}
      </div>
      <Link
        href={`/app/settings?section=memories&owner=${encodeURIComponent(agentPrincipalId)}`}
        className="mt-1.5 inline-block text-[11px] text-(--muted) underline underline-offset-2 transition-colors hover:text-(--foreground)"
      >
        {rows.length > MEMORY_PREVIEW_COUNT ? `View all ${rows.length} in Memories` : 'View in Memories'}
      </Link>
    </div>
  )
}

export function DangerZone({ mode, hasAgent, isDefaultMaster, busy, agentName, onArchive, sidebarCompact = false }: {
  mode: 'new' | 'edit'
  hasAgent: boolean
  isDefaultMaster: boolean
  busy: boolean
  agentName: string
  onArchive(): void
  sidebarCompact?: boolean
}) {
  if (mode !== 'edit' || !hasAgent || isDefaultMaster) return null
  return (
    <section className={sidebarCompact
      ? 'rounded-[10px] bg-(--surface-subtle) p-3'
      : 'rounded-xl border border-red-500/25 p-4'
    }>
      <p className='text-xs font-medium text-(--foreground)'>
        Danger zone
      </p>
      <p className='mt-1 text-[11px] leading-4 text-(--muted)'>
        Archiving removes {agentName} from rooms and teams. Its message history
        remains.
      </p>
      <Button
        variant='danger'
        size='sm'
        className='mt-3'
        onClick={onArchive}
        disabled={busy}
      >
        Archive agent
      </Button>
    </section>
  )
}

/**
 * Who can use an agent. A new agent picks freely; a saved one only moves one way, from "Only me" to the workspace (by
 * its creator, after a confirmation), like every Personal → Workspace move.
 */
export function AccessSelector({ value, onChange, agent, onMovedToWorkspace }: {
  value: WorkspaceAgentVisibility
  onChange(value: WorkspaceAgentVisibility): void
  /** The saved agent; omitted while creating one. */
  agent?: WorkspaceAgentDirectoryItem | null
  onMovedToWorkspace?(agent: WorkspaceAgentDirectoryItem): void
}) {
  if (agent) return <SavedAgentAccess agent={agent} onMovedToWorkspace={onMovedToWorkspace} />
  return (
    <div>
      <p className="text-xs font-medium">Access</p>
      <div
        className='mt-1.5 space-y-2'
        role='radiogroup'
        aria-label='Agent access'
      >
        <OptionRow
          checked={value === 'workspace'}
          onSelect={() => onChange('workspace')}
          icon={<Users size={15} />}
          label="Everyone in this workspace"
          description="Anyone can see, chat with, or @-mention this agent."
        />
        <OptionRow
          checked={value === 'creator'}
          onSelect={() => onChange('creator')}
          icon={<Lock size={15} />}
          label="Only me"
          description="Only you can see, chat with, or @-mention this agent."
        />
      </div>
      <p className='mt-1.5 text-[11px] leading-4 text-(--muted)'>
        {value === 'creator'
          ? 'Hidden from everyone else. You can move it to the workspace later, but not back.'
          : 'Everyone in this workspace can see, chat with, or @-mention this agent.'}
      </p>
    </div>
  )
}

function SavedAgentAccess({ agent, onMovedToWorkspace }: {
  agent: WorkspaceAgentDirectoryItem
  onMovedToWorkspace?(agent: WorkspaceAgentDirectoryItem): void
}) {
  const workspaceContext = useOptionalWorkspace()
  const activeWorkspaceId = workspaceContext?.activeWorkspaceId
  const [confirming, setConfirming] = useState(false)
  const [moving, setMoving] = useState(false)
  const shared = (agent.visibility ?? 'workspace') === 'workspace'
  const workspace = workspaceContext?.activeWorkspace?.name || 'this workspace'

  async function move() {
    if (!activeWorkspaceId) return
    setMoving(true)
    try {
      const saved = await overlayAppClient.agents.update(activeWorkspaceId, agent.id, { visibility: 'workspace' })
      setConfirming(false)
      onMovedToWorkspace?.(saved.agent)
      toast.success(`${agent.name} moved to the workspace`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move this agent.')
    } finally {
      setMoving(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-medium">Access</p>
      <div className="mt-1.5 flex items-start gap-2.5 rounded-xl border border-(--border) p-3">
        <span className="mt-0.5 shrink-0 text-(--muted)">{shared ? <Users size={15} /> : <Lock size={15} />}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-(--foreground)">{shared ? 'Everyone in this workspace' : 'Only me'}</span>
          <span className="mt-0.5 block text-xs leading-5 text-(--muted)">
            {shared
              ? 'Anyone can see, chat with, or @-mention this agent.'
              : 'Only you can see, chat with, or @-mention this agent.'}
          </span>
        </span>
        {shared ? null : (
          <Button type="button" variant="outline" size="xs" className="h-7 shrink-0 px-2.5 text-xs font-normal" onClick={() => setConfirming(true)}>
            Move to workspace
          </Button>
        )}
      </div>
      <Dialog open={confirming} onOpenChange={(open) => { if (!open && !moving) setConfirming(false) }}>
        {confirming ? (
          <DialogContent>
            <DialogHeader className="flex-col items-start gap-1 pr-6">
              <DialogTitle>Move to workspace?</DialogTitle>
              <DialogDescription>
                Everyone in {workspace} will be able to see, chat with, and @-mention {agent.name}, and it joins the
                workspace’s public channels. You can’t move it back to Personal.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={moving} onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="button" variant="secondary" disabled={moving} onClick={() => void move()}>
                {moving ? 'Moving…' : 'Move to workspace'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}

export function OverlayAgentPermissionsField({
  value,
  onChange,
}: {
  value: 'ask' | 'auto'
  onChange(value: 'ask' | 'auto'): void
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  return (
    <div>
      <FieldLabel info="Choose whether this agent asks before taking actions or runs them without approval.">Permissions</FieldLabel>
      <SegmentedControl
        ariaLabel="Permissions"
        layout="stretch"
        value={value}
        options={[{ value: 'ask', label: 'Ask' }, { value: 'auto', label: 'Auto' }]}
        onChange={(next) => {
          const selected = next === 'auto' ? 'auto' : 'ask'
          const selection = resolveOverlayPermissionModeSelection(value, selected, false)
          if (selection.confirmationRequired) setConfirmAuto(true)
          else onChange(selection.mode)
        }}
      />
      <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">
        {value === 'ask'
          ? 'Asks before typing, terminal commands, risky clicks and app actions.'
          : 'Runs everything without asking, including in automations.'}
      </p>
      <ConfirmDialog
        isOpen={confirmAuto}
        title="Let this agent act without asking?"
        description="It will type, run commands, click and use apps without your approval, including in automations."
        confirmLabel="Use Auto"
        onCancel={() => setConfirmAuto(false)}
        onConfirm={() => {
          onChange(resolveOverlayPermissionModeSelection(value, 'auto', true).mode)
          setConfirmAuto(false)
        }}
      />
    </div>
  )
}

export function resolveOverlayPermissionModeSelection(
  current: 'ask' | 'auto',
  selected: 'ask' | 'auto',
  confirmedAuto: boolean,
): { mode: 'ask' | 'auto'; confirmationRequired: boolean } {
  if (selected === 'auto' && current !== 'auto' && !confirmedAuto) {
    return { mode: current, confirmationRequired: true }
  }
  return { mode: selected, confirmationRequired: false }
}

const COMPUTER_SIZE_OPTIONS = [
  { value: 'small', label: 'Small · 2 vCPU, 4 GB' },
  { value: 'default', label: 'Default · 4 vCPU, 8 GB' },
  { value: 'large', label: 'Large · 8 vCPU, 16 GB' },
] as const

function ComputerSizePicker({ size, onSizeChange, disabled }: {
  size: ComputerSize
  onSizeChange(next: ComputerSize): void
  disabled?: boolean
}) {
  return (
    <label className="block text-xs font-medium">
      Size
      <ListboxSelect
        className="mt-1.5"
        aria-label="Computer size"
        value={size}
        options={[...COMPUTER_SIZE_OPTIONS]}
        onChange={(value) => onSizeChange(value as ComputerSize)}
        disabled={disabled}
        portal
      />
    </label>
  )
}

function ComputerCardActions({ canTogglePower, canDeleteComputer, powerLabel, openBusy, lifecycleBusy, onTogglePower, onDelete }: {
  canTogglePower: boolean
  canDeleteComputer: boolean
  powerLabel: string
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | 'control' | null
  onTogglePower(): void
  onDelete(): void
}) {
  const busy = lifecycleBusy !== null || openBusy
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      {canTogglePower ? (
        <Button variant="ghost" size="sm" onClick={onTogglePower} disabled={busy}>
          {powerLabel}
        </Button>
      ) : null}
      {canDeleteComputer ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDelete} disabled={busy} aria-label="Delete computer">
          {lifecycleBusy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </Button>
      ) : null}
    </div>
  )
}

function ProvisionedComputerCard({ computer, currentUserId, agentName, openBusy, lifecycleBusy, onOpenDesktop, onControl, onTogglePower, onDelete }: {
  computer: Computer
  currentUserId?: string
  agentName: string
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | 'control' | null
  onOpenDesktop(): void
  onControl(): void
  onTogglePower(): void
  onDelete(): void
}) {
  const canTogglePower = computer.status === 'ready' || computer.status === 'stopped'
  const canDeleteComputer = canTogglePower || computer.status === 'error'
  const powerLabel = lifecycleBusy === 'stop' ? 'Stopping…' : lifecycleBusy === 'start' ? 'Starting…' : computer.status === 'ready' ? 'Stop computer' : 'Start computer'
  const controlledByCurrentUser = Boolean(computer.controlledByUserId && computer.controlledByUserId === currentUserId)
  const statusLine = computer.status !== 'ready' ? null : computer.controlledByUserId
    ? controlledByCurrentUser
      ? `You have control. ${agentName} is paused.`
      : 'Someone else has control'
    : isComputerRecentlyActive(computer.lastActiveAt)
      ? `${agentName} is using it`
      : null
  return (
    <div className="rounded-xl bg-(--surface-subtle) p-3">
      <div className="min-w-0">
        <p className="flex items-start gap-1.5 text-xs font-medium text-(--foreground)"><Monitor size={13} className="mt-0.5 shrink-0 text-(--muted)" /><span className="min-w-0 break-words">{computer.name ?? 'Computer'}</span></p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4 text-(--muted)">
          {statusLine ? <><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${computer.controlledByUserId ? 'bg-blue-500' : 'bg-green-500'}`} />{statusLine}</> : `${computer.status} · ${computer.size} · size is fixed once provisioned`}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {computer.status === 'ready' ? (
          <Button variant="secondary" size="sm" onClick={onOpenDesktop} disabled={openBusy || lifecycleBusy !== null}>
            {openBusy ? 'Opening…' : 'Open desktop'}
          </Button>
        ) : null}
        {(computer.controlledByUserId || computer.status === 'ready') ? (
          <Button variant="secondary" size="sm" onClick={onControl} disabled={lifecycleBusy !== null || openBusy}>
            {lifecycleBusy === 'control' ? (computer.controlledByUserId ? 'Handing back…' : 'Taking control…') : computer.controlledByUserId ? 'Hand back' : 'Take control'}
          </Button>
        ) : null}
      </div>
      <ComputerCardActions
        canTogglePower={canTogglePower}
        canDeleteComputer={canDeleteComputer}
        powerLabel={powerLabel}
        openBusy={openBusy}
        lifecycleBusy={lifecycleBusy}
        onTogglePower={onTogglePower}
        onDelete={onDelete}
      />
    </div>
  )
}

function isComputerRecentlyActive(lastActiveAt: number | null): boolean {
  return lastActiveAt !== null && Date.now() - lastActiveAt < 120_000
}

/**
 * Accessory rendered under the Computer tool-group row: the size picker while
 * unprovisioned, the provisioned machine card with lifecycle controls, and the
 * destructive-save warning. The group's own ToggleRow is the on/off control —
 * enabled means "this agent gets a computer".
 */
export function AgentComputerSection({ enabled, size, onSizeChange, computer, currentUserId, agentName, openBusy, lifecycleBusy, onOpenDesktop, onControl, onTogglePower, onDelete, loadError, provisionError, onRetryLoad, disabled }: {
  enabled: boolean
  size: ComputerSize
  onSizeChange(next: ComputerSize): void
  computer: Computer | null
  currentUserId?: string
  agentName: string
  loadError: string | null
  provisionError: string | null
  onRetryLoad(): void
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | 'control' | null
  onOpenDesktop(): void
  onControl(): void
  onTogglePower(): void
  onDelete(): void
  disabled?: boolean
}) {
  if (!enabled && !computer && !loadError && !provisionError) return null
  return (
    <div className="space-y-3">
      {enabled && !computer ? <ComputerSizePicker size={size} onSizeChange={onSizeChange} disabled={disabled} /> : null}
      {enabled && computer ? (
        <ProvisionedComputerCard
          computer={computer}
          currentUserId={currentUserId}
          agentName={agentName}
          openBusy={openBusy}
          lifecycleBusy={lifecycleBusy}
          onOpenDesktop={onOpenDesktop}
          onControl={onControl}
          onTogglePower={onTogglePower}
          onDelete={onDelete}
        />
      ) : null}
      {enabled && !computer ? (
        <p className='text-[11px] leading-4 text-(--muted)'>
          Created when you save. Also managed under Settings → Computers.
        </p>
      ) : null}
      {!enabled && computer ? (
        <p className='text-[11px] leading-4 text-(--muted)'>
          Saving deletes this computer and its disk permanently.
        </p>
      ) : null}
      <AgentComputerRecoveryNotice
        loadError={loadError}
        provisionError={provisionError}
        onRetryLoad={onRetryLoad}
      />
    </div>
  )
}

export function AgentAvatar({ isDefault, color, shape, name, description, namePlaceholder, descriptionPlaceholder, onNameChange, onDescriptionChange, onChange, onShapeChange }: {
  isDefault?: boolean
  color: string
  shape: WorkspaceAgentCreatureShape
  name: string
  description: string
  namePlaceholder: string
  descriptionPlaceholder: string
  onNameChange(value: string): void
  onDescriptionChange(value: string): void
  onChange(color: string): void
  onShapeChange(shape: WorkspaceAgentCreatureShape): void
}) {
  return (
    <div className="space-y-3.5">
      <AgentAvatarPicker isDefault={isDefault} shape={shape} color={color} onShapeChange={onShapeChange} onColorChange={onChange} />
      <div>
        <FieldLabel htmlFor="agent-editor-name">Name</FieldLabel>
        <Input id="agent-editor-name" autoComplete="off" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={namePlaceholder} />
      </div>
      <div>
        <FieldLabel htmlFor="agent-editor-description" info="A short line about what this agent is for. It shows next to the agent in lists.">Description</FieldLabel>
        <Textarea
          id="agent-editor-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={descriptionPlaceholder}
          className="min-h-16 resize-none!"
        />
      </div>
    </div>
  )
}

export function MasterAgentNotice() {
  return (
    <p className="mt-5 rounded-xl border border-(--border) bg-(--surface-subtle) p-4 text-xs leading-5 text-(--muted)">
      Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).
    </p>
  )
}

export function OverlayAgentFields({ instructions, onInstructionsChange, modelId, onModelChange, modelField, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, computersAvailable = true, computer }: { instructions: string; onInstructionsChange(value: string): void; modelId: string; onModelChange(value: string): void; modelField: AgentModelFieldProps; enabledToolGroups: Set<string>; onToggleToolGroup(groupId: string): void; advanced: boolean; onAdvancedChange(value: boolean): void; computersAvailable?: boolean; computer?: Omit<ComponentProps<typeof AgentComputerSection>, 'enabled'> }) {
  const toolGroups = computersAvailable ? AGENT_TOOL_GROUPS : AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer')
  return (
    <>
      <label className='block text-xs font-medium'>
        Agent instructions
        <Textarea
          value={instructions}
          onChange={(event) => onInstructionsChange(event.target.value)}
          placeholder='Describe what this agent should do, how it should respond, and when it should stop.'
          className={unstyledTextarea(`mt-1.5 min-h-36 w-full resize-y rounded-lg border border-(--border) bg-(--background) px-3 py-2.5 text-sm leading-5 outline-hidden focus:border-(--muted)`)}
        />
      </label>
      <div>
        <p className='text-xs font-medium'>Model</p>
        <div className='mt-1.5'>
          <ChatModelPicker
            placement='field'
            modelPickerLabel={modelField.modelPickerLabel}
            selectableTextModels={modelField.selectableTextModels}
            selectedActModel={modelId}
            onToggleTextModel={onModelChange}
            reasoning={modelField.reasoningByModel?.[modelId]}
            onReasoningChange={(level) => modelField.onModelReasoningChange?.(modelId, level)}
            reasoningByModel={modelField.reasoningByModel}
            onModelReasoningChange={modelField.onModelReasoningChange}
            favoriteScope={modelField.favoriteScope}
            modelRecommendations={MODEL_RECOMMENDATIONS}
            textModelsLoading={modelField.textModelsLoading}
            generationMode='text'
            lockedGenerationMode='text'
          />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium">Tools</p>
        <p className='mt-1 text-[11px] leading-4 text-(--muted)'>
          Grant this agent the same tools the personal chat can use. It only
          acts on what you enable here.
        </p>
        <div className="mt-1">
          {toolGroups.map((group) => (
            <Fragment key={group.id}>
              <ToggleRow
                checked={enabledToolGroups.has(group.id)}
                onChange={() => onToggleToolGroup(group.id)}
                label={group.label}
                description={group.description}
              />
              {group.id === 'computer' && computer ? (
                <AgentComputerSection enabled={enabledToolGroups.has('computer')} {...computer} />
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
      <Button variant="ghost"
        type='button'
        onClick={() => onAdvancedChange(!advanced)}
        className={unstyledButton(`flex items-center gap-1.5 text-xs font-medium text-(--muted)`)}
      >
        Advanced{' '}
        <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />
      </Button>
      {advanced ? (
        <div className='rounded-lg border border-(--border) bg-(--surface-subtle) p-3 text-[11px] leading-4 text-(--muted)'>
          Mention-first is enforced. One-to-one agent DMs invoke implicitly
          channels and group DMs require a human mention or reply in the agent’s
          thread.
        </div>
      ) : null}
    </>
  )
}
