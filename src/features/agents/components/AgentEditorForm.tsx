'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronDown, Copy, Laptop, Loader2, Lock, Monitor, Server, ShieldCheck, Sparkles, Terminal, Trash2, Users } from 'lucide-react'
import { Button, Input, ListboxSelect, Toggle } from '@overlay/ui/primitives'
import type { Computer, ComputerSize, WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { Creature, CREATURE_SHAPES } from '@/components/orb/Creature'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type { WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import { generatedAgentSetupPrompt } from '../lib/byo-agent-setup'

export const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']
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
      <span className={`relative mt-0.5 h-4 w-4 shrink-0 rounded-full border ${checked ? 'border-[var(--foreground)]' : 'border-[var(--muted-light)]'}`}>
        {checked ? <span className="absolute inset-[3px] rounded-full bg-[var(--foreground)]" /> : null}
      </span>
      {icon ? <span className="mt-0.5 shrink-0 text-[var(--muted)]">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--foreground)]">{label}</span>
        {description ? <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{description}</span> : null}
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
        {description ? <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">{description}</p> : null}
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
          label="Overlay agent"
          description="Models, tools, and memory managed by Overlay. Best for research, writing, and operations."
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
      <p className="text-xs font-medium text-[var(--foreground)]">Danger zone</p>
      <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Archiving removes {agentName} from rooms and teams. Its message history remains.</p>
      <Button variant="danger" size="sm" className="mt-3" onClick={onArchive} disabled={busy}>Archive agent</Button>
    </section>
  )
}

export function AccessSelector({ value, onChange }: { value: WorkspaceAgentVisibility; onChange(value: WorkspaceAgentVisibility): void }) {
  return (
    <div>
      <p className="text-xs font-medium">Access</p>
      <div className="mt-1.5 space-y-2" role="radiogroup" aria-label="Agent access">
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
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">{value === 'creator' ? 'Hidden from everyone else — reported as not found.' : 'Everyone in this workspace can see, chat with, or @-mention this agent.'}</p>
    </div>
  )
}

const COMPUTER_SIZE_OPTIONS = [
  { value: 'small', label: 'Small · 2 vCPU, 4 GB' },
  { value: 'default', label: 'Default · 4 vCPU, 8 GB' },
  { value: 'large', label: 'Large · 8 vCPU, 16 GB' },
] as const

export function AgentComputerSection({ enabled, onEnabledChange, size, onSizeChange, computer, openBusy, lifecycleBusy, onOpenDesktop, onTogglePower, onDelete, disabled }: {
  enabled: boolean
  onEnabledChange(next: boolean): void
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
  return (
    <div>
      <p className="text-xs font-medium">Computer</p>
      <div className="mt-1.5 space-y-3">
        <div className="rounded-xl border border-[var(--border)] px-3">
          <ToggleRow
            checked={enabled}
            onChange={onEnabledChange}
            disabled={disabled}
            label="Give this agent a computer"
            description="A persistent cloud desktop it keeps between sessions — files, signed-in apps, and a live screen you can watch."
          />
        </div>
        {enabled && !computer ? (
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
        ) : null}
        {computer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]"><Monitor size={13} className="shrink-0 text-[var(--muted)]" />{computer.name ?? 'Computer'}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">{computer.status} · {computer.size} · size is fixed once provisioned</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {computer.status === 'ready' ? (
                <Button variant="secondary" size="sm" onClick={onOpenDesktop} disabled={openBusy || lifecycleBusy !== null}>
                  {openBusy ? 'Opening…' : 'Open desktop'}
                </Button>
              ) : null}
              {computer.status === 'ready' || computer.status === 'stopped' ? (
                <Button variant="secondary" size="sm" onClick={onTogglePower} disabled={lifecycleBusy !== null || openBusy}>
                  {lifecycleBusy === 'stop' ? 'Stopping…' : lifecycleBusy === 'start' ? 'Starting…' : computer.status === 'ready' ? 'Stop' : 'Start'}
                </Button>
              ) : null}
              {computer.status === 'ready' || computer.status === 'stopped' || computer.status === 'error' ? (
                <Button variant="secondary" size="sm" onClick={onDelete} disabled={lifecycleBusy !== null || openBusy} aria-label="Delete computer">
                  {lifecycleBusy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {enabled && !computer ? (
          <p className="text-[11px] leading-4 text-[var(--muted)]">Created when you save. Grant the Computer tool group above so the agent can use it. Also managed under Settings → Computers.</p>
        ) : null}
        {!enabled && computer ? (
          <p className="text-[11px] leading-4 text-[var(--muted)]">Saving deletes this computer and its disk permanently.</p>
        ) : null}
      </div>
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
    <div>
      <p className="text-xs font-medium">Identity</p>
      <div className="mt-2 flex items-start gap-3">
        <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center">
          <Creature shape={shape} color={color} size={72} label="Agent avatar preview" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <label className="block text-xs font-medium">
            Agent name
            <Input autoFocus className="mt-1.5" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={namePlaceholder} />
          </label>
          <label className="block text-xs font-medium">
            Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
            <Input className="mt-1.5" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder={descriptionPlaceholder} />
          </label>
        </div>
      </div>
      <p className="mt-4 text-xs font-medium">Shape</p>
      <div className="mt-1.5 grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Avatar shape">
        {CREATURE_SHAPES.map((creatureShape) => (
          <button
            key={creatureShape}
            type="button"
            role="radio"
            aria-checked={shape === creatureShape}
            aria-label={`Use ${creatureShape} shape`}
            onClick={() => onShapeChange(creatureShape)}
            className={`flex h-11 items-center justify-center rounded-md border transition-colors ${shape === creatureShape ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}
          >
            <Creature shape={creatureShape} color={color} size={26} animated={false} label="" />
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs font-medium">Color</p>
      <div className="mt-1.5 flex items-center gap-3" role="radiogroup" aria-label="Avatar color">
        {AVATAR_COLORS.map((avatarColor) => (
          <button
            key={avatarColor}
            type="button"
            role="radio"
            aria-checked={color === avatarColor}
            aria-label={`Use ${avatarColor}`}
            onClick={() => onChange(avatarColor)}
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${color === avatarColor ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}
          >
            <Creature shape={shape} color={avatarColor} size={24} animated={false} label="" />
          </button>
        ))}
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

export function AgentBehaviorFields({ agentType, connectedAgentsEnabled, computersAvailable, instructions, onInstructionsChange, modelId, onModelChange, modelOptions, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, adapterId, harnessOptions, onHarnessChange, environmentChoice, onEnvironmentChoiceChange, compatibleEnvironments, environmentsLoading, environmentId, onEnvironmentChange, workingDirectory, onWorkingDirectoryChange, selectedHarnessConnectable, environmentBusy, environmentError, command, copied, onCopyCommand, onBeginConnection, setupEnvironment, setupRoots, onSetupRootsChange, onApproveSetup }: {
  agentType: AgentType
  connectedAgentsEnabled: boolean
  computersAvailable: boolean
  instructions: string
  onInstructionsChange(value: string): void
  modelId: string
  onModelChange(value: string): void
  modelOptions: Array<{ value: string; label: string }>
  enabledToolGroups: Set<string>
  onToggleToolGroup(groupId: string): void
  advanced: boolean
  onAdvancedChange(value: boolean): void
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

export function OverlayAgentFields({ instructions, onInstructionsChange, modelId, onModelChange, modelOptions, enabledToolGroups, onToggleToolGroup, advanced, onAdvancedChange, computersAvailable = true }: { instructions: string; onInstructionsChange(value: string): void; modelId: string; onModelChange(value: string): void; modelOptions: Array<{ value: string; label: string }>; enabledToolGroups: Set<string>; onToggleToolGroup(groupId: string): void; advanced: boolean; onAdvancedChange(value: boolean): void; computersAvailable?: boolean }) {
  const toolGroups = computersAvailable ? AGENT_TOOL_GROUPS : AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer')
  return (
    <>
      <label className="block text-xs font-medium">Agent instructions<textarea value={instructions} onChange={(event) => onInstructionsChange(event.target.value)} placeholder="Describe what this agent should do, how it should respond, and when it should stop." className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--muted)]" /></label>
      <label className="block text-xs font-medium">Model<ListboxSelect className="mt-1.5" aria-label="Agent model" value={modelOptions.some((option) => option.value === modelId) ? modelId : (modelOptions[0]?.value ?? modelId)} options={modelOptions.length > 0 ? modelOptions : [{ value: modelId, label: modelId }]} onChange={onModelChange} portal buttonClassName="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]" /></label>
      <div>
        <p className="text-xs font-medium">Tools</p>
        <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Grant this agent the same tools the personal chat can use. It only acts on what you enable here.</p>
        <div className="mt-1">
          {toolGroups.map((group) => (
            <ToggleRow
              key={group.id}
              checked={enabledToolGroups.has(group.id)}
              onChange={() => onToggleToolGroup(group.id)}
              label={group.label}
              description={group.description}
            />
          ))}
        </div>
      </div>
      <button type="button" onClick={() => onAdvancedChange(!advanced)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">Advanced <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} /></button>
      {advanced ? <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] leading-4 text-[var(--muted)]">Mention-first is enforced. One-to-one agent DMs invoke implicitly; channels and group DMs require a human mention or reply in the agent’s thread.</div> : null}
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
        <p className="text-xs font-medium">Harness</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Choose the coding agent Overlay will invoke.</p>
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
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="Agent environment">
          <EnvironmentChoiceButton active={choice === 'existing'} icon={<Server size={15} />} label="Existing environment" description="Pick an already-connected computer, VPS, or sandbox." onClick={() => onChoiceChange('existing')} />
          <EnvironmentChoiceButton active={choice === 'connect'} icon={<Laptop size={15} />} label="Connect a new machine" description="Outbound-only. No inbound port is opened." disabled={!selectedHarnessConnectable} onClick={() => onChoiceChange('connect')} />
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

export function EnvironmentApprovalPanel({ environment, roots, busy, onRootsChange, onApprove }: { environment: AgentEnvironmentResource; roots: string; busy: boolean; onRootsChange(value: string): void; onApprove(): void }) {
  return <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4"><div className="flex items-center gap-2 text-xs text-[var(--foreground)]"><ShieldCheck size={15} className="text-[var(--muted)]" /> Verify phrase: <strong>{environment.verificationPhrase ?? 'waiting…'}</strong></div><label className="block text-xs font-medium">Approved project roots<textarea value={roots} onChange={(event) => onRootsChange(event.target.value)} placeholder={environment.kind === 'overlay_cloud' ? '/workspace' : '/Users/you/Projects'} className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--muted)]" /></label><p className="text-[11px] leading-4 text-[var(--muted)]">Overlay can dispatch work only inside these explicit roots. You can change or revoke access later.</p><Button variant="secondary" size="sm" disabled={busy || !environment.verificationPhrase} onClick={onApprove}>{busy ? 'Approving…' : 'Approve and continue'}</Button></div>
}

export function parseRoots(value: string) {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}
