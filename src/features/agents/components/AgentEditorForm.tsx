'use client'

import { unstyledButton, unstyledTextarea } from '@overlay/ui/control-reset'

import { Fragment, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { Bot, Check, ChevronDown, Copy, Hash, Laptop, Loader2, Lock, Monitor, Plus, Server, ShieldCheck, Sparkles, Terminal, Trash2, Users } from 'lucide-react'
import { Button, Input, ListboxSelect, SegmentedControl, Textarea, Toggle } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import type { Computer, ComputerSize, SurfaceBinding, SurfaceChannelOption, SurfaceConnection, WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type { WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { ChatModelPicker, type ChatModelPickerProps } from '@overlay/chat-react'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import { MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { generatedAgentSetupPrompt } from '../lib/byo-agent-setup'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { AgentAvatarPicker } from './AgentAvatarPicker'
import { AgentComputerRecoveryNotice } from './AgentComputerRecoveryNotice'
import { FieldLabel } from './InfoTip'
import { useEditorLoad } from './EditorLoadGate'
import type { SurfaceChannelPicker } from './use-agent-surfaces'

export type AgentType = 'overlay' | 'byo'
export type EnvironmentChoice = 'existing' | 'connect'
export type AgentModelFieldProps = Pick<
  ChatModelPickerProps,
  'favoriteScope' | 'isFreeTier' | 'selectableTextModels' | 'textModelsLoading'
> & {
  isFreeTierWorkspace: boolean
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

export function AgentTypeSelector({ value, onChange, hidden }: {
  value: AgentType
  onChange(value: AgentType): void
  hidden?: boolean
}) {
  if (hidden) return null
  return (
    <div role="radiogroup" aria-label="Agent type">
      <p className="text-xs font-medium">Agent type</p>
      <div className="mt-1.5 space-y-2">
        <OptionRow
          checked={value === 'overlay'}
          onSelect={() => onChange('overlay')}
          icon={<Bot size={15} />}
          label="Create your own agent"
          description="Runs on Overlay Cloud. Pick a runtime below. No machines to connect."
        />
        <OptionRow
          checked={value === 'byo'}
          onSelect={() => onChange('byo')}
          icon={<Server size={15} />}
          label="Bring your own agent"
          description="Run Codex, Claude Code, or Hermes on your own machines and VPSs."
        />
      </div>
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
  const [rows, setRows] = useState<AgentMemoryRow[] | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  useEditorLoad(rows === null)

  // cancelled flag makes the fetch safe against overlapping re-runs.
  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect
  useEffect(() => {
    let cancelled = false
    void overlayAppClient.memory
      .getResponse({ memberPrincipalId: agentPrincipalId })
      .then(async (res) => {
        if (cancelled) return
        setRows(res.ok ? unwrapPaginatedData<AgentMemoryRow>(await res.json()) : [])
      })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [agentPrincipalId])

  const remove = async (memoryId: string) => {
    if (deletingId) return
    setDeletingId(memoryId)
    try {
      const res = await overlayAppClient.memory.deleteResponse({ memoryId })
      if (res.ok) setRows((current) => current?.filter((row) => row.memoryId !== memoryId) ?? [])
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

export function AccessSelector({ value, onChange }: { value: WorkspaceAgentVisibility; onChange(value: WorkspaceAgentVisibility): void }) {
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
          ? 'Hidden from everyone else, reported as not found.'
          : 'Everyone in this workspace can see, chat with, or @-mention this agent.'}
      </p>
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

function ComputerCardActions({ status, canTogglePower, canDeleteComputer, powerLabel, openBusy, lifecycleBusy, onOpenDesktop, onTogglePower, onDelete }: {
  status: Computer['status']
  canTogglePower: boolean
  canDeleteComputer: boolean
  powerLabel: string
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | 'control' | null
  onOpenDesktop(): void
  onTogglePower(): void
  onDelete(): void
}) {
  const busy = lifecycleBusy !== null || openBusy
  return (
    <>
      {status === 'ready' ? (
        <Button variant="secondary" size="sm" onClick={onOpenDesktop} disabled={openBusy || lifecycleBusy !== null}>
          {openBusy ? 'Opening…' : 'Open desktop'}
        </Button>
      ) : null}
      {canTogglePower ? (
        <Button variant="secondary" size="sm" onClick={onTogglePower} disabled={busy}>
          {powerLabel}
        </Button>
      ) : null}
      {canDeleteComputer ? (
        <Button variant="secondary" size="sm" onClick={onDelete} disabled={busy} aria-label="Delete computer">
          {lifecycleBusy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </Button>
      ) : null}
    </>
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
  const powerLabel = lifecycleBusy === 'stop' ? 'Stopping…' : lifecycleBusy === 'start' ? 'Starting…' : computer.status === 'ready' ? 'Stop' : 'Start'
  const controlledByCurrentUser = Boolean(computer.controlledByUserId && computer.controlledByUserId === currentUserId)
  const statusLine = computer.controlledByUserId
    ? controlledByCurrentUser
      ? `You have control. ${agentName} is paused.`
      : 'Someone else has control'
    : isComputerRecentlyActive(computer.lastActiveAt)
      ? `${agentName} is using it`
      : null
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-(--border) p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-(--foreground)"><Monitor size={13} className="shrink-0 text-(--muted)" />{computer.name ?? 'Computer'}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4 text-(--muted)">
          {statusLine ? <><span className={`h-1.5 w-1.5 rounded-full ${computer.controlledByUserId ? 'bg-blue-500' : 'bg-green-500'}`} />{statusLine}</> : `${computer.status} · ${computer.size} · size is fixed once provisioned`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {(computer.controlledByUserId || computer.status === 'ready') ? (
          <Button variant="secondary" size="sm" onClick={onControl} disabled={lifecycleBusy !== null || openBusy}>
            {lifecycleBusy === 'control' ? (computer.controlledByUserId ? 'Handing back…' : 'Taking control…') : computer.controlledByUserId ? 'Hand back' : 'Take control'}
          </Button>
        ) : null}
        <ComputerCardActions
          status={computer.status}
          canTogglePower={canTogglePower}
          canDeleteComputer={canDeleteComputer}
          powerLabel={powerLabel}
          openBusy={openBusy}
          lifecycleBusy={lifecycleBusy}
          onOpenDesktop={onOpenDesktop}
          onTogglePower={onTogglePower}
          onDelete={onDelete}
        />
      </div>
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
    <div className="space-y-3 border-b border-(--border) pb-3 pt-1 last:border-b-0">
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

/**
 * "Reachable on" — external chat surfaces bound to this agent. Slack
 * connections are workspace installs; bindings map agent ↔ channel and commit
 * immediately (no Save round-trip). `canBind` comes from the server and hides
 * every connect/bind control for guests and non-creators of personal agents.
 */
export function AgentSurfacesSection({
  agentName, hasAgent, loading, connections, bindings, canBind, canBindResolved, channelPicker, busyId, error,
  onConnectSlack, onToggleChannelPicker, onSelectChannel, onRemoveBinding,
}: {
  agentName: string
  hasAgent: boolean
  loading: boolean
  connections: SurfaceConnection[]
  bindings: SurfaceBinding[]
  canBind: boolean
  /** True once the server answered the bind gate — keeps the "creator only" hint off showcase/BYO editors. */
  canBindResolved: boolean
  channelPicker: SurfaceChannelPicker | null
  busyId: string | null
  error: string | null
  onConnectSlack(): void
  onToggleChannelPicker(connectionId: string): void
  onSelectChannel(connectionId: string, channel: SurfaceChannelOption): void
  onRemoveBinding(bindingId: string): void
}) {
  const name = agentName.trim() || 'this agent'
  const slackConnections = connections.filter((connection) => connection.platform === 'slack')
  const boundChannelKeys = new Set(bindings.map((binding) => `${binding.connectionId}:${binding.channelId}`))

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        Reachable on
        {loading ? <Loader2 size={12} className="animate-spin text-(--muted)" /> : null}
      </p>
      <div className="mt-1.5">
        <div className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-(--foreground)">Overlay</p>
            <p className="mt-0.5 text-[11px] leading-4 text-(--muted)">In Chats and rooms.</p>
          </div>
          <span className="shrink-0 text-[11px] text-(--muted)">always on</span>
        </div>

        {slackConnections.length === 0 ? (
          <div className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-(--foreground)">Slack</p>
              {canBind ? (
                <p className="mt-0.5 text-[11px] leading-4 text-(--muted)">Connect a Slack workspace so people can reach {name} there.</p>
              ) : null}
            </div>
            {canBind ? (
              <Button variant="secondary" size="sm" onClick={onConnectSlack} disabled={!hasAgent}>Connect</Button>
            ) : null}
          </div>
        ) : null}

        {slackConnections.map((connection) => {
          const connectionBindings = bindings.filter((binding) => binding.connectionId === connection.id)
          const pickerOpen = channelPicker?.connectionId === connection.id
          const pickerChannels = (channelPicker?.options ?? []).filter(
            (channel) => !boundChannelKeys.has(`${connection.id}:${channel.id}`),
          )
          return (
            <Fragment key={connection.id}>
              <div className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-(--foreground)">Slack · {connection.externalTeamName ?? 'Slack workspace'}</p>
                  {connection.status !== 'active' ? (
                    <p className="mt-0.5 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                      {connection.status === 'degraded' ? 'Connection degraded. Reconnect Slack to resume.' : 'Uninstalled from Slack. Reconnect to resume.'}
                    </p>
                  ) : null}
                </div>
                {canBind ? (
                  <Button variant="ghost"
                    type="button"
                    onClick={() => onToggleChannelPicker(connection.id)}
                    disabled={!hasAgent || connection.status !== 'active'}
                    className={unstyledButton(`flex shrink-0 items-center gap-1 text-[11px] font-medium text-(--muted) transition-colors hover:text-(--foreground) disabled:cursor-not-allowed disabled:opacity-50`)}
                  >
                    <Plus size={11} />Add channel
                  </Button>
                ) : null}
              </div>

              {connectionBindings.map((binding) => (
                <div key={binding.id} className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1 pl-5">
                    <p className="flex items-center gap-1 text-xs font-medium text-(--foreground)">
                      <Hash size={11} className="shrink-0 text-(--muted)" />{binding.channelName ?? binding.channelId}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-(--muted)">
                      Anyone in {binding.channelName ? `#${binding.channelName}` : 'this channel'} can reach {name} with @Overlay {name}. It acts with your access.
                    </p>
                  </div>
                  {canBind ? (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => onRemoveBinding(binding.id)}
                      disabled={busyId !== null}
                      className={unstyledButton(`shrink-0 text-[11px] text-(--muted) transition-colors hover:text-(--foreground) disabled:opacity-50`)}
                    >
                      {busyId === binding.id ? 'Removing…' : 'Remove'}
                    </Button>
                  ) : null}
                </div>
              ))}

              {pickerOpen && channelPicker ? (
                <div className="border-b border-(--border) py-2.5 pl-5 last:border-b-0">
                  {channelPicker.loading ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-(--muted)"><Loader2 size={11} className="animate-spin" />Loading channels…</p>
                  ) : channelPicker.error ? (
                    <p className="text-[11px] leading-4 text-red-500">{channelPicker.error}</p>
                  ) : pickerChannels.length === 0 ? (
                    <p className="text-[11px] leading-4 text-(--muted)">No more channels to add.</p>
                  ) : (
                    <>
                      <ListboxSelect
                        aria-label="Add Slack channel"
                        value="Select a channel"
                        options={pickerChannels.map((channel) => ({
                          value: channel.id,
                          label: `# ${channel.name}${channel.isMember === false ? ' · invite needed' : ''}`,
                        }))}
                        onChange={(channelId) => {
                          const channel = pickerChannels.find((option) => option.id === channelId)
                          if (channel) onSelectChannel(connection.id, channel)
                        }}
                        disabled={busyId !== null}
                      />
                      <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">
                        The bot only answers in channels it has joined. Invite it with /invite @Overlay.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </Fragment>
          )
        })}

        {canBind && slackConnections.length > 0 ? (
          <div className="border-b border-(--border) py-2.5 last:border-b-0">
            <Button variant="ghost"
              type="button"
              onClick={onConnectSlack}
              disabled={!hasAgent}
              className={unstyledButton(`text-[11px] text-(--muted) transition-colors hover:text-(--foreground) disabled:opacity-50`)}
            >
              Connect another Slack workspace
            </Button>
          </div>
        ) : null}

        {(['Teams', 'Discord'] as const).map((platform) => (
          <div key={platform} className="flex items-center gap-3 border-b border-(--border) py-2.5 opacity-50 last:border-b-0">
            <p className="min-w-0 flex-1 text-xs font-medium text-(--foreground)">{platform}</p>
            <span className="shrink-0 text-[11px] text-(--muted)">coming soon</span>
          </div>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-[11px] leading-4 text-red-500">{error}</p> : null}
      {!hasAgent ? (
        <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">Create the agent to connect it to a surface.</p>
      ) : canBindResolved && !loading && !canBind ? (
        <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">Only this agent&rsquo;s creator can connect surfaces.</p>
      ) : null}
      <p className="mt-1.5 text-[11px] leading-4 text-(--muted)">Threads from connected surfaces appear in Chats.</p>
    </div>
  )
}

export function AgentAvatar({ color, shape, name, description, namePlaceholder, descriptionPlaceholder, onNameChange, onDescriptionChange, onChange, onShapeChange }: {
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
      <AgentAvatarPicker shape={shape} color={color} onShapeChange={onShapeChange} onColorChange={onChange} />
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

export function AgentBehaviorFields({ agentType, connectedAgentsEnabled, computersAvailable, computer, instructions, onInstructionsChange, modelId, onModelChange, modelField, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, legacyHostedRuntime, adapterId, harnessOptions, onHarnessChange, environmentChoice, onEnvironmentChoiceChange, compatibleEnvironments, environmentsLoading, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange, selectedHarnessConnectable, environmentBusy, environmentError, command, copied, onCopyCommand, onBeginConnection, setupEnvironment, setupRoots, onSetupRootsChange, onApproveSetup }: {
  agentType: AgentType
  connectedAgentsEnabled: boolean
  computersAvailable: boolean
  computer?: Omit<ComponentProps<typeof AgentComputerSection>, 'enabled'>
  instructions: string
  onInstructionsChange(value: string): void
  modelId: string
  onModelChange(value: string): void
  modelField: AgentModelFieldProps
  enabledToolGroups: Set<string>
  onToggleToolGroup(groupId: string): void
  advanced: boolean
  onAdvancedChange(value: boolean): void
  /** The agent was bound to a hosted runtime that no longer exists. */
  legacyHostedRuntime: boolean
  adapterId: string
  harnessOptions: Array<{ id: string; label: string; description: string; connectable: boolean }>
  onHarnessChange(value: string): void
  environmentChoice: EnvironmentChoice
  onEnvironmentChoiceChange(value: EnvironmentChoice): void
  compatibleEnvironments: AgentEnvironmentResource[]
  environmentsLoading: boolean
  environmentId: string
  onEnvironmentChange(value: string): void
  workingDirectory: string
  onWorkingDirectoryChange(value: string): void
  selectedHarnessConnectable: boolean
  environmentBusy: string | null
  environmentError: string | null
  command: string
  copied: boolean
  onCopyCommand(): void
  onBeginConnection(): void
  setupEnvironment?: AgentEnvironmentResource
  setupRoots: string
  onSetupRootsChange(value: string): void
  onApproveSetup(): void
}) {
  if (agentType === 'overlay') {
    // An agent that ran on a hosted runtime that has since been removed stays
    // read-only instead of silently rendering as a native Overlay agent (which a
    // save would convert it into).
    if (legacyHostedRuntime) {
      return (
        <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4 text-xs leading-5 text-(--muted)">
          This agent ran on a hosted runtime that is no longer available. It is unchanged; recreate it as an Overlay agent, or connect an agent running on your own machine.
        </div>
      )
    }
    return (
      <OverlayAgentFields
        instructions={instructions}
        onInstructionsChange={onInstructionsChange}
        modelId={modelId}
        onModelChange={onModelChange}
        modelField={modelField}
        enabledToolGroups={enabledToolGroups}
        onToggleToolGroup={onToggleToolGroup}
        advanced={advanced}
        onAdvancedChange={onAdvancedChange}
        computersAvailable={computersAvailable}
        computer={computer}
      />
    )
  }
  if (!connectedAgentsEnabled) {
    return (
      <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4 text-xs leading-5 text-(--muted)">
        This connected agent is unchanged. Connected-agent editing is not available for this workspace right now.
      </div>
    )
  }
  return (
    <ByoAgentFields
      adapterId={adapterId}
      harnessOptions={harnessOptions}
      onHarnessChange={onHarnessChange}
      choice={environmentChoice}
      onChoiceChange={onEnvironmentChoiceChange}
      compatibleEnvironments={compatibleEnvironments}
      environmentsLoading={environmentsLoading}
      environmentId={environmentId}
      onEnvironmentChange={onEnvironmentChange}
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={onWorkingDirectoryChange}
      selectedHarnessConnectable={selectedHarnessConnectable}
      environmentBusy={environmentBusy}
      environmentError={environmentError}
      command={command}
      copied={copied}
      onCopyCommand={onCopyCommand}
      onBeginConnection={onBeginConnection}
      setupEnvironment={setupEnvironment}
      setupRoots={setupRoots}
      onSetupRootsChange={onSetupRootsChange}
      onApproveSetup={onApproveSetup}
    />
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
            isFreeTier={modelField.isFreeTier}
            isFreeTierChatModelId={isFreeTierChatModelId}
            favoriteScope={modelField.favoriteScope}
            modelRecommendations={MODEL_RECOMMENDATIONS}
            textModelsLoading={modelField.textModelsLoading}
            generationMode='text'
            lockedGenerationMode='text'
          />
        </div>
        {modelField.isFreeTierWorkspace && !isFreeTierChatModelId(modelId) ? (
          <p className='mt-1.5 text-[11px] leading-4 text-(--muted)'>
            Free workspaces use free models. This agent will use Auto.
          </p>
        ) : null}
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

export function ByoAgentFields({ adapterId, harnessOptions, onHarnessChange, choice, onChoiceChange, compatibleEnvironments, environmentsLoading, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange, selectedHarnessConnectable, environmentBusy, environmentError, command, copied, onCopyCommand, onBeginConnection, setupEnvironment, setupRoots, onSetupRootsChange, onApproveSetup }: { adapterId: string; harnessOptions: Array<{ id: string; label: string; description: string; connectable: boolean }>; onHarnessChange(value: string): void; choice: EnvironmentChoice; onChoiceChange(value: EnvironmentChoice): void; compatibleEnvironments: AgentEnvironmentResource[]; environmentsLoading: boolean; environmentId: string; onEnvironmentChange(value: string): void; workingDirectory: string; onWorkingDirectoryChange(value: string): void; selectedHarnessConnectable: boolean; environmentBusy: string | null; environmentError: string | null; command: string; copied: boolean; onCopyCommand(): void; onBeginConnection(): void; setupEnvironment?: AgentEnvironmentResource; setupRoots: string; onSetupRootsChange(value: string): void; onApproveSetup(): void }) {
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
        <p className='text-xs font-medium'>Harness</p>
        <p className='mt-1 text-[11px] leading-4 text-(--muted)'>
          Choose the coding agent Overlay will invoke.
        </p>
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="Harness">
          {harnessOptions.map((harness) => (
            <OptionRow
              key={harness.id}
              checked={adapterId === harness.id}
              onSelect={() => onHarnessChange(harness.id)}
              label={harness.label}
              description={harness.description}
            />
          ))}
        </div>
      </section>
      <section>
        <p className="text-xs font-medium">Where it runs</p>
        <div
          className='mt-2 space-y-2'
          role='radiogroup'
          aria-label='Agent environment'
        >
          <EnvironmentChoiceButton
            active={choice === 'existing'}
            icon={<Server size={15} />}
            label='Existing environment'
            description='Pick an already-connected computer, VPS, or sandbox.'
            onClick={() => onChoiceChange('existing')}
          />
          <EnvironmentChoiceButton
            active={choice === 'connect'}
            icon={<Laptop size={15} />}
            label='Connect a new machine'
            description='Outbound-only. No inbound port is opened.'
            disabled={!selectedHarnessConnectable}
            onClick={() => onChoiceChange('connect')}
          />
        </div>
        <div className="mt-3 rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
          {choice === 'existing' ? (
            <ExistingEnvironmentFields
              environmentsLoading={environmentsLoading}
              compatibleEnvironments={compatibleEnvironments}
              selectedHarnessConnectable={selectedHarnessConnectable}
              environmentId={environmentId}
              onEnvironmentChange={onEnvironmentChange}
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
            />
          ) : null}
          {choice === 'connect' ? (
            <ConnectMachineFields
              command={command}
              environmentBusy={environmentBusy}
              onBeginConnection={onBeginConnection}
              setupMode={setupMode}
              onSetupModeChange={setSetupMode}
              setupPrompt={setupPrompt}
              copiedPrompt={copiedPrompt}
              onCopyPrompt={copyPrompt}
              copied={copied}
              onCopyCommand={onCopyCommand}
              setupEnvironment={setupEnvironment}
            />
          ) : null}
          {setupEnvironment ? <EnvironmentApprovalPanel environment={setupEnvironment} roots={setupRoots} busy={environmentBusy === 'approve'} onRootsChange={onSetupRootsChange} onApprove={onApproveSetup} /> : null}
        </div>
      </section>
      {environmentError || copyError ? (
        <p role='alert' className='text-xs text-red-500'>
          {environmentError ?? copyError}
        </p>
      ) : null}
    </div>
  )
}

function ExistingEnvironmentFields({ environmentsLoading, compatibleEnvironments, selectedHarnessConnectable, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange }: {
  environmentsLoading: boolean
  compatibleEnvironments: AgentEnvironmentResource[]
  selectedHarnessConnectable: boolean
  environmentId: string
  onEnvironmentChange(value: string): void
  workingDirectory: string
  onWorkingDirectoryChange(value: string): void
}) {
  if (environmentsLoading) {
    return <p className="flex items-center gap-2 text-xs text-(--muted)"><Loader2 size={14} className="animate-spin" /> Loading environments…</p>
  }
  if (compatibleEnvironments.length === 0) {
    return (
      <div className="text-xs text-(--muted)">
        <p>No connected environment currently advertises this harness.</p>
        {selectedHarnessConnectable ? <p className="mt-1">Connect a computer, VPS, or sandbox to continue.</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium">Environment<ListboxSelect className="mt-1.5" aria-label="Connected environment" value={environmentId} options={compatibleEnvironments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.status}` }))} onChange={onEnvironmentChange} portal /></label>
      <label className="block text-xs font-medium">Default working directory<Input className="mt-1.5" value={workingDirectory} onChange={(event) => onWorkingDirectoryChange(event.target.value)} placeholder="/Users/you/Projects/app" /></label>
      <p className="text-[11px] leading-4 text-(--muted)">This must be inside the environment’s approved roots. The environment may host other agents too.</p>
    </div>
  )
}

function SetupPromptPane({ setupPrompt, copiedPrompt, onCopyPrompt }: {
  setupPrompt: string
  copiedPrompt: boolean
  onCopyPrompt(): void
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-4 text-(--muted)">Paste this into a chat with the agent on this machine. It runs the connection command for you and keeps it alive.</p>
      <div className="rounded-lg border border-(--border) bg-(--background) p-2.5"><pre className="whitespace-pre-wrap wrap-break-word px-0.5 font-mono text-[11px] leading-4 text-(--foreground)">{setupPrompt}</pre></div>
      <Button variant="secondary" size="sm" onClick={onCopyPrompt} className="gap-1.5">{copiedPrompt ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy prompt</>}</Button>
    </div>
  )
}

function ConnectMachineFields({ command, environmentBusy, onBeginConnection, setupMode, onSetupModeChange, setupPrompt, copiedPrompt, onCopyPrompt, copied, onCopyCommand, setupEnvironment }: {
  command: string
  environmentBusy: string | null
  onBeginConnection(): void
  setupMode: 'paste' | 'manual'
  onSetupModeChange(mode: 'paste' | 'manual'): void
  setupPrompt: string
  copiedPrompt: boolean
  onCopyPrompt(): void
  copied: boolean
  onCopyCommand(): void
  setupEnvironment?: AgentEnvironmentResource
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-(--foreground)">Connect any computer, VPS, or sandbox</p>
        <p className="mt-1 text-[11px] leading-4 text-(--muted)">Outbound-only. No inbound port is opened.</p>
      </div>
      {!command ? (
        <Button variant="secondary" size="sm" disabled={environmentBusy !== null} onClick={onBeginConnection}>{environmentBusy === 'connect' ? 'Creating…' : 'Create connection'}</Button>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-(--surface-subtle) p-1" role="radiogroup" aria-label="Setup mode">
            <Button variant="ghost" type="button" role="radio" aria-checked={setupMode === 'paste'} onClick={() => onSetupModeChange('paste')} className={unstyledButton(`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'paste' ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs' : 'text-(--muted) hover:text-(--foreground)'}`)}><Sparkles size={12} /> Automatic setup</Button>
            <Button variant="ghost" type="button" role="radio" aria-checked={setupMode === 'manual'} onClick={() => onSetupModeChange('manual')} className={unstyledButton(`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'manual' ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs' : 'text-(--muted) hover:text-(--foreground)'}`)}><Terminal size={12} /> Manual setup</Button>
          </div>
          {setupMode === 'paste' ? (
            <SetupPromptPane setupPrompt={setupPrompt} copiedPrompt={copiedPrompt} onCopyPrompt={onCopyPrompt} />
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--background) p-2"><code className="min-w-0 flex-1 overflow-x-auto px-1 text-[11px] text-(--foreground)">{command}</code><Button variant="ghost" type="button" aria-label="Copy connection command" onClick={onCopyCommand} className={unstyledButton(`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}>{copied ? <Check size={14} /> : <Copy size={14} />}</Button></div>
          )}
        </div>
      )}
      {command && !setupEnvironment ? <p className="flex items-center gap-2 text-[11px] text-(--muted)"><Loader2 size={13} className="animate-spin" /> Waiting for the host to connect…</p> : null}
    </div>
  )
}

function EnvironmentChoiceButton({ active, icon, label, description, disabled = false, onClick }: {
  active: boolean
  icon: ReactNode
  label: string
  description?: string
  disabled?: boolean
  onClick(): void
}) {
  return (
    <OptionRow checked={active} onSelect={onClick} icon={icon} label={label} description={description} disabled={disabled} />
  )
}

export function EnvironmentApprovalPanel({
  environment,
  roots,
  busy,
  onRootsChange,
  onApprove,
}: {
  environment: AgentEnvironmentResource
  roots: string
  busy: boolean
  onRootsChange(value: string): void
  onApprove(): void
}) {
  return (
    <div className='mt-4 space-y-3 border-t border-(--border) pt-4'>
      <div className='flex items-center gap-2 text-xs text-(--foreground)'>
        <ShieldCheck size={15} className='text-(--muted)' /> Verify phrase:{' '}
        <strong>{environment.verificationPhrase ?? 'waiting…'}</strong>
      </div>
      <label className='block text-xs font-medium'>
        Approved project roots
        <Textarea
          value={roots}
          onChange={(event) => onRootsChange(event.target.value)}
          placeholder={
            environment.kind === 'overlay_cloud'
              ? '/workspace'
              : '/Users/you/Projects'
          }
          className={unstyledTextarea(`mt-1.5 min-h-20 w-full resize-y rounded-lg border border-(--border) bg-(--background) px-3 py-2 text-sm text-(--foreground) outline-hidden focus:border-(--muted)`)}
        />
      </label>
      <p className='text-[11px] leading-4 text-(--muted)'>
        Overlay can dispatch work only inside these explicit roots. You can
        change or revoke access later.
      </p>
      <Button
        variant='secondary'
        size='sm'
        disabled={busy || !environment.verificationPhrase}
        onClick={onApprove}
      >
        {busy ? 'Approving…' : 'Approve and continue'}
      </Button>
    </div>
  )
}
