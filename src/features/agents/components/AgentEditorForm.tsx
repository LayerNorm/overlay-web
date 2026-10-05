'use client'

import { Fragment, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { Bot, Check, ChevronDown, Copy, Hash, Laptop, Loader2, Lock, Monitor, Plus, Server, ShieldCheck, Sparkles, Terminal, Trash2, Users } from 'lucide-react'
import { Button, Input, ListboxSelect, Textarea, Toggle } from '@overlay/ui/primitives'
import type { Computer, ComputerSize, SurfaceBinding, SurfaceChannelOption, SurfaceConnection, WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type { WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import { generatedAgentSetupPrompt } from '../lib/byo-agent-setup'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { AgentAvatarPicker } from './AgentAvatarPicker'
import { FieldLabel } from './InfoTip'
import type { SurfaceChannelPicker } from './use-agent-surfaces'

export type AgentType = 'overlay' | 'byo'
export type EnvironmentChoice = 'existing' | 'connect'

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
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={labelledBy ?? label}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'border-[var(--muted)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}
    >
      <span
        className={`relative mt-0.5 h-4 w-4 shrink-0 rounded-full border ${checked ? 'border-[var(--foreground)]' : 'border-[var(--muted-light)]'}`}
      >
        {checked ? (
          <span className='absolute inset-[3px] rounded-full bg-[var(--foreground)]' />
        ) : null}
      </span>
      {icon ? (
        <span className='mt-0.5 shrink-0 text-[var(--muted)]'>{icon}</span>
      ) : null}
      <span className="min-w-0">
        <span className='block text-xs font-medium text-[var(--foreground)]'>
          {label}
        </span>
        {description ? (
          <span className='mt-0.5 block text-[11px] leading-4 text-[var(--muted)]'>
            {description}
          </span>
        ) : null}
      </span>
    </button>
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
    <div className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--foreground)]">{label}</p>
        {description ? (
          <p className='mt-0.5 text-[11px] leading-4 text-[var(--muted)]'>
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
          description="Runs on Overlay Cloud — pick a runtime below. No machines to connect."
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
export function AgentMemoriesSection({ agentPrincipalId }: { agentPrincipalId: string }) {
  const [rows, setRows] = useState<AgentMemoryRow[] | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <Loader2 size={12} className="animate-spin" /> Loading memories…
      </div>
    )
  }
  if (rows.length === 0) return null

  const preview = rows.slice(0, MEMORY_PREVIEW_COUNT)
  return (
    <div>
      <p className='text-xs font-medium'>
        Memories{' '}
        <span className='font-normal text-[var(--muted-light)]'>
          {rows.length}
        </span>
      </p>
      <div className="mt-1.5 overflow-hidden rounded-xl border border-[var(--border)]">
        {preview.map((row) => (
          <div
            key={row.memoryId}
            className="group flex items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className='truncate text-xs text-[var(--foreground)]'>
                {row.fullContent ?? row.content}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted-light)]">
                {
                  // Locale is pinned to 'en-US', so SSR and client output are identical.
                  // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
                  `${row.type ?? 'fact'} · ${new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                }
              </p>
            </div>
            {row.canDelete && (
              <button
                type="button"
                onClick={() => void remove(row.memoryId)}
                disabled={deletingId === row.memoryId}
                aria-label="Delete memory"
                className="shrink-0 text-[var(--muted-light)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-40"
              >
                {deletingId === row.memoryId ? (
                  <Loader2 size={13} className='animate-spin' />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
      <Link
        href={`/app/settings?section=memories&owner=${encodeURIComponent(agentPrincipalId)}`}
        className="mt-1.5 inline-block text-[11px] text-[var(--muted)] underline underline-offset-2 transition-colors hover:text-[var(--foreground)]"
      >
        {rows.length > MEMORY_PREVIEW_COUNT ? `View all ${rows.length} in Memories` : 'View in Memories'}
      </Link>
    </div>
  )
}

export function DangerZone({ mode, hasAgent, isDefaultMaster, busy, agentName, onArchive }: {
  mode: 'new' | 'edit'
  hasAgent: boolean
  isDefaultMaster: boolean
  busy: boolean
  agentName: string
  onArchive(): void
}) {
  if (mode !== 'edit' || !hasAgent || isDefaultMaster) return null
  return (
    <section className="rounded-xl border border-red-500/25 p-4">
      <p className='text-xs font-medium text-[var(--foreground)]'>
        Danger zone
      </p>
      <p className='mt-1 text-[11px] leading-4 text-[var(--muted)]'>
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
      <p className='mt-1.5 text-[11px] leading-4 text-[var(--muted)]'>
        {value === 'creator'
          ? 'Hidden from everyone else — reported as not found.'
          : 'Everyone in this workspace can see, chat with, or @-mention this agent.'}
      </p>
    </div>
  )
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
  lifecycleBusy: 'start' | 'stop' | 'delete' | null
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

function ProvisionedComputerCard({ computer, openBusy, lifecycleBusy, onOpenDesktop, onTogglePower, onDelete }: {
  computer: Computer
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | null
  onOpenDesktop(): void
  onTogglePower(): void
  onDelete(): void
}) {
  const canTogglePower = computer.status === 'ready' || computer.status === 'stopped'
  const canDeleteComputer = canTogglePower || computer.status === 'error'
  const powerLabel = lifecycleBusy === 'stop' ? 'Stopping…' : lifecycleBusy === 'start' ? 'Starting…' : computer.status === 'ready' ? 'Stop' : 'Start'
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]"><Monitor size={13} className="shrink-0 text-[var(--muted)]" />{computer.name ?? 'Computer'}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">{computer.status} · {computer.size} · size is fixed once provisioned</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
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

/**
 * Accessory rendered under the Computer tool-group row: the size picker while
 * unprovisioned, the provisioned machine card with lifecycle controls, and the
 * destructive-save warning. The group's own ToggleRow is the on/off control —
 * enabled means "this agent gets a computer".
 */
export function AgentComputerSection({ enabled, size, onSizeChange, computer, openBusy, lifecycleBusy, onOpenDesktop, onTogglePower, onDelete, disabled }: {
  enabled: boolean
  size: ComputerSize
  onSizeChange(next: ComputerSize): void
  computer: Computer | null
  openBusy: boolean
  lifecycleBusy: 'start' | 'stop' | 'delete' | null
  onOpenDesktop(): void
  onTogglePower(): void
  onDelete(): void
  disabled?: boolean
}) {
  if (!enabled && !computer) return null
  return (
    <div className="space-y-3 border-b border-[var(--border)] pb-3 pt-1 last:border-b-0">
      {enabled && !computer ? <ComputerSizePicker size={size} onSizeChange={onSizeChange} disabled={disabled} /> : null}
      {enabled && computer ? (
        <ProvisionedComputerCard
          computer={computer}
          openBusy={openBusy}
          lifecycleBusy={lifecycleBusy}
          onOpenDesktop={onOpenDesktop}
          onTogglePower={onTogglePower}
          onDelete={onDelete}
        />
      ) : null}
      {enabled && !computer ? (
        <p className='text-[11px] leading-4 text-[var(--muted)]'>
          Created when you save. Also managed under Settings → Computers.
        </p>
      ) : null}
      {!enabled && computer ? (
        <p className='text-[11px] leading-4 text-[var(--muted)]'>
          Saving deletes this computer and its disk permanently.
        </p>
      ) : null}
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
  agentName, hasAgent, loading, connections, bindings, canBind, canBindResolved, channelPicker, busyId, error, notice,
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
  notice: { kind: 'success' | 'error'; message: string } | null
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
        {loading ? <Loader2 size={12} className="animate-spin text-[var(--muted)]" /> : null}
      </p>
      {notice ? (
        <p className={`mt-1 text-[11px] leading-4 ${notice.kind === 'error' ? 'text-red-500' : 'text-[var(--muted)]'}`}>{notice.message}</p>
      ) : null}
      <div className="mt-1.5">
        <div className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--foreground)]">Overlay</p>
            <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">In Chats and rooms.</p>
          </div>
          <span className="shrink-0 text-[11px] text-[var(--muted)]">always on</span>
        </div>

        {slackConnections.length === 0 ? (
          <div className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--foreground)]">Slack</p>
              {canBind ? (
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">Connect a Slack workspace so people can reach {name} there.</p>
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
              <div className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--foreground)]">Slack · {connection.externalTeamName ?? 'Slack workspace'}</p>
                  {connection.status !== 'active' ? (
                    <p className="mt-0.5 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                      {connection.status === 'degraded' ? 'Connection degraded — reconnect Slack to resume.' : 'Uninstalled from Slack — reconnect to resume.'}
                    </p>
                  ) : null}
                </div>
                {canBind ? (
                  <button
                    type="button"
                    onClick={() => onToggleChannelPicker(connection.id)}
                    disabled={!hasAgent || connection.status !== 'active'}
                    className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={11} />Add channel
                  </button>
                ) : null}
              </div>

              {connectionBindings.map((binding) => (
                <div key={binding.id} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1 pl-5">
                    <p className="flex items-center gap-1 text-xs font-medium text-[var(--foreground)]">
                      <Hash size={11} className="shrink-0 text-[var(--muted)]" />{binding.channelName ?? binding.channelId}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">
                      Anyone in {binding.channelName ? `#${binding.channelName}` : 'this channel'} can reach {name} with @Overlay {name}. It acts with your access.
                    </p>
                  </div>
                  {canBind ? (
                    <button
                      type="button"
                      onClick={() => onRemoveBinding(binding.id)}
                      disabled={busyId !== null}
                      className="shrink-0 text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      {busyId === binding.id ? 'Removing…' : 'Remove'}
                    </button>
                  ) : null}
                </div>
              ))}

              {pickerOpen && channelPicker ? (
                <div className="border-b border-[var(--border)] py-2.5 pl-5 last:border-b-0">
                  {channelPicker.loading ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Loader2 size={11} className="animate-spin" />Loading channels…</p>
                  ) : channelPicker.error ? (
                    <p className="text-[11px] leading-4 text-red-500">{channelPicker.error}</p>
                  ) : pickerChannels.length === 0 ? (
                    <p className="text-[11px] leading-4 text-[var(--muted)]">No more channels to add.</p>
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
                      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
                        The bot only answers in channels it has joined — invite it with /invite @Overlay.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </Fragment>
          )
        })}

        {canBind && slackConnections.length > 0 ? (
          <div className="border-b border-[var(--border)] py-2.5 last:border-b-0">
            <button
              type="button"
              onClick={onConnectSlack}
              disabled={!hasAgent}
              className="text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              Connect another Slack workspace
            </button>
          </div>
        ) : null}

        {(['Teams', 'Discord'] as const).map((platform) => (
          <div key={platform} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 opacity-50 last:border-b-0">
            <p className="min-w-0 flex-1 text-xs font-medium text-[var(--foreground)]">{platform}</p>
            <span className="shrink-0 text-[11px] text-[var(--muted)]">coming soon</span>
          </div>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-[11px] leading-4 text-red-500">{error}</p> : null}
      {!hasAgent ? (
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">Create the agent to connect it to a surface.</p>
      ) : canBindResolved && !loading && !canBind ? (
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">Only this agent&rsquo;s creator can connect surfaces.</p>
      ) : null}
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">Threads from connected surfaces appear in Chats.</p>
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
          className="min-h-16 !resize-none"
        />
      </div>
    </div>
  )
}

export function MasterAgentNotice() {
  return (
    <p className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-xs leading-5 text-[var(--muted)]">
      Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).
    </p>
  )
}

export function AgentBehaviorFields({ agentType, connectedAgentsEnabled, computersAvailable, computer, instructions, onInstructionsChange, modelId, onModelChange, modelOptions, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, legacyHostedRuntime, adapterId, harnessOptions, onHarnessChange, environmentChoice, onEnvironmentChoiceChange, compatibleEnvironments, environmentsLoading, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange, selectedHarnessConnectable, environmentBusy, environmentError, command, copied, onCopyCommand, onBeginConnection, setupEnvironment, setupRoots, onSetupRootsChange, onApproveSetup }: {
  agentType: AgentType
  connectedAgentsEnabled: boolean
  computersAvailable: boolean
  computer?: Omit<ComponentProps<typeof AgentComputerSection>, 'enabled'>
  instructions: string
  onInstructionsChange(value: string): void
  modelId: string
  onModelChange(value: string): void
  modelOptions: Array<{ value: string; label: string }>
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
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-xs leading-5 text-[var(--muted)]">
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
        modelOptions={modelOptions}
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-xs leading-5 text-[var(--muted)]">
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

export function OverlayAgentFields({ instructions, onInstructionsChange, modelId, onModelChange, modelOptions, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, computersAvailable = true, computer }: { instructions: string; onInstructionsChange(value: string): void; modelId: string; onModelChange(value: string): void; modelOptions: Array<{ value: string; label: string }>; enabledToolGroups: Set<string>; onToggleToolGroup(groupId: string): void; advanced: boolean; onAdvancedChange(value: boolean): void; computersAvailable?: boolean; computer?: Omit<ComponentProps<typeof AgentComputerSection>, 'enabled'> }) {
  const toolGroups = computersAvailable ? AGENT_TOOL_GROUPS : AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer')
  return (
    <>
      <label className='block text-xs font-medium'>
        Agent instructions
        <textarea
          value={instructions}
          onChange={(event) => onInstructionsChange(event.target.value)}
          placeholder='Describe what this agent should do, how it should respond, and when it should stop.'
          className='mt-1.5 min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--muted)]'
        />
      </label>
      <label className='block text-xs font-medium'>
        Model
        <ListboxSelect
          className='mt-1.5'
          aria-label='Agent model'
          value={
            modelOptions.some((option) => option.value === modelId)
              ? modelId
              : (modelOptions[0]?.value ?? modelId)
          }
          options={
            modelOptions.length > 0
              ? modelOptions
              : [{ value: modelId, label: modelId }]
          }
          onChange={onModelChange}
          portal
          buttonClassName='h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]'
        />
      </label>
      <div>
        <p className="text-xs font-medium">Tools</p>
        <p className='mt-1 text-[11px] leading-4 text-[var(--muted)]'>
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
      <button
        type='button'
        onClick={() => onAdvancedChange(!advanced)}
        className='flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]'
      >
        Advanced{' '}
        <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />
      </button>
      {advanced ? (
        <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] leading-4 text-[var(--muted)]'>
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
        <p className='mt-1 text-[11px] leading-4 text-[var(--muted)]'>
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
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
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
    return <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Loader2 size={14} className="animate-spin" /> Loading environments…</p>
  }
  if (compatibleEnvironments.length === 0) {
    return (
      <div className="text-xs text-[var(--muted)]">
        <p>No connected environment currently advertises this harness.</p>
        {selectedHarnessConnectable ? <p className="mt-1">Connect a computer, VPS, or sandbox to continue.</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium">Environment<ListboxSelect className="mt-1.5" aria-label="Connected environment" value={environmentId} options={compatibleEnvironments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.status}` }))} onChange={onEnvironmentChange} portal /></label>
      <label className="block text-xs font-medium">Default working directory<Input className="mt-1.5" value={workingDirectory} onChange={(event) => onWorkingDirectoryChange(event.target.value)} placeholder="/Users/you/Projects/app" /></label>
      <p className="text-[11px] leading-4 text-[var(--muted)]">This must be inside the environment’s approved roots. The environment may host other agents too.</p>
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
      <p className="text-[11px] leading-4 text-[var(--muted)]">Paste this into a chat with the agent on this machine — it runs the connection command for you and keeps it alive.</p>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5"><pre className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words px-0.5 font-mono text-[11px] leading-4 text-[var(--foreground)]">{setupPrompt}</pre></div>
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
        <p className="text-xs font-medium text-[var(--foreground)]">Connect any computer, VPS, or sandbox</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Outbound-only. No inbound port is opened.</p>
      </div>
      {!command ? (
        <Button variant="secondary" size="sm" disabled={environmentBusy !== null} onClick={onBeginConnection}>{environmentBusy === 'connect' ? 'Creating…' : 'Create connection'}</Button>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-subtle)] p-1" role="radiogroup" aria-label="Setup mode">
            <button type="button" role="radio" aria-checked={setupMode === 'paste'} onClick={() => onSetupModeChange('paste')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'paste' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Sparkles size={12} /> Automatic setup</button>
            <button type="button" role="radio" aria-checked={setupMode === 'manual'} onClick={() => onSetupModeChange('manual')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${setupMode === 'manual' ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}><Terminal size={12} /> Manual setup</button>
          </div>
          {setupMode === 'paste' ? (
            <SetupPromptPane setupPrompt={setupPrompt} copiedPrompt={copiedPrompt} onCopyPrompt={onCopyPrompt} />
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2"><code className="min-w-0 flex-1 overflow-x-auto px-1 text-[11px] text-[var(--foreground)]">{command}</code><button type="button" aria-label="Copy connection command" onClick={onCopyCommand} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
          )}
        </div>
      )}
      {command && !setupEnvironment ? <p className="flex items-center gap-2 text-[11px] text-[var(--muted)]"><Loader2 size={13} className="animate-spin" /> Waiting for the host to connect…</p> : null}
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
    <div className='mt-4 space-y-3 border-t border-[var(--border)] pt-4'>
      <div className='flex items-center gap-2 text-xs text-[var(--foreground)]'>
        <ShieldCheck size={15} className='text-[var(--muted)]' /> Verify phrase:{' '}
        <strong>{environment.verificationPhrase ?? 'waiting…'}</strong>
      </div>
      <label className='block text-xs font-medium'>
        Approved project roots
        <textarea
          value={roots}
          onChange={(event) => onRootsChange(event.target.value)}
          placeholder={
            environment.kind === 'overlay_cloud'
              ? '/workspace'
              : '/Users/you/Projects'
          }
          className='mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]'
        />
      </label>
      <p className='text-[11px] leading-4 text-[var(--muted)]'>
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

