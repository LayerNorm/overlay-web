import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, Clock3, MessageSquare, MoreHorizontal, Pause, Play, Plus, Repeat2 } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Label, Popover, PopoverContent, PopoverTrigger, SelectRoot as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@overlay/ui/primitives'
import { unstyledTextarea } from '@overlay/ui/control-reset'
import { useAutosizeTextarea } from '@overlay/ui/hooks'
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit, MarkdownMessage, UserMessageBubble } from '@overlay/chat-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { AgentCreature } from '@/components/orb/Creature'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { AGENTS } from '../../fixtures/agents'
import { fixtureVersion, subscribeFixtures } from '../../fixtures/convex'
import { automations, defaultSchedule, saveAutomation, scheduleLabel, type Automation, type Schedule } from './fixtures'

function AgentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const agent = AGENTS.find(row => row.id === id)
  return agent ? <AgentCreature agent={agent} isDefault={agent.isDefault} size={size} /> : <MessageSquare size={size} strokeWidth={1.5} />
}
const agentName = (id: string) => AGENTS.find(row => row.id === id)?.name ?? 'No agent'

function SchedulePicker({ value, onChange }: { value: Schedule; onChange(value: Schedule): void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  return <Popover open={open} onOpenChange={next => { setDraft(value); setOpen(next) }}>
    <PopoverTrigger asChild><PromptInputButton aria-label="Schedule" className="h-8 w-auto max-w-full shrink-0 gap-1.5 px-2 text-xs"><Clock3 size={15} /><span className="truncate">{scheduleLabel(value)}</span><ChevronDown size={12} /></PromptInputButton></PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-72 max-w-[calc(100vw-2rem)] space-y-4 p-4">
      <div><h3 className="text-sm font-medium">Schedule</h3><p className="mt-1 text-xs text-(--muted)">Send your prompt to this thread.</p></div>
      <div className="space-y-1.5"><Label htmlFor="repeat" className="text-xs">Repeat</Label><Select value={draft.cadence} onValueChange={value => setDraft({ ...draft, cadence: value as Schedule['cadence'] })}><SelectTrigger id="repeat"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Every day</SelectItem><SelectItem value="weekdays">Weekdays</SelectItem><SelectItem value="weekly">Every Monday</SelectItem><SelectItem value="hourly">Every hour</SelectItem></SelectContent></Select></div>
      {draft.cadence !== 'hourly' && <div className="space-y-1.5"><Label htmlFor="schedule-time" className="text-xs">Time</Label><Input id="schedule-time" type="time" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} /></div>}
      <div className="space-y-1.5"><Label htmlFor="timezone" className="text-xs">Timezone</Label><Select value={draft.timezone} onValueChange={timezone => setDraft({ ...draft, timezone })}><SelectTrigger id="timezone"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/Los_Angeles">Los Angeles</SelectItem><SelectItem value="America/New_York">New York</SelectItem><SelectItem value="Europe/London">London</SelectItem><SelectItem value="Asia/Kolkata">Kolkata</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></div>
      <Button type="button" variant="secondary" className="w-full" disabled={!draft.time} onClick={() => { onChange(draft); setOpen(false) }}>Apply schedule</Button>
    </PopoverContent>
  </Popover>
}

function AgentPicker({ value, onChange, scope }: { value: string; onChange(value: string): void; scope: string }) {
  const options = AGENTS.filter(agent => agent.id !== (scope === 'workspace' ? 'agent_chief' : 'agent_overlay'))
  return <DropdownMenu><DropdownMenuTrigger asChild><PromptInputButton aria-label="Choose agent" className="h-8 w-auto shrink-0 gap-1.5 px-2 text-xs"><AgentIcon id={value} size={16} />{agentName(value)}<ChevronDown size={12} /></PromptInputButton></DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="w-64">
      <DropdownMenuItem onSelect={() => onChange('')}><MessageSquare size={16} /><span className="flex-1">No agent<span className="block text-xs text-(--muted)">Run in an ordinary chat</span></span>{!value && <Check size={14} />}</DropdownMenuItem>
      {options.map(agent => <DropdownMenuItem key={agent.id} onSelect={() => onChange(agent.id)}><AgentIcon id={agent.id} /><span className="flex-1">{agent.name}</span>{value === agent.id && <Check size={14} />}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}

export function AutomationThreadsPage() {
  useSyncExternalStore(subscribeFixtures, fixtureVersion, fixtureVersion)
  const scope = usePanelScope()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get('automationId') ?? params.get('id')
  const selected = automations.find(row => row._id === id)
  return <AutomationScreen key={`${scope}:${selected?._id ?? 'new'}`} selected={selected} scope={scope} open={item => router.push(`${pathname}${item ? `?automationId=${item._id}` : ''}`)} />
}

function AutomationScreen({ selected, scope, open }: { selected?: Automation; scope: 'personal' | 'workspace'; open(item?: Automation): void }) {
  const [text, setText] = useState('')
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule)
  const [agentId, setAgentId] = useState('')
  const [editingPrompt, setEditingPrompt] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  useAutosizeTextarea(input, text)
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [selected?.messages.length])
  const update = (patch: Partial<Automation>) => selected && saveAutomation({ ...selected, ...patch })
  const note = (message: string, patch: Partial<Automation>) => selected && update({ ...patch, messages: [...selected.messages, { role: 'note', text: message }] })
  function submit() {
    if (!text.trim()) return
    if (!selected) {
      const created: Automation = { ...schedule, _id: `mock_${Date.now()}`, name: text.trim().split(/[.!?\n]/)[0].slice(0, 64), instructions: text.trim(), agentId, scope, enabled: true, messages: [{ role: 'user', text: text.trim(), label: 'Recurring prompt' }, { role: 'note', text: `Scheduled · ${scheduleLabel(schedule)} · ${schedule.timezone.replaceAll('_', ' ')}. Future runs appear in this thread.` }] }
      saveAutomation(created); open(created)
    } else if (editingPrompt) {
      note('Recurring prompt updated. Applies to future runs.', { instructions: text.trim() }); setEditingPrompt(false)
    } else {
      update({ messages: [...selected.messages, { role: 'user', text: text.trim(), label: 'You · Just now' }, { role: 'assistant', text: 'This is a sample follow-up reply in the same thread. Your scheduled prompt is unchanged; future runs continue to use this conversation’s context.' }] })
    }
    setText('')
  }
  function runNow() {
    if (!selected) return
    update({ messages: [...selected.messages, { role: 'user', text: selected.instructions, label: 'Run now · Just now' }, { role: 'assistant', text: '**Sample run complete.**\n\nThe scheduled prompt appears as a new message in this same thread, with its previous context. In the product, the reply would come from your selected agent or chat model.' }] })
  }
  return <AppScreenShell header={<AppScreenHeader title={selected?.name} actions={selected ? <><Button variant="ghost" size="sm" className="gap-1.5" onClick={() => note(selected.enabled ? 'Schedule paused. You can still chat here.' : 'Schedule resumed.', { enabled: !selected.enabled })}>{selected.enabled ? <Pause size={14} /> : <Play size={14} />}<span className="hidden sm:inline">{selected.enabled ? 'Pause' : 'Resume'}</span></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Thread actions"><MoreHorizontal size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={runNow}><Play size={14} />Run now</DropdownMenuItem><DropdownMenuItem onSelect={() => { setEditingPrompt(true); setText(selected.instructions); requestAnimationFrame(() => input.current?.focus()) }}>Change recurring prompt</DropdownMenuItem><DropdownMenuItem onSelect={() => open()}><Plus size={14} />New automation</DropdownMenuItem></DropdownMenuContent></DropdownMenu></> : undefined} />}>
    <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex h-full min-h-0 flex-col">
      {selected ? <>
        <div className="shrink-0 px-4 pt-1 pb-3"><div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--muted)"><SchedulePicker value={selected} onChange={value => note(`Schedule changed · ${scheduleLabel(value)}`, value)} /><span className="inline-flex items-center gap-1.5"><AgentIcon id={selected.agentId} size={15} />{agentName(selected.agentId)}</span><span>{selected.enabled ? 'Scheduled' : 'Paused'}</span><span className="text-(--muted-light)">{selected.timezone.replaceAll('_', ' ')}</span></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4"><div className="mx-auto max-w-4xl space-y-7 py-5">
          {selected.messages.map((message, index) => message.role === 'note' ? <p key={index} className="flex items-start justify-center gap-2 text-center text-xs leading-5 text-(--muted)"><Repeat2 size={13} className="mt-1 shrink-0" />{message.text}</p> : message.role === 'user' ? <div key={index} className="flex flex-col items-end gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] text-(--muted)">{message.label?.startsWith('Scheduled') && <Clock3 size={12} />}{message.label}</span><UserMessageBubble className="max-w-[92%] text-sm">{message.text}</UserMessageBubble></div> : <div key={index} className="flex gap-3"><div className="shrink-0 pt-1"><AgentIcon id={selected.agentId || 'agent_overlay'} size={24} /></div><div className="min-w-0 flex-1 text-sm leading-6">{selected.agentId && <p className="mb-2 font-medium">{agentName(selected.agentId)}</p>}<MarkdownMessage text={message.text} isStreaming={false} /></div></div>)}
          <div ref={bottom} />
        </div></div>
      </> : <div className="min-h-0 flex-1 overflow-auto px-4 py-8"><div className="mx-auto max-w-4xl"><h1 className="text-lg font-medium">Your recurring work, in a thread.</h1><p className="mt-2 text-sm text-(--muted)">Write a prompt, choose when it runs, and pick an agent—or keep it a chat.</p><div className="mt-8 space-y-1">{automations.filter(row => row.scope === scope).map(row => <Button key={row._id} type="button" variant="ghost" onClick={() => open(row)} className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-3 text-left font-normal"><AgentIcon id={row.agentId} size={22} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.name}</span><span className="mt-1 block truncate text-xs text-(--muted)">{scheduleLabel(row)} · {agentName(row.agentId)}</span></span><span className="text-xs text-(--muted)">{row.enabled ? 'Scheduled' : 'Paused'}</span></Button>)}</div></div></div>}
      <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4"><div className="mx-auto max-w-4xl">
        {editingPrompt && <div className="mb-2 flex items-center justify-between text-xs text-(--muted)"><span>Change the recurring prompt for future runs</span><Button variant="ghost" size="sm" onClick={() => { setEditingPrompt(false); setText('') }}>Cancel</Button></div>}
        <PromptInput><PromptInputBody><Textarea ref={input} rows={1} aria-label={selected ? editingPrompt ? 'Recurring prompt' : 'Message this thread' : 'Automation instructions'} placeholder={selected ? 'Message this thread…' : 'What would you like to run on a schedule?'} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} className={unstyledTextarea('block min-h-11 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-sm leading-6 text-(--foreground) outline-none placeholder:text-(--muted-light)')} />
          <PromptInputFooter className="flex-wrap gap-1">{!selected ? <><SchedulePicker value={schedule} onChange={setSchedule} /><AgentPicker value={agentId} onChange={setAgentId} scope={scope} /></> : <span className="text-[11px] text-(--muted-light)">{editingPrompt ? 'Updates the schedule’s instructions' : 'Follow-ups don’t change your recurring prompt'}</span>}<span className="flex-1" /><PromptInputSubmit aria-label={selected ? editingPrompt ? 'Save recurring prompt' : 'Send message' : 'Create automation'} disabled={!text.trim()} onClick={submit} /></PromptInputFooter>
        </PromptInputBody></PromptInput>
        <p className="mt-2 text-center text-[10px] text-(--muted-light)">Interactive mockup · Sample replies · No schedules run</p>
      </div></div>
    </AppScreenBody>
  </AppScreenShell>
}
