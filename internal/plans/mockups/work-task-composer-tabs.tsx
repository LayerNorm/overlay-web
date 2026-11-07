import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, Bot, Maximize2, Mic, CalendarDays, Check, ChevronRight, CircleHelp, Folder, GitFork, ListChecks, MessageSquare, PanelLeft, Paperclip, Plus, RotateCcw, Search, Settings, Sun, User, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '../../../packages/overlay-ui/src/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../../packages/overlay-ui/src/components/ui/command'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'

type Status = 'backlog' | 'todo' | 'progress'
type Assignee = { id: string; name: string; kind: 'person' | 'agent'; initials?: string; color?: string; you?: boolean; overlay?: boolean }
type Task = { id: string; title: string; status: Status; assignee?: string; due?: string; start?: string; blockedBy: string[]; fresh?: boolean }

const people: Assignee[] = [
  { id: 'me', name: 'Divyansh Lalwani', kind: 'person', initials: 'DL', you: true },
  { id: 'maya', name: 'Maya Chen', kind: 'person', initials: 'MC' },
  { id: 'overlay', name: 'Overlay', kind: 'agent', overlay: true },
  { id: 'scout', name: 'Scout', kind: 'agent', color: '#9294b6' },
  { id: 'builder', name: 'Builder', kind: 'agent', color: '#7fb49a' },
]
const initial: Task[] = [
  { id: 't1', title: 'Review subscription pricing', status: 'progress', assignee: 'overlay', due: 'Today', blockedBy: [] },
  { id: 't2', title: 'Draft launch announcement', status: 'todo', assignee: 'maya', due: 'Fri', blockedBy: ['t1'] },
  { id: 't3', title: 'Test the onboarding flow', status: 'todo', assignee: 'scout', due: 'Tomorrow', blockedBy: [] },
  { id: 't4', title: 'Update the pricing page', status: 'backlog', assignee: 'builder', blockedBy: ['t1'] },
  { id: 't5', title: 'Collect customer feedback', status: 'todo', assignee: 'me', blockedBy: [] },
]
const clone = () => initial.map(t => ({ ...t, blockedBy: [...t.blockedBy] }))
const dateOptions = ['Today', 'Tomorrow', 'Fri', 'Next week']

function StatusIcon({ status }: { status: Status }) {
  return <svg width={16} height={16} viewBox="0 0 16 16" className={'st-' + status} aria-hidden style={{ flexShrink: 0 }}>
    {status === 'backlog' && <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2" />}
    {status !== 'backlog' && <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    {status === 'progress' && <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" />}
  </svg>
}
function Face({ who, size = 20 }: { who?: Assignee; size?: number }) {
  if (!who) return <span className="person none" style={{ width: size, height: size }} aria-label="Unassigned" />
  if (who.overlay) return <OverlayMark size={size} />
  if (who.kind === 'agent') return <span className="creature" style={{ width: size - 2, height: size, background: who.color }}><span /><span /></span>
  return <span className={'person' + (who.you ? ' photo' : '')} style={{ width: size, height: size }}>{who.initials}</span>
}
const find = (id?: string) => people.find(p => p.id === id)

function AssigneePicker({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const who = find(value)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className={'chip' + (who ? ' set' : '')}>{who ? <Face who={who} size={16} /> : <User size={14} />}{who ? who.name.split(' ')[0] : 'Assignee'}</Button></PopoverTrigger>
    <PopoverContent align="start" className="picker"><Command>
      <CommandInput placeholder="Assign to..." />
      <CommandList><CommandEmpty>No one found.</CommandEmpty>
        {(['person', 'agent'] as const).map(kind => <CommandGroup key={kind} heading={kind === 'person' ? 'People' : 'Agents'}>
          {people.filter(p => p.kind === kind).map(p => <CommandItem key={p.id} value={p.name} className="picker-item" onSelect={() => { onChange(p.id === value ? undefined : p.id); setOpen(false) }}>
            <Face who={p} size={18} />{p.name}{p.you && <small>You</small>}{p.id === value && <Check size={14} className="check" />}
          </CommandItem>)}
        </CommandGroup>)}
      </CommandList>
    </Command></PopoverContent>
  </Popover>
}

function SchedulePicker({ start, due, onChange }: { start?: string; due?: string; onChange: (next: { start?: string; due?: string }) => void }) {
  const label = due ? `Due ${due}` : start ? `Starts ${start}` : 'Schedule'
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className={'chip' + (start || due ? ' set' : '')}><CalendarDays size={14} />{label}</Button></PopoverTrigger>
    <PopoverContent align="start" className="sched">
      {([['Start', start, (v?: string) => onChange({ start: v, due })], ['Due', due, (v?: string) => onChange({ start, due: v })]] as const).map(([name, current, set]) => <div key={name}>
        <div className="sched-label">{name}</div>
        <div className="sched-opts">{dateOptions.map(d => <Button key={d} size="sm" variant={current === d ? 'secondary' : 'ghost'} onClick={() => set(current === d ? undefined : d)}>{d}</Button>)}<Button size="sm" variant="ghost" onClick={() => toast('A shadcn calendar opens here')}>Pick a date</Button></div>
      </div>)}
    </PopoverContent>
  </Popover>
}

function DependsPicker({ tasks, value, onChange }: { tasks: Task[]; value: string[]; onChange: (ids: string[]) => void }) {
  const label = value.length === 0 ? 'Depends on' : value.length === 1 ? `After ${tasks.find(t => t.id === value[0])?.title}` : `After ${value.length} tasks`
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className={'chip' + (value.length ? ' set' : '')} style={{ maxWidth: 260 }}><GitFork size={14} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span></Button></PopoverTrigger>
    <PopoverContent align="start" className="picker"><Command>
      <CommandInput placeholder="Search tasks..." />
      <CommandList><CommandEmpty>No tasks found.</CommandEmpty><CommandGroup heading="Starts after">
        {tasks.map(t => <CommandItem key={t.id} value={t.title} className="picker-item" onSelect={() => onChange(value.includes(t.id) ? value.filter(id => id !== t.id) : [...value, t.id])}>
          <StatusIcon status={t.status} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>{value.includes(t.id) && <Check size={14} className="check" />}
        </CommandItem>)}
      </CommandGroup></CommandList>
    </Command></PopoverContent>
  </Popover>
}

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('workspace')
  const [tasks, setTasks] = React.useState(clone)
  const [draft, setDraft] = React.useState('')
  const [assignee, setAssignee] = React.useState<string>()
  const [schedule, setSchedule] = React.useState<{ start?: string; due?: string }>({})
  const [blockedBy, setBlockedBy] = React.useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settings, setSettings] = React.useState<Record<string, string>>({ Status: 'Todo', Priority: 'None', Repeat: 'Never' })
  const input = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const who = find(assignee)

  function add() {
    const title = draft.trim()
    if (!title) return
    setTasks(previous => [...previous.map(t => ({ ...t, fresh: false })), { id: 'n' + Date.now(), title, status: settings.Status === 'Backlog' ? 'backlog' : 'todo', assignee, ...schedule, blockedBy, fresh: true }])
    setDraft(''); setAssignee(undefined); setSchedule({}); setBlockedBy([]); setSettingsOpen(false); setSettings({ Status: 'Todo', Priority: 'None', Repeat: 'Never' })
    toast('Task added', who?.kind === 'agent' ? { description: blockedBy.length ? `${who.name} starts once its dependencies are done.` : `Open the task and press Start Task when ${who.name} should begin.` } : undefined)
    input.current?.focus()
  }
  function reset() { setTasks(clone()); setDraft(''); setAssignee(undefined); setSchedule({}); setBlockedBy([]); toast.dismiss() }
  const hint = who?.kind === 'agent' ? (blockedBy.length ? 'Queued until dependencies finish' : 'Assigning does not start work') : ''

  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Work task composer, tabs</span></span><div><Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={reset}><RotateCcw size={14} /></Button><Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <div className="workspace-navigation">
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Work"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="work"
          scope={scope}
          panelNav={{ activeId: scope, activeChildId: scope + ':list', onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id); else toast('Only the composer is interactive in this preview') }, items: [
            ...(['personal', 'workspace'] as const).map(id => ({ id, label: id === 'personal' ? 'Personal' : 'Workspace', children: ['List', 'Board', 'Timeline'].map(view => ({ id: `${id}:${view.toLowerCase()}`, label: view })) })),
          ] }}
          onSearch={() => toast('Search is unchanged in this proposal')}
          panelAction={{ label: 'New task', onClick: () => input.current?.focus() }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, active: true, onSelect: () => setSidebarOpen(false) },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => toast('Agents are unchanged in this proposal') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => toast('Chats are unchanged in this proposal') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Files are unchanged in this proposal') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => toast('Automations are unchanged in this proposal') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Type a task, pick an assignee, schedule and dependencies, then press Enter.') },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => toast('Settings are unchanged in this proposal') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account">DL</Button>}
        />
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header">
          <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button>
          <span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} /><span>Work</span>
          <div className="work-tabs">{['List', 'Board', 'Timeline'].map(t => <Button key={t} size="sm" variant={t === 'List' ? 'secondary' : 'ghost'} onClick={() => t !== 'List' && toast(`${t} is unchanged in this proposal`)}>{t}</Button>)}</div>
          <span className="work-count">{tasks.length} open</span>
          <span className="grow" />
          <Button variant="ghost" size="icon-sm" aria-label="Search tasks" onClick={() => toast('Search is unchanged')}><Search size={15} /></Button>
          <Button variant="secondary" size="sm" onClick={() => input.current?.focus()}><Plus size={14} />New task</Button>
        </header>
        <div className="work-view">
          <div className="work-list" role="table">{tasks.map(t => { const a = find(t.assignee); return <div key={t.id} role="row" className={'work-row' + (t.fresh ? ' fresh' : '')}>
            <StatusIcon status={t.status} /><span className="work-title">{t.title}</span>
            <span className="work-meta">{t.blockedBy.length > 0 && <span className="work-tag" title={'After ' + t.blockedBy.map(id => tasks.find(x => x.id === id)?.title).join(', ')}><GitFork size={11} />{t.blockedBy.length === 1 ? 'Waiting on 1' : `Waiting on ${t.blockedBy.length}`}</span>}<span className={'due' + (t.due === 'Today' || t.due === 'Tomorrow' ? ' soon' : '')}>{t.due ?? (t.start ? 'From ' + t.start : '')}</span><Face who={a} size={22} /></span>
          </div> })}</div>
          <div className="task-composer-wrap">
            <div className="tabbed">
              <div className="task-tab">
                <AssigneePicker value={assignee} onChange={setAssignee} />
                <SchedulePicker {...schedule} onChange={setSchedule} />
                <DependsPicker tasks={tasks} value={blockedBy} onChange={setBlockedBy} />
                <span className="grow" />
                <Button variant="ghost" size="icon-sm" aria-label="Task settings" aria-expanded={settingsOpen} className={'gear' + (settingsOpen ? ' on' : '')} onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={15} /></Button>
              </div>
              {settingsOpen && <div className="task-settings">
                {([['Status', ['Backlog', 'Todo']], ['Priority', ['None', 'Low', 'Medium', 'High', 'Urgent']], ['Repeat', ['Never', 'Daily', 'Weekly', 'Monthly']]] as const).map(([name, opts]) => <div key={name} className="setting-row">
                  <span className="setting-label">{name}</span>
                  <div className="setting-opts">{opts.map(o => <Button key={o} size="sm" variant={settings[name] === o ? 'secondary' : 'ghost'} onClick={() => setSettings({ ...settings, [name]: o })}>{o}</Button>)}</div>
                </div>)}
              </div>}
              <div className="composer task-composer" data-slot="prompt-input">
                <Button variant="ghost" size="icon-sm" className="expand" aria-label="Expand" onClick={() => toast('Opens the full task editor')}><Maximize2 size={14} /></Button>
                <Textarea ref={input} aria-label="New task" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }} placeholder="Describe a task" />
                <div className="chip-row">
                  <Button variant="ghost" size="icon-sm" aria-label="Add context" onClick={() => toast('Attach files, notes or chats as task context')}><Plus size={16} /></Button>
                  <span className="grow" />
                  {hint && <span className="composer-hint">{hint}</span>}
                  <Button variant="ghost" size="icon-sm" aria-label="Dictate" onClick={() => toast('Voice input')}><Mic size={15} /></Button>
                  <Button size="icon-sm" aria-label="Add task" disabled={!draft.trim()} onClick={add}><ArrowUp size={15} /></Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
