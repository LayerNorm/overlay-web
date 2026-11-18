import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, CircleAlert, CirclePlay, Clock, MessageCircleQuestion, Pause, Pencil, Play } from 'lucide-react'
import {
  Button, Command, CommandGroup, CommandItem, CommandList, Input, Popover, PopoverContent, PopoverTrigger,
  SidebarMenu, SidebarMenuSubButton, SidebarMenuSubItem, Switch, Textarea, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@overlay/ui/primitives'
import { unstyledButton, unstyledTextarea } from '@overlay/ui/control-reset'
import { useAutosizeTextarea } from '@overlay/ui/hooks'
import { Message, MessageContent } from '@overlay/ui/ai'
import { MarkdownMessage, PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, UserMessageBubble } from '@overlay/chat-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { AgentCreature } from '@/components/orb/Creature'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { AGENTS } from '../../fixtures/agents'
import {
  DEFAULT_SCHEDULE, FREQUENCIES, WEEKDAYS, appendEntries, automationName, createAutomation, formatWhen, nextRun,
  scheduleLabel, updateAutomation, useAutomations, type Automation, type Entry, type RunStatus, type Schedule,
} from './fixtures'

// Automations as threads (proposal). Everything here is the proposed feature; the shell around it is production.

const OVERLAY = AGENTS.find((agent) => agent.agentRole === 'workspace_chief')!
const PICKABLE_AGENTS = AGENTS.filter((agent) => !agent.isDefault)
const agentFor = (agentId: string | null) => PICKABLE_AGENTS.find((agent) => agent.id === agentId)

/** No agent is a plain Overlay chat, shown with the Overlay mark; an agent shows its creature. */
function AutomationAvatar({ agentId, size = 16, working = false }: { agentId: string | null; size?: number; working?: boolean }) {
  const agent = agentFor(agentId)
  return agent ? <AgentCreature agent={agent} size={size} working={working} /> : <AgentCreature agent={OVERLAY} isDefault size={size} working={working} />
}

function useOpenAutomation() {
  const router = useRouter()
  const buildHref = useWorkspaceHref()
  const { activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope()
  return (id: string | null) => router.push(buildHref(activeWorkspaceId, id ? '/app/automations?automationId=' + id : '/app/automations', scope))
}

// The Work composer's pill picker: a quiet ghost button that opens one popover.
function Picker({ label, tooltip, icon, side, width, children }: {
  label: string; tooltip: string; icon: ReactNode; side: 'top' | 'bottom'; width: string; children(close: () => void): ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <TooltipProvider><Popover open={open} onOpenChange={setOpen}>
    <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="sm" aria-label={tooltip + ': ' + label} className="relative h-8 min-w-0 gap-1.5 rounded-lg px-2 text-xs font-normal text-(--muted)">
        {icon}<span className="max-w-48 truncate">{label}</span>
      </Button>
    </PopoverTrigger></TooltipTrigger><TooltipContent side={side}>{tooltip}</TooltipContent></Tooltip>
    <PopoverContent align="start" side={side} className={'max-w-[calc(100vw-2rem)] p-1 ' + width}>{children(() => setOpen(false))}</PopoverContent>
  </Popover></TooltipProvider>
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]

export function SchedulePicker({ value, onChange, side = 'top' }: { value: Schedule; onChange(next: Schedule): void; side?: 'top' | 'bottom' }) {
  const set = (patch: Partial<Schedule>) => onChange({ ...value, ...patch })
  return <Picker tooltip="Schedule" label={scheduleLabel(value)} icon={<Clock size={14} />} side={side} width="w-64">
    {() => <div className="grid">
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
        <p className="text-[11px] text-(--muted-light)">{value.timezone.replace('_', ' ')}</p>
      </div>
    </div>}
  </Picker>
}

export function AgentPicker({ value, onChange, side = 'top' }: { value: string | null; onChange(next: string | null): void; side?: 'top' | 'bottom' }) {
  return <Picker tooltip="Agent" label={agentFor(value)?.name ?? 'No agent'} icon={<AutomationAvatar agentId={value} />} side={side} width="w-56">
    {(close) => <Command><CommandList>
      <CommandItem value="No agent" onSelect={() => { onChange(null); close() }}>
        <AutomationAvatar agentId={null} size={18} /><span className="flex-1 truncate">No agent</span>{!value ? <Check size={14} /> : null}
      </CommandItem>
      <CommandGroup heading="Agents">
        {PICKABLE_AGENTS.map((agent) => <CommandItem key={agent.id} value={agent.name + ' ' + agent.id} onSelect={() => { onChange(agent.id); close() }}>
          <AgentCreature agent={agent} size={18} /><span className="flex-1 truncate">{agent.name}</span>{agent.id === value ? <Check size={14} /> : null}
        </CommandItem>)}
      </CommandGroup>
    </CommandList></Command>}
  </Picker>
}

function ComposerTextarea({ value, onChange, onSubmit, placeholder, label, minHeight }: { value: string; onChange(next: string): void; onSubmit(): void; placeholder: string; label: string; minHeight: string }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useAutosizeTextarea(input, value)
  return <Textarea ref={input} rows={1} aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit() } }}
    className={unstyledTextarea('block max-h-60 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-sm leading-6 text-(--foreground) outline-none placeholder:text-(--muted-light) ' + minHeight)} />
}

function NewAutomationComposer() {
  const scope = usePanelScope()
  const open = useOpenAutomation()
  const [text, setText] = useState('')
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE)
  const [agentId, setAgentId] = useState<string | null>(null)
  const submit = () => {
    if (!text.trim()) return
    open(createAutomation({ scope, schedule, agentId, instructions: text.trim() }))
  }
  return <PromptInput><PromptInputBody>
    <ComposerTextarea label="Instructions" placeholder="What should run on a schedule?" value={text} onChange={setText} onSubmit={submit} minHeight="min-h-16" />
    <PromptInputFooter className="flex-nowrap">
      <SchedulePicker side="bottom" value={schedule} onChange={setSchedule} />
      <AgentPicker side="bottom" value={agentId} onChange={setAgentId} />
      <span className="min-w-0 flex-1" />
      <PromptInputSubmit aria-label="Schedule it" status="ready" disabled={!text.trim()} onClick={submit} />
    </PromptInputFooter>
  </PromptInputBody></PromptInput>
}

const STATUS_LABELS: Record<RunStatus, string> = { ok: 'Last run finished', failed: 'Last run failed', waiting: 'Waiting for you' }
const STATUS_TONES: Record<RunStatus, string> = { ok: 'ready', failed: 'failed', waiting: 'needs_input' }

function LastRun({ status }: { status: RunStatus | null }) {
  if (!status) return null
  return <span className="agent-activity-count flex shrink-0 items-center gap-1.5 text-xs" data-status={STATUS_TONES[status]} title={STATUS_LABELS[status]}>
    <span aria-hidden className="size-1.5 rounded-full bg-current" />
    {status === 'ok' ? <span className="sr-only">{STATUS_LABELS[status]}</span> : <span className="max-sm:sr-only">{status === 'failed' ? 'Failed' : 'Waiting for you'}</span>}
  </span>
}

function nextLabel(automation: Automation) {
  if (automation.paused) return 'Paused'
  if (automation.status === 'waiting') return 'Paused until you reply'
  return 'Next: ' + formatWhen(nextRun(automation.schedule))
}

function AutomationRow({ automation, onOpen }: { automation: Automation; onOpen(): void }) {
  const name = automationName(automation)
  return <li className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-(--surface-subtle)">
    <AutomationAvatar agentId={automation.agentId} size={20} />
    <div className="min-w-0 flex-1">
      <Button variant="ghost" type="button" onClick={onOpen} className={unstyledButton('flex w-full min-w-0 shrink text-left text-sm text-(--foreground) after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none')}><span className="truncate">{name}</span></Button>
      <p className="truncate text-xs text-(--muted)">{scheduleLabel(automation.schedule)} · {nextLabel(automation)}</p>
    </div>
    <LastRun status={automation.status} />
    <Switch checked={!automation.paused} aria-label={automation.paused ? 'Resume ' + name : 'Pause ' + name} onCheckedChange={(on) => updateAutomation(automation.id, (current) => ({ ...current, paused: !on }))}
      className="relative z-10 -mx-1.5 origin-center scale-[0.7]" />
  </li>
}

function AutomationsLanding() {
  const scope = usePanelScope()
  const open = useOpenAutomation()
  const automations = useAutomations().filter((automation) => automation.scope === scope)
  return <AppScreenShell header={<AppScreenHeader />}>
    <AppScreenBody padding="none">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-3 pb-12 pt-[14vh] sm:px-4">
        <NewAutomationComposer />
        {automations.length ? <section aria-label="Scheduled" className="mt-10">
          <h2 className="mb-1 px-3 text-xs text-(--muted)">Scheduled</h2>
          <ul className="grid grid-cols-1">{automations.map((automation) => <AutomationRow key={automation.id} automation={automation} onOpen={() => open(automation.id)} />)}</ul>
        </section> : <div className="mt-10 px-3 text-center">
          <p className="text-sm text-(--muted)">Nothing scheduled yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-(--muted-light)">Write what should happen, pick when and send. It becomes a thread that gets a new message on every run.</p>
        </div>}
      </div>
    </AppScreenBody>
  </AppScreenShell>
}

function UserTurn({ label, text, onSave }: { label?: string; text: string; onSave?(next: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => { if (draft?.trim()) onSave?.(draft.trim()); setDraft(null) }
  return <Message align="end">
    <MessageContent className={'gap-1.5 ' + (draft === null ? 'max-w-[min(92%,36rem)] sm:max-w-[75%]' : 'w-full max-w-xl')}>
      {label ? <span className="self-end px-1 text-[11px] text-(--muted-light)">{label}</span> : null}
      {draft === null ? <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
        <MarkdownMessage text={text.replace(/\n/g, '  \n')} isStreaming={false} />
      </UserMessageBubble> : <PromptInput><PromptInputBody>
        <ComposerTextarea label="Edit instructions" placeholder="Instructions" value={draft} onChange={setDraft} onSubmit={save} minHeight="min-h-11" />
        <PromptInputFooter>
          <span className="min-w-0 flex-1 truncate text-[11px] text-(--muted-light)">Applies from the next run</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
          <Button type="button" variant="secondary" size="sm" disabled={!draft.trim()} onClick={save}>Save</Button>
        </PromptInputFooter>
      </PromptInputBody></PromptInput>}
      {onSave && draft === null ? <div className="flex justify-end transition-opacity md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100">
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Edit instructions" title="Edit instructions" onClick={() => setDraft(text)}><Pencil /></Button>
      </div> : null}
    </MessageContent>
  </Message>
}

function AssistantTurn({ children }: { children: ReactNode }) {
  return <Message><MessageContent className="min-w-0 gap-2">{children}</MessageContent></Message>
}

const RETRIED: Record<string, string> = {
  auto_launch_brief: 'Slack is connected again.\n\n**Moved:** The launch email draft is ready for review.\n\n**Blocked:** Nothing.\n\n**Needs you:** Pick the hero headline (A or B).\n\nSignups yesterday: 162.',
  auto_competitors: 'Retried and all three pages loaded. No price changes; Corvid renamed its Team plan to Starter.',
}

function FailedRun({ error, onRetry }: { error: string; onRetry(): void }) {
  return <div role="status" className="flex items-start gap-2.5 rounded-xl border border-(--border) px-3 py-2.5">
    <span className="agent-activity-count mt-0.5" data-status="failed"><CircleAlert size={15} aria-hidden /></span>
    <div className="min-w-0 flex-1 text-sm">
      <p className="text-(--foreground)">This run failed</p>
      <p className="mt-0.5 text-xs leading-5 text-(--muted)">{error}</p>
    </div>
    <Button type="button" variant="outline" size="xs" onClick={onRetry} className="shrink-0">Retry</Button>
  </div>
}

function WaitingBanner() {
  return <div role="status" className="agent-activity-count flex items-start gap-2 rounded-xl bg-(--surface-subtle) px-3 py-2.5 text-xs leading-5" data-status="needs_input">
    <MessageCircleQuestion size={14} className="mt-0.5 shrink-0" aria-hidden />
    <span><span className="font-medium">This run is waiting for your answer.</span> <span className="text-(--muted)">Later runs are paused until you reply.</span></span>
  </div>
}

function AutomationThread({ automation }: { automation: Automation }) {
  const name = automationName(automation)
  const waiting = automation.status === 'waiting'
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const lastQuestion = automation.entries.findLastIndex((entry) => entry.kind === 'question')
  const set = (patch: Partial<Automation>) => updateAutomation(automation.id, (current) => ({ ...current, ...patch }))

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [automation.entries.length, working])

  function respond(text: string, patch: Partial<Automation> = {}) {
    setWorking(true)
    setTimeout(() => { appendEntries(automation.id, [{ kind: 'reply', text }], patch); setWorking(false) }, 1400)
  }

  function runNow() {
    appendEntries(automation.id, [{ kind: 'run', at: Date.now(), manual: true }])
    respond(RETRIED[automation.id] ?? 'Done. Same result as the last run, nothing new to report.', { status: 'ok' })
  }

  function send() {
    const text = message.trim()
    if (!text) return
    setMessage('')
    appendEntries(automation.id, [{ kind: 'user', text }])
    respond(waiting
      ? 'Changed the launch task to **December 4** and finished the brief.\n\n**Moved:** The launch email is approved.\n\n**Blocked:** Nothing.\n\n**Needs you:** Nothing today.\n\nScheduled runs are back on. Next: ' + formatWhen(nextRun(automation.schedule)) + '.'
      : 'Noted. I\'ll follow that from the next run on.', { status: 'ok' })
  }

  function retry(entry: Entry) {
    updateAutomation(automation.id, (current) => ({
      ...current,
      status: current.entries.at(-1)?.id === entry.id ? 'ok' : current.status,
      entries: current.entries.map((item) => (item.id === entry.id ? { id: item.id, kind: 'reply', text: RETRIED[automation.id] ?? 'Retried and finished.' } : item)),
    }))
  }

  function render(entry: Entry, index: number) {
    switch (entry.kind) {
      case 'instructions':
        return <UserTurn key={entry.id} label="Instructions" text={entry.text} onSave={(text) => updateAutomation(automation.id, (current) => ({ ...current, entries: current.entries.map((item) => (item.id === entry.id ? { ...item, text } : item)) }))} />
      case 'run':
        return <UserTurn key={entry.id} label={(entry.manual ? 'Run now' : 'Scheduled run') + ' · ' + formatWhen(entry.at)} text="Run the instructions." />
      case 'user':
        return <UserTurn key={entry.id} text={entry.text} />
      case 'reply':
        return <AssistantTurn key={entry.id}><MarkdownMessage text={entry.text} isStreaming={false} /></AssistantTurn>
      case 'question':
        return <AssistantTurn key={entry.id}>
          <MarkdownMessage text={entry.text} isStreaming={false} />
          {waiting && index === lastQuestion ? <WaitingBanner /> : null}
        </AssistantTurn>
      case 'failed':
        return <AssistantTurn key={entry.id}><FailedRun error={entry.error} onRetry={() => retry(entry)} /></AssistantTurn>
    }
  }

  const actions = <div className="flex items-center gap-1">
    <SchedulePicker side="bottom" value={automation.schedule} onChange={(schedule) => set({ schedule })} />
    <AgentPicker side="bottom" value={automation.agentId} onChange={(agentId) => set({ agentId })} />
    <span aria-hidden className="mx-1 h-4 w-px bg-(--border)" />
    <Button type="button" variant="ghost" size="sm" onClick={() => set({ paused: !automation.paused })} className="h-8 gap-1.5 px-2 font-normal text-(--muted)">
      {automation.paused ? <Play size={14} /> : <Pause size={14} />}<span className="max-sm:sr-only">{automation.paused ? 'Resume' : 'Pause'}</span>
    </Button>
    <Button type="button" variant="ghost" size="sm" onClick={runNow} disabled={working} className="h-8 gap-1.5 px-2 font-normal text-(--muted)">
      <CirclePlay size={14} /><span className="max-sm:sr-only">Run now</span>
    </Button>
  </div>

  return <AppScreenShell header={<AppScreenHeader title={name} metadata={<span className="max-sm:hidden">{nextLabel(automation)}</span>} actions={actions} />}>
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-6 pt-4 sm:px-6">
          {automation.entries.map(render)}
          {working ? <AutomationAvatar agentId={automation.agentId} size={24} working /> : null}
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput><PromptInputBody>
            <ComposerTextarea label="Message" placeholder={waiting ? 'Answer to continue this run' : 'Message ' + (agentFor(automation.agentId)?.name ?? 'Overlay')} value={message} onChange={setMessage} onSubmit={send} minHeight="min-h-11" />
            <PromptInputFooter>
              <span className="min-w-0 flex-1" />
              <PromptInputSubmit aria-label="Send" status={working ? 'submitted' : 'ready'} disabled={!message.trim() || working} onClick={send} />
            </PromptInputFooter>
          </PromptInputBody></PromptInput>
        </div>
      </div>
    </div>
  </AppScreenShell>
}

/** /app/automations: the composer and list, or one automation's thread when ?automationId= is set. */
export function AutomationsPage() {
  const id = useSearchParams()?.get('automationId')
  const automation = useAutomations().find((entry) => entry.id === id)
  return automation ? <AutomationThread key={automation.id} automation={automation} /> : <AutomationsLanding />
}

/** The contextual panel: one row per automation, in the agent thread row style. */
export function AutomationThreadsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const scope = usePanelScope()
  const open = useOpenAutomation()
  const activeId = useSearchParams()?.get('automationId')
  const automations = useAutomations().filter((automation) => automation.scope === scope)
  if (!automations.length) return <p className="px-2.5 py-2 text-xs text-(--muted-light)">No automations yet</p>
  return <SidebarMenu aria-label="Automations">
    {automations.map((automation) => {
      const active = automation.id === activeId
      const name = automationName(automation)
      return <SidebarMenuSubItem key={automation.id}>
        <SidebarMenuSubButton isActive={active} aria-current={active ? 'page' : undefined} title={name} onClick={() => { open(automation.id); onNavigate?.() }}
          className="min-w-0 gap-[7px] font-normal data-[active=true]:font-normal">
          <AutomationAvatar agentId={automation.agentId} />
          <span className="flex-1 truncate">{name}</span>
          {automation.paused ? <span className="text-[10px] text-(--muted-light)">Paused</span>
            : <ThreadActivityIndicator status={automation.status === 'waiting' ? 'needs_input' : automation.status === 'failed' ? 'failed' : undefined} />}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    })}
  </SidebarMenu>
}
