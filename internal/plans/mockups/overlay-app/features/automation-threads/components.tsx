import { useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronRight, CircleAlert, CirclePlay, Clock, MessageCircleQuestion, Trash2 } from 'lucide-react'
import {
  Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Command, CommandGroup, CommandItem, CommandList, Input,
  Popover, PopoverContent, PopoverTrigger, SidebarMenu, SidebarMenuSubButton, SidebarMenuSubItem, Switch,
} from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { ChatModelPicker } from '@overlay/chat-react'
import { RightSidebar, RightSidebarToggle } from '@overlay/modules-react/shell'
import { AgentCreature } from '@/components/orb/Creature'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useWorkspaceTextModelAccess } from '@/components/providers/useWorkspaceTextModelAccess'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'
import { MODEL_RECOMMENDATIONS, getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { AGENTS } from '../../fixtures/agents'
import {
  DEFAULT_MODEL, DEFAULT_SCHEDULE, FREQUENCIES, TIMEZONES, WEEKDAYS, automationForConversation, createAutomation, deleteAutomation,
  formatWhen, latestRun, nextRunLabel, retryRun, runNow, scheduleLabel, sendFollowUp, timezoneLabel, updateAutomation, useAutomations,
  type Automation, type Run, type Schedule,
} from './fixtures'

// Automations as threads (proposal). The chat route, composer, transcript and right panel frame are production; this
// file adds the schedule and agent pickers to the composer, the Automation details panel and the sidebar rows.

const OVERLAY = AGENTS.find((agent) => agent.agentRole === 'workspace_chief')!
const PICKABLE_AGENTS = AGENTS.filter((agent) => !agent.isDefault)
const agentFor = (agentId: string | null) => PICKABLE_AGENTS.find((agent) => agent.id === agentId)

/** No agent is a plain Overlay chat, shown with the Overlay mark; an agent shows its creature. */
function AutomationAvatar({ agentId, size = 16 }: { agentId: string | null; size?: number }) {
  const agent = agentFor(agentId)
  return agent ? <AgentCreature agent={agent} size={size} /> : <AgentCreature agent={OVERLAY} isDefault size={size} />
}

function useAutomationRoute() {
  const pathname = usePathname() ?? ''
  const conversationId = useSearchParams()?.get('id') ?? null
  return { onAutomations: resolveWorkspaceSurface(pathname) === 'automations', conversationId }
}

function useOpenAutomation() {
  const router = useRouter()
  const buildHref = useWorkspaceHref()
  const { activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope()
  return (conversationId: string | null) => router.push(buildHref(activeWorkspaceId, conversationId ? '/app/automations?id=' + conversationId : '/app/automations', scope))
}

/** A tiny shared store, for the new automation's picks and whether the details panel is open. */
function createStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) { value = next; listeners.forEach((listener) => listener()) },
    use: () => useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => value),
  }
}
const draft = createStore({ schedule: DEFAULT_SCHEDULE, agentId: null as string | null })
const panel = createStore(typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches)

// Pickers that sit beside the composer's model control and share its trigger style.

const COMPOSER_TRIGGER = 'flex h-9 min-w-0 max-w-44 items-center gap-1.5 rounded-lg px-2.5 text-left text-xs leading-none text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)'

function ComposerPicker({ label, tooltip, icon, width, children }: { label: string; tooltip: string; icon: ReactNode; width: string; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <DelayedTooltip label={tooltip} side="top">
      <PopoverTrigger asChild>
        <Button variant="ghost" type="button" aria-label={tooltip + ': ' + label} className={unstyledButton(COMPOSER_TRIGGER + ' shrink-0 max-sm:w-8 max-sm:justify-center max-sm:gap-0 max-sm:px-0')}>
          {icon}<span className="truncate max-sm:hidden">{label}</span>
        </Button>
      </PopoverTrigger>
    </DelayedTooltip>
    <PopoverContent align="end" side="top" className={'max-w-[calc(100vw-2rem)] p-1 ' + width}>{children(() => setOpen(false))}</PopoverContent>
  </Popover>
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]

function ScheduleFields({ value, onChange, showTimezone }: { value: Schedule; onChange(next: Schedule): void; showTimezone: boolean }) {
  const set = (patch: Partial<Schedule>) => onChange({ ...value, ...patch })
  return <div className="grid">
    <div role="radiogroup" aria-label="Repeats" className="grid">
      {FREQUENCIES.map(([frequency, text]) => <Button key={frequency} type="button" variant="ghost" size="sm" role="radio" aria-checked={value.frequency === frequency} onClick={() => set({ frequency })}
        className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal text-(--foreground)">
        <span className="flex-1 text-left">{text}</span>{value.frequency === frequency ? <Check size={14} /> : null}
      </Button>)}
    </div>
    <div className="mt-1 grid gap-2.5 border-t border-(--border) px-2 pb-1.5 pt-2.5">
      {value.frequency === 'weekly' ? <div role="radiogroup" aria-label="Day" className="flex justify-between">
        {MONDAY_FIRST.map((day) => <Button key={day} type="button" size="icon-xs" variant={value.weekday === day ? 'secondary' : 'ghost'} role="radio" aria-checked={value.weekday === day} aria-label={WEEKDAYS[day]} onClick={() => set({ weekday: day })}
          className="size-7 text-xs font-normal">{WEEKDAYS[day]![0]}</Button>)}
      </div> : null}
      {value.frequency === 'monthly' ? <label className="flex items-center justify-between gap-3 text-xs text-(--muted)">Day of the month
        <Input type="number" min={1} max={28} value={value.monthDay} onChange={(event) => set({ monthDay: Math.min(28, Math.max(1, Number(event.target.value) || 1)) })} className="h-8 w-16 text-sm" />
      </label> : null}
      {value.frequency !== 'hourly' ? <label className="flex items-center justify-between gap-3 text-xs text-(--muted)">Time
        <Input type="time" value={value.time} onChange={(event) => { if (event.target.value) set({ time: event.target.value }) }} className="h-8 w-32 text-sm" />
      </label> : null}
      {showTimezone ? <p className="text-[11px] text-(--muted-light)">{timezoneLabel(value.timezone)}</p> : null}
    </div>
  </div>
}

function AgentOptions({ value, onChange }: { value: string | null; onChange(next: string | null): void }) {
  return <Command><CommandList>
    <CommandItem value="No agent" onSelect={() => onChange(null)}>
      <AutomationAvatar agentId={null} size={18} /><span className="flex-1 truncate">No agent</span>{!value ? <Check size={14} /> : null}
    </CommandItem>
    <CommandGroup heading="Agents">
      {PICKABLE_AGENTS.map((agent) => <CommandItem key={agent.id} value={agent.name + ' ' + agent.id} onSelect={() => onChange(agent.id)}>
        <AgentCreature agent={agent} size={18} /><span className="flex-1 truncate">{agent.name}</span>{agent.id === value ? <Check size={14} /> : null}
      </CommandItem>)}
    </CommandGroup>
  </CommandList></Command>
}

/** Schedule and Agent, placed in the production composer's control row on the Automations route. */
export function AutomationComposerPickers() {
  const route = useAutomationRoute()
  const picks = draft.use()
  const automations = useAutomations()
  if (!route.onAutomations) return null
  const automation = automations.find((entry) => entry.conversationId === route.conversationId)
  if (route.conversationId && !automation) return null
  const schedule = automation?.schedule ?? picks.schedule
  const agentId = automation ? automation.agentId : picks.agentId
  const change = (patch: Partial<{ schedule: Schedule; agentId: string | null }>) => automation
    ? updateAutomation(automation.id, (current) => ({ ...current, ...patch }))
    : draft.set({ ...picks, ...patch })
  return <>
    <ComposerPicker tooltip="Schedule" label={scheduleLabel(schedule)} icon={<Clock size={14} className="shrink-0" />} width="w-64">
      {() => <ScheduleFields value={schedule} onChange={(next) => change({ schedule: next })} showTimezone />}
    </ComposerPicker>
    <ComposerPicker tooltip="Agent" label={agentFor(agentId)?.name ?? 'No agent'} icon={<AutomationAvatar agentId={agentId} />} width="w-56">
      {(close) => <AgentOptions value={agentId} onChange={(next) => { change({ agentId: next }); close() }} />}
    </ComposerPicker>
  </>
}

type ComposerHooks = { textareaRef: RefObject<{ getPlainText(): string; clear(): void } | null>; onInputChange(text: string): void; onSend(): void | Promise<void>; placeholder?: string }

/** On the Automations route, sending creates the automation (new) or adds a follow-up to its thread. */
export function useAutomationComposer<P extends ComposerHooks>(props: P): P {
  const route = useAutomationRoute()
  const open = useOpenAutomation()
  const scope = usePanelScope()
  useAutomations()
  if (!route.onAutomations) return props
  const automation = automationForConversation(route.conversationId)
  // The composer keeps its text in the editor, so read it from there like the chat's own send does.
  const take = () => {
    const text = props.textareaRef.current?.getPlainText().trim() ?? ''
    if (text) { props.textareaRef.current?.clear(); props.onInputChange('') }
    return text
  }
  if (automation) {
    return { ...props, onSend: () => {
      const text = take()
      if (text) sendFollowUp(automation.id, text)
    } }
  }
  if (route.conversationId) return props
  return { ...props, placeholder: 'What should run on a schedule?', onSend: () => {
    const instructions = take()
    if (!instructions) return
    const { schedule, agentId } = draft.get()
    const created = createAutomation({ scope, schedule, agentId, modelId: composerModel, instructions })
    draft.set({ schedule: DEFAULT_SCHEDULE, agentId: null })
    open(created.conversationId)
  } }
}

// The Automation details panel, in the agent thread's right sidebar.

/** The name in the panel's hero, edited in place like an agent's name. */
function InlineName({ value, onCommit }: { value: string; onCommit(next: string): void }) {
  const [draftName, setDraftName] = useState<string | null>(null)
  const editing = useRef(false)
  const finish = (commit: boolean) => {
    if (!editing.current) return
    editing.current = false
    if (commit && draftName?.trim() && draftName.trim() !== value) onCommit(draftName.trim())
    setDraftName(null)
  }
  if (draftName === null) {
    return <Button variant="ghost" type="button" aria-label="Edit automation name" onClick={() => { editing.current = true; setDraftName(value) }}
      className="h-auto max-w-full rounded-md px-2 py-0.5 text-lg font-medium leading-6 text-(--foreground) hover:bg-(--surface-subtle)">
      <span className="line-clamp-2">{value}</span>
    </Button>
  }
  return <Input autoFocus aria-label="Automation name" value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={() => finish(true)}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
      else if (event.key === 'Enter') { event.preventDefault(); finish(true) }
    }}
    className="h-8 text-center text-lg font-medium" />
}

function DetailsDisclosure({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  return <Collapsible>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" type="button" className="group/details-disclosure h-8 w-full justify-start rounded-md px-1 text-left text-xs font-medium text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)">
        <span className="shrink-0">{label}</span>
        {summary ? <span className="ml-auto min-w-0 flex-1 truncate pl-3 text-right font-normal text-(--muted-light) group-data-[state=open]/details-disclosure:hidden">{summary}</span> : null}
        <ChevronRight size={14} className={'shrink-0 transition-transform duration-200 group-data-[state=open]/details-disclosure:rotate-90 ' + (summary ? 'ml-2 group-data-[state=open]/details-disclosure:ml-auto' : 'ml-auto')} />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
  </Collapsible>
}

function ModelField({ automation }: { automation: Automation }) {
  const { activeWorkspaceId } = useWorkspace()
  const { capabilities } = useOverlayCapabilities()
  const { settings } = useAppSettings()
  const { user } = useAuth()
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const access = useWorkspaceTextModelAccess({ activeWorkspaceId, billingEnabled: capabilities.billing === true, catalogRevision: revision, onlyAllowZdrModels: settings.onlyAllowZdrModels })
  const label = modelName(automation.modelId, access.pickerTextModels)
  return <DetailsDisclosure label="Model" summary={label}>
    <ChatModelPicker
      placement="field"
      modelPickerLabel={label}
      selectableTextModels={access.pickerTextModels}
      selectedActModel={automation.modelId}
      onToggleTextModel={(modelId) => updateAutomation(automation.id, (current) => ({ ...current, modelId }))}
      favoriteScope={user?.id ?? null}
      modelRecommendations={MODEL_RECOMMENDATIONS}
      textModelsLoading={access.connectionsLoading}
      generationMode="text"
      lockedGenerationMode="text"
    />
  </DetailsDisclosure>
}

function modelName(modelId: string, models: Array<{ id: string; name: string }>) {
  return models.find((model) => model.id === modelId)?.name ?? getModelsByIntelligence().find((model) => model.id === modelId)?.name ?? modelId
}

const RUN_LABELS: Record<Run['status'], string> = { completed: 'Completed', failed: 'Failed', waiting: 'Waiting for you' }

function RunRow({ automation, run }: { automation: Automation; run: Run }) {
  const Icon = run.status === 'failed' ? CircleAlert : run.status === 'waiting' ? MessageCircleQuestion : Check
  const tone = run.status === 'failed' ? 'failed' : run.status === 'waiting' ? 'needs_input' : undefined
  return <li className="flex h-8 items-center gap-2 px-1 text-xs">
    <span className="agent-thread-status" data-status={tone}><Icon size={13} aria-hidden /></span>
    <span className="min-w-0 flex-1 truncate text-(--foreground)">{formatWhen(run.at)}</span>
    {run.status === 'failed'
      ? <Button type="button" variant="ghost" size="xs" onClick={() => retryRun(automation.id, run.id)} className="h-6 px-2 text-(--muted)">Retry</Button>
      : <span className={'agent-activity-count shrink-0 ' + (run.status === 'completed' ? 'text-(--muted-light)' : '')} data-status={tone}>{RUN_LABELS[run.status]}</span>}
  </li>
}

function AutomationDetails({ automation }: { automation: Automation }) {
  const open = useOpenAutomation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<Automation>) => updateAutomation(automation.id, (current) => ({ ...current, ...patch }))
  const agent = agentFor(automation.agentId)
  const runs = automation.runs.slice(-5).reverse()
  return <div className="space-y-[22px]">
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-(--foreground)">{automation.enabled ? 'Active' : 'Paused'}</p>
          <p className="mt-0.5 text-xs text-(--muted)">{automation.enabled ? 'Next run: ' + nextRunLabel(automation) : 'Runs are off until you turn them back on'}</p>
        </div>
        <Switch checked={automation.enabled} aria-label="Enabled" onCheckedChange={(enabled) => set({ enabled })} />
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => runNow(automation.id)} className="w-full gap-1.5">
        <CirclePlay size={14} />Run now
      </Button>
    </div>
    <DetailsDisclosure label="Schedule" summary={scheduleLabel(automation.schedule)}>
      <ScheduleFields value={automation.schedule} onChange={(schedule) => set({ schedule })} showTimezone={false} />
    </DetailsDisclosure>
    <DetailsDisclosure label="Time zone" summary={timezoneLabel(automation.schedule.timezone)}>
      <Command><CommandList>
        {TIMEZONES.map((timezone) => <CommandItem key={timezone} value={timezone} onSelect={() => set({ schedule: { ...automation.schedule, timezone } })}>
          <span className="flex-1 truncate">{timezoneLabel(timezone)}</span>{automation.schedule.timezone === timezone ? <Check size={14} /> : null}
        </CommandItem>)}
      </CommandList></Command>
    </DetailsDisclosure>
    <DetailsDisclosure label="Agent" summary={agent?.name ?? 'No agent'}>
      <AgentOptions value={automation.agentId} onChange={(agentId) => set({ agentId })} />
    </DetailsDisclosure>
    <ModelField automation={automation} />
    <section aria-label="Recent runs">
      <h3 className="flex h-8 items-center px-1 text-xs font-medium text-(--muted)">Recent runs</h3>
      {runs.length ? <ul>{runs.map((run) => <RunRow key={run.id} automation={automation} run={run} />)}</ul>
        : <p className="px-1 text-xs text-(--muted-light)">No runs yet</p>}
    </section>
    <div className="border-t border-(--border) pt-3">
      {confirmDelete ? <div className="flex items-center gap-2 px-1 text-xs text-(--muted)">
        <span className="flex-1">Delete this automation and its chat?</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
        <Button type="button" variant="ghost" size="xs" className="text-red-600 hover:text-red-600 dark:text-red-400" onClick={() => { deleteAutomation(automation.id); open(null) }}>Delete</Button>
      </div> : <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="h-8 gap-1.5 px-1 text-xs font-normal text-(--muted) hover:text-red-600 dark:hover:text-red-400">
        <Trash2 size={14} />Delete automation
      </Button>}
    </div>
  </div>
}

type ShellProps = {
  rightPanel: ReactNode
  rightPanelOpen: boolean
  rightPanelWidth?: number
  rightPanelMode?: 'docked' | 'floating'
  onRightPanelClose?: () => void
  onRightPanelResize?: (width: number) => void
}

/** An automation's chat docks the Automation panel where agent threads dock theirs, with the same toggle and width. */
type HeaderModel = {
  renderExportMenu: () => ReactNode
  titleLabel: string
  selectedActModel: string
  modelPickerLabel: string
  selectableTextModels: Array<{ id: string; name: string }>
  onToggleTextModel: (modelId: string) => void
}

/** The model the new-automation composer shows, read when the automation is created. */
let composerModel = DEFAULT_MODEL

export function useAutomationShell<S extends ShellProps, H extends HeaderModel>(chatId: string | null, shell: S, headerProps: H): { shell: S; headerProps: H } {
  const open = panel.use()
  const route = useAutomationRoute()
  useAutomations()
  if (!route.onAutomations) return { shell, headerProps }
  const automation = automationForConversation(chatId)
  if (!automation) {
    if (chatId) return { shell, headerProps }
    composerModel = headerProps.selectedActModel
    return { shell, headerProps: { ...headerProps, titleLabel: 'New automation' } }
  }
  const close = () => panel.set(false)
  return {
    shell: {
      ...shell,
      rightPanel: open ? <RightSidebar
        ariaLabel="Automation sidebar"
        hero={{
          avatar: <AutomationAvatar agentId={automation.agentId} size={64} />,
          title: <InlineName value={automation.name} onCommit={(name) => updateAutomation(automation.id, (current) => ({ ...current, name }))} />,
          titleText: automation.name,
          subtitle: scheduleLabel(automation.schedule),
        }}
        tabs={[{ id: 'automation', label: 'Automation', content: <AutomationDetails automation={automation} /> }]}
        activeTab="automation"
        onTabChange={() => {}}
        onClose={close}
      /> : shell.rightPanel,
      rightPanelOpen: open || shell.rightPanelOpen,
      rightPanelWidth: open ? 380 : shell.rightPanelWidth,
      rightPanelMode: open ? 'docked' : shell.rightPanelMode,
      onRightPanelClose: open ? close : shell.onRightPanelClose,
    },
    headerProps: {
      ...headerProps,
      // The composer's model is the automation's model, the same value as the panel's Model row.
      selectedActModel: automation.modelId,
      modelPickerLabel: modelName(automation.modelId, headerProps.selectableTextModels),
      onToggleTextModel: (modelId: string) => {
        updateAutomation(automation.id, (current) => ({ ...current, modelId }))
        headerProps.onToggleTextModel(modelId)
      },
      renderExportMenu: () => <>{headerProps.renderExportMenu()}<RightSidebarToggle open={open} onToggle={() => panel.set(!open)} /></>,
    },
  }
}

/** The contextual panel: one row per automation, in the agent thread row style. */
export function AutomationThreadsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const scope = usePanelScope()
  const open = useOpenAutomation()
  const activeId = useSearchParams()?.get('id')
  const automations = useAutomations().filter((automation) => automation.scope === scope)
  if (!automations.length) return <p className="px-2.5 py-2 text-xs text-(--muted-light)">No automations yet</p>
  return <SidebarMenu aria-label="Automations">
    {automations.map((automation) => {
      const active = automation.conversationId === activeId
      const status = latestRun(automation)?.status
      return <SidebarMenuSubItem key={automation.id}>
        <SidebarMenuSubButton isActive={active} aria-current={active ? 'page' : undefined} title={automation.name} onClick={() => { open(automation.conversationId); onNavigate?.() }}
          className="min-w-0 gap-[7px] font-normal data-[active=true]:font-normal">
          <AutomationAvatar agentId={automation.agentId} />
          <span className="flex-1 truncate">{automation.name}</span>
          {!automation.enabled ? <span className="text-[10px] text-(--muted-light)">Paused</span>
            : <ThreadActivityIndicator status={status === 'waiting' ? 'needs_input' : status === 'failed' ? 'failed' : undefined} />}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    })}
  </SidebarMenu>
}
