import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowUp, AtSign, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Copy, ThumbsUp, ThumbsDown, ExternalLink, TriangleAlert, File, Folder, LoaderCircle, ListChecks, MessageSquare, Monitor, MoreHorizontal, PanelLeft, PanelRight, MessageCircleQuestion, Plus, RotateCcw, Settings, Square, Sun, Users, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SidebarMenu, SidebarMenuSubItem, SidebarMenuSubButton } from '../../../packages/overlay-ui/src/components/ui/sidebar'


import { Renderer, StateProvider, VisibilityProvider, ActionProvider, useBoundProp, useStateStore, type ComponentRegistry, type ComponentRenderProps } from '@json-render/react'
import type { Spec } from '@json-render/core'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../packages/overlay-ui/src/components/ui/card'
import { Badge } from '../../../packages/overlay-ui/src/components/ui/badge'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../packages/overlay-ui/src/components/ui/select'
import { Checkbox } from '../../../packages/overlay-ui/src/components/ui/checkbox'
import { Switch } from '../../../packages/overlay-ui/src/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../packages/overlay-ui/src/components/ui/tabs'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../../../packages/overlay-ui/src/components/ui/accordion'
import { Alert, AlertDescription } from '../../../packages/overlay-ui/src/components/ui/alert'
import { Progress } from '../../../packages/overlay-ui/src/components/ui/progress'
import { Avatar, AvatarFallback } from '../../../packages/overlay-ui/src/components/ui/avatar'
import { Separator } from '../../../packages/overlay-ui/src/components/ui/separator'
import { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockContent, CodeBlockCopyButton } from '../../../packages/overlay-ui/src/components/ui/code-block'

type Thread = { id: string; title: string; status: 'working' | 'completed' | 'attention' | 'idle'; unread: boolean; activity: number; time: string; computer?: 'primary' | 'temporary'; prompt: string }
const initial: Thread[] = [
  { id: 'pricing', title: 'Review subscription pricing', status: 'working', unread: false, activity: 4, time: 'Now', computer: 'temporary', prompt: 'Review our subscription pricing and compare it with the current market.' },
  { id: 'onboarding', title: 'Test the onboarding flow', status: 'working', unread: false, activity: 3, time: '2 min ago', computer: 'primary', prompt: 'Test the onboarding flow and flag anything that blocks a new customer.' },
  { id: 'research', title: 'Q4 planning', status: 'completed', unread: true, activity: 2, time: '8 min ago', prompt: 'Summarize the recurring themes from this week’s customer feedback.' },
  { id: 'release', title: 'Draft release notes', status: 'completed', unread: false, activity: 1, time: 'Yesterday', prompt: 'Draft release notes for the latest update.' },
  { id: 'scope', title: 'Confirm research scope', status: 'attention', unread: false, activity: 0, time: 'Yesterday', prompt: 'Research the market for our next launch.' },
]
const cloneInitial = () => initial.map(t => ({ ...t }))
function statusLabel(thread: Thread) {
  if (thread.status === 'working') return 'Working'
  if (thread.status === 'attention') return 'Needs you'
  if (thread.status === 'completed') return thread.unread ? 'Ready to review' : 'Completed'
  return 'New thread'
}
function ThreadStatusIcon({ thread }: { thread: Thread }) {
  const Icon = thread.status === 'working' ? LoaderCircle : thread.status === 'attention' ? MessageCircleQuestion : MessageSquare
  return <span className={'thread-status ' + (thread.status === 'attention' ? 'attention' : thread.status === 'completed' && thread.unread ? 'ready' : '')} aria-hidden="true">
    {thread.status !== 'idle' && <Icon size={13} className={thread.status === 'working' ? 'spin' : undefined} />}
  </span>
}
function Status({ thread }: { thread: Thread }) {
  if (thread.status === 'working') return <span className="state"><LoaderCircle className="spin" size={12} />Working</span>
  if (thread.status === 'attention') return <span className="state attention"><MessageCircleQuestion size={12} />Needs you</span>
  if (thread.status === 'completed') return <span className={'state ' + (thread.unread ? 'ready' : '')}>{thread.unread ? 'Ready to review' : 'Completed'}</span>
  return <span className="state">New thread</span>
}
function App() {
  const [threads, setThreads] = React.useState(cloneInitial)
  const [selected, setSelected] = React.useState('research')
  const [page, setPage] = React.useState('thread')
  const [expanded, setExpanded] = React.useState(true)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('workspace')
  const [computerOpen, setComputerOpen] = React.useState(false)
  const [dark, setDark] = React.useState(true)
  const [draft, setDraft] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [feedRead, setFeedRead] = React.useState<string[]>(['release'])
  const current = threads.find(t => t.id === selected)!
  const sorted = [...threads].sort((a,b) => b.activity - a.activity)
  const working = threads.filter(t => t.status === 'working').length
  const ready = threads.filter(t => t.status === 'completed' && t.unread).length
  const notifications = sorted.filter(t => t.status === 'completed' || t.status === 'attention')
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  function open(id: string) {
    setSidebarOpen(false)
    setSelected(id); setPage('thread'); setComputerOpen(false); setDraft('')
    setFeedRead(previous => previous.includes(id) ? previous : [...previous, id])
    setThreads(previous => previous.map(t => t.id === id ? { ...t, unread: false } : t))
  }
  function newThread() {
    setSidebarOpen(false)
    const id = 'new-' + Date.now()
    setThreads(previous => [{ id, title: 'New thread', status: 'idle', unread: false, activity: Date.now(), time: 'Now', prompt: '' }, ...previous])
    setSelected(id); setPage('thread'); setExpanded(true); setComputerOpen(false); setDraft('')
  }
  function start() {
    if (!draft.trim()) return
    const prompt = draft.trim()
    setThreads(previous => previous.map(t => t.id === selected ? { ...t, prompt, title: prompt.length > 35 ? prompt.slice(0, 34) + '…' : prompt, status: 'working', activity: Date.now(), time: 'Now' } : t))
    setDraft('')
  }
  function finish() {
    const target = threads.find(t => t.status === 'working' && t.id !== selected) || threads.find(t => t.status === 'working')
    if (!target) return
    setThreads(previous => previous.map(t => t.id === target.id ? { ...t, status: 'completed', unread: t.id !== selected || page !== 'thread', activity: Date.now(), time: 'Just now' } : t))
    setFeedRead(previous => previous.filter(id => id !== target.id))
    toast('Task completed', { description: `Overlay · ${target.title}`, action: { label: 'View thread', onClick: () => open(target.id) }, duration: 10000 })
  }
  function reset() { setCollapsed(false); setScope('personal'); setFilter('all'); setSidebarOpen(false); setThreads(cloneInitial()); setSelected('pricing'); setPage('thread'); setExpanded(true); setComputerOpen(false); setFeedRead(['release']); setDraft(''); toast.dismiss() }
  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Generative UI</span></span><div><Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={reset}><RotateCcw size={14} /></Button><Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
    <div data-app-shell className={"shell" + (sidebarOpen ? " sidebar-open" : "")}>
      <div className="workspace-navigation">
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title={page === 'activity' ? 'Chats' : 'Agents'}
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind={page === 'activity' ? 'chat' : 'agents'}
          scope={scope}
          panelNav={{ activeId: scope, activeChildId: scope + ':activity', onSelect: id => {
            if (id === 'personal' || id === 'workspace') setScope(id)
            else toast('Only task Activity is interactive in this preview')
          }, items: [{id: 'personal', label: 'Personal', children: page === 'activity' ? [{id:'personal:activity',label:'Activity',icon:Activity}] : []}, {id:'workspace',label:'Workspace',children:page === 'activity' ? [{id:'workspace:activity',label:'Activity',icon:Activity}] : []}] }}
          onSearch={() => toast('Search is unchanged in this proposal')}
          panelAction={{label: page === 'activity' ? 'New chat' : 'New agent', onClick: () => toast('Agent and chat creation are unchanged in this proposal')}}
          items={[
            {id:'work',label:'Work',icon:ListChecks,onSelect:()=>toast('Work is unchanged in this proposal')},
            {id:'agents',label:'Agents',icon:Bot,active:page==='thread',onSelect:()=>{setPage('thread');setSidebarOpen(false)}},
            {id:'chats',label:'Chats',icon:MessageSquare,active:page==='activity',onSelect:()=>{setPage('activity');setSidebarOpen(false);setComputerOpen(false);setFeedRead(notifications.map(t=>t.id))}},
            {id:'files',label:'Files',icon:Folder,onSelect:()=>toast('Files are unchanged in this proposal')},
            {id:'automations',label:'Automations',icon:Workflow,onSelect:()=>toast('Automations are unchanged in this proposal')},
          ]}
          footerItems={[
            {id:'theme',label:'Toggle theme',icon:Sun,onSelect:()=>setDark(!dark)},
            {id:'help',label:'Help',icon:CircleHelp,onSelect:()=>toast('Interactive design preview',{description:'Try thread rows, the agent plus button, Chats for Activity, and Simulate completion.'})},
            {id:'settings',label:'Settings',icon:Settings,onSelect:()=>toast('Settings are unchanged in this proposal')},
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={()=>toast('LayerNorm',{description:'Workspace and account settings are unchanged.'})}>DL</Button>}
        >
          {page === 'thread' ? <>
          <div className="agent-row">

            <Button variant="ghost" className="agent-name" onClick={() => open(sorted[0].id)}><Avatar className="research-avatar"><AvatarFallback>R</AvatarFallback></Avatar><span>Research<span className="agent-summary">{working > 0 ? `${working} working` : 'No active tasks'}{ready > 0 && <span className="ready"> · {ready} ready</span>}</span></span></Button>
            <Button variant="ghost" size="icon-xs" aria-label="New thread in Overlay" title="New thread" onClick={newThread}><Plus size={15} /></Button><Button variant="ghost" size="icon-xs" aria-label={expanded ? 'Collapse Research threads' : 'Expand Research threads'} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Button>
          </div>
          {expanded && <SidebarMenu className="agent-thread-tree" aria-label="Research threads">{sorted.map(t => <SidebarMenuSubItem key={t.id}><SidebarMenuSubButton className="single-line-thread" isActive={selected === t.id && page === 'thread'} onClick={() => open(t.id)} aria-current={selected === t.id && page === 'thread' ? 'page' : undefined} aria-label={`${t.title}, ${statusLabel(t)}`} title={`${t.title} · ${statusLabel(t)}`}>
            <ThreadStatusIcon thread={t} /><span className="thread-title">{t.title}</span>
          </SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenu>}
          <div className="other-agent"><div className="mini-creature"><span /><span /></div><span>Scout<span className="agent-summary attention">Needs you</span></span><Button variant="ghost" size="icon-xs" aria-label="Preview Scout status" onClick={() => toast('Scout needs your input', { description: 'An approval or a question is waiting. This is an example of the attention state.' })}><MessageCircleQuestion size={15} className="attention" /></Button></div>
          </> : <p className="chat-preview-note">Task completions appear in your existing Activity feed.</p>}
        </DoubleSidebar>
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={()=>setSidebarOpen(false)}><X size={16}/></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} />{page === 'activity' ? <><span className="crumb">Chats</span><ChevronRight size={13} /><span>Activity</span></> : <><span className="crumb">Agents</span><ChevronRight size={13} /><Bot size={18} /><Button variant="ghost" className="crumb-agent" onClick={() => open(sorted[0].id)}>Research</Button><ChevronRight size={13} /><span className="breadcrumb-title">{current.title}</span></>}<span className="grow" />{page === 'thread' && <><Button variant="ghost" size="icon-sm" aria-label="Thread options" onClick={()=>toast('Thread options are unchanged')}><MoreHorizontal size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Thread members" onClick={()=>toast('Thread membership is unchanged')}><Users size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Thread computer details" onClick={() => setComputerOpen(!computerOpen)}><PanelRight size={16} /></Button></>}</header>
        {page === 'activity' ? <section className="activity-view"><h1>Activity</h1><div className="filters">{['all','unread','tasks'].map(f => <Button key={f} variant={filter === f ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(f)}>{f[0].toUpperCase()+f.slice(1)}</Button>)}</div><p className="day">Recent</p>{notifications.filter(t => filter !== 'unread' || !feedRead.includes(t.id)).map(t => <Button key={t.id} variant="ghost" className="notification-row" onClick={() => open(t.id)}><span className="notification-icon"><Check size={16} /></span><span className="notification-copy"><span>Overlay completed a task</span><strong>{t.title}</strong><small>{t.id === 'research' ? 'The feedback summary is ready.' : 'The result is ready in your thread.'}</small></span><span className="notification-time">{t.time}{!feedRead.includes(t.id) && <span className="unread" />}</span></Button>)}{filter === 'unread' && notifications.every(t => feedRead.includes(t.id)) && <p className="empty">You’re all caught up.</p>}</section> : <div className="thread-layout"><section className="conversation">
          <div className="conversation-heading"><div className="heading-meta"><span className="state">Q4 planning</span>{current.computer && <><span className="meta-separator">·</span><Button variant="ghost" size="xs" onClick={() => setComputerOpen(!computerOpen)}><Monitor size={13} />{current.computer === 'temporary' ? 'Temporary computer' : 'Agent computer'}{current.status === 'completed' ? current.computer === 'temporary' ? ' · Stopped' : ' · Released' : ''}</Button></>}</div></div>
          <GenerativeTranscript />
          <div className="composer" data-slot="prompt-input"><Textarea aria-label="Message Research" value={draft} onChange={e => setDraft(e.target.value)} placeholder={current.status === 'working' ? 'Add a follow-up...' : 'Message Research...'} /><div><Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={()=>toast('Attachments are unchanged')}><Plus size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={()=>toast('Mentions are unchanged')}><AtSign size={16}/></Button><Button variant="ghost" size="sm" onClick={()=>toast('Model selection is unchanged')}>Auto<ChevronDown size={12}/></Button><span className="grow" />{current.status === 'working' ? <><span className="composer-note">Working</span><Button variant="secondary" size="icon-sm" aria-label="Stop task" onClick={()=>toast('Use Simulate completion to preview a finished task')}><Square size={12}/></Button></> : <Button size="icon-sm" aria-label="Start task" disabled={!draft.trim()} onClick={start}><ArrowUp size={15} /></Button>}</div></div>
        </section>{computerOpen && <aside className="computer-panel"><div className="panel-title"><h2>Computer</h2><Button variant="ghost" size="icon-xs" aria-label="Close computer details" onClick={() => setComputerOpen(false)}><X size={15} /></Button></div><Monitor size={26} /><h3>{current.computer === 'temporary' ? 'Temporary computer' : current.computer ? 'Agent computer' : 'No computer in use'}</h3><p>{!current.computer ? 'This task does not need a computer yet.' : current.status === 'completed' ? current.computer === 'temporary' ? 'Stopped after the task finished. Results were saved to the thread.' : 'The task has released this computer. It is available for another thread.' : current.computer === 'temporary' ? 'The agent computer is busy in another thread. This task has its own isolated computer.' : 'Reserved for this thread while it uses the computer.'}</p>{current.computer && current.status === 'working' && <div className="computer-facts"><span>Used by<strong>{current.title}</strong></span><span>When this task ends<strong>{current.computer === 'temporary' ? 'Save results, then stop' : 'Release for another thread'}</strong></span>{current.computer === 'temporary' && <p>Normal computer usage rates apply. Workspace limits still apply.</p>}</div>}</aside>}</div>}
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
type Node = Spec['elements'][string]
type BugForm = { title: string; severity: string; steps: string; logs: boolean }
type SpecPartProps = { value: Spec; summary: string; initialState?: Record<string, unknown>; readonly?: boolean; onSubmit?: (form: BugForm) => void }
function spec(elements: Record<string, Node>): Spec { return { root: 'root', elements } as Spec }
const plans = spec({
  root: { type: 'Card', props: { title: 'Plans for your team', description: 'Monthly billing · illustrative pricing' }, children: ['table'] },
  table: { type: 'Table', props: { columns: ['Plan', 'Price/month', 'Seats', 'Agents', 'Computers'], rows: [ ['Starter', '$29', '3', '2', '1'], ['Team', '$99', '10', '10', '3'], ['Business', '$249', '25', '25', '10'] ], current: 'Team', caption: 'All plans include shared threads and workspace files.' } },
})
const performance = spec({
  root: { type: 'Stack', props: { gap: 16 }, children: ['metrics', 'chart', 'warning'] },
  metrics: { type: 'Grid', props: { columns: 3 }, children: ['tasks', 'credits', 'time'] },
  tasks: { type: 'Metric', props: { label: 'Tasks completed', value: '42', delta: '+12%' } },
  credits: { type: 'Metric', props: { label: 'Credits used', value: '1,284' } },
  time: { type: 'Metric', props: { label: 'Median run time', value: '6m 40s' } },
  chart: { type: 'Chart', props: { title: 'Tasks completed', description: 'Nov 2 to Nov 8', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [5, 8, 6, 9, 7, 4, 3] } },
  warning: { type: 'Alert', props: { variant: 'warning', text: '2 runs waited on approval for over 1 hour' } },
})
const bugForm = spec({
  root: { type: 'Card', props: { title: 'Bug report', description: 'Add a few details so the team can reproduce it.' }, children: ['fields'] },
  fields: { type: 'Stack', props: { gap: 16 }, children: ['title', 'severity', 'steps', 'logs', 'submit'] },
  title: { type: 'Input', props: { label: 'Title', value: { $bindState: '/form/title' }, placeholder: 'What went wrong?' } },
  severity: { type: 'Select', props: { label: 'Severity', value: { $bindState: '/form/severity' }, options: ['Low', 'Medium', 'High', 'Critical'] } },
  steps: { type: 'Textarea', props: { label: 'Steps to reproduce', value: { $bindState: '/form/steps' }, placeholder: 'Describe the steps to reproduce the issue.' } },
  logs: { type: 'Checkbox', props: { label: 'Include recent logs', checked: { $bindState: '/form/logs' } } },
  submit: { type: 'Button', props: { label: 'Submit', action: 'submit' }, on: { press: { action: 'submit' } } },
})
const catalog = spec({
  root: { type: 'Card', props: { title: 'Q4 rollout', description: 'A compact view of the next milestone.' }, children: ['tabs'] },
  tabs: { type: 'Tabs', props: { labels: ['Overview', 'Details'] }, children: ['overview', 'details'] },
  overview: { type: 'Stack', props: { gap: 18 }, children: ['heading', 'body', 'facts', 'progress', 'owner', 'sep', 'badges', 'accordion', 'code', 'link', 'switch', 'caption'] },
  heading: { type: 'Heading', props: { text: 'Ready for the next milestone' } },
  body: { type: 'Text', props: { text: 'Finish the pilot, review the findings, then expand to the whole team.' } },
  facts: { type: 'KeyValue', props: { items: [{ label: 'Target date', value: 'November 20' }, { label: 'Pilot group', value: '10 teammates' }, { label: 'Budget', value: '$1,200 / month' }] } },
  progress: { type: 'Progress', props: { label: 'Pilot readiness', value: 72 } },
  owner: { type: 'Avatar', props: { initials: 'AL', name: 'Alex Lee', caption: 'Rollout owner' } },
  sep: { type: 'Separator', props: {} },
  badges: { type: 'Stack', props: { direction: 'horizontal', gap: 8 }, children: ['b1', 'b2', 'b3', 'b4', 'b5'] },
  b1: { type: 'Badge', props: { text: 'Pilot', variant: 'default' } },
  b2: { type: 'Badge', props: { text: 'Internal', variant: 'muted' } },
  b3: { type: 'Badge', props: { text: 'On track', variant: 'success' } },
  b4: { type: 'Badge', props: { text: 'Review needed', variant: 'warning' } },
  b5: { type: 'Badge', props: { text: 'Blocked', variant: 'danger' } },
  accordion: { type: 'Accordion', props: { title: 'What is included in the pilot?', text: 'Shared agent threads, weekly reporting, and a small group of teammates. Review the results before enabling the wider rollout.' } },
  code: { type: 'CodeBlock', props: { language: 'json', code: '{\n  "pilotSeats": 10,\n  "weeklyReports": true\n}' } },
  link: { type: 'Link', props: { label: 'Read the rollout guide', url: 'https://getoverlay.io' } },
  switch: { type: 'Switch', props: { label: 'Include weekly updates', checked: { $bindState: '/updates' } } },
  caption: { type: 'Text', props: { variant: 'caption', text: 'Illustrative workspace data. Nothing is sent outside this preview.' } },
  details: { type: 'Stack', props: { gap: 16 }, children: ['detailHeading', 'detailText'] },
  detailHeading: { type: 'Heading', props: { text: 'Pilot acceptance' } },
  detailText: { type: 'Text', props: { variant: 'muted', text: 'Review task completion, credit usage, and feedback with the pilot group before November 20.' } },
})
function ResponsiveChart({ element: { props: p } }: ComponentRenderProps<{ title: string; description: string; values: number[]; labels: string[] }>) {
  const container = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(640)
  React.useLayoutEffect(() => {
    const node = container.current!
    const measure = () => setWidth(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const plotWidth = Math.max(1, width - 40)
  const step = plotWidth / p.values.length
  const barWidth = Math.min(35, step * 0.58)
  return <Card className="gen-card"><CardHeader><CardTitle>{p.title}</CardTitle><CardDescription>{p.description}</CardDescription></CardHeader><CardContent><div ref={container}><svg className="gen-chart" style={{ height: 190, display: 'block' }} width={width} height={190} viewBox={`0 0 ${width} 190`} role="img" aria-label="Daily completed tasks: Monday 5, Tuesday 8, Wednesday 6, Thursday 9, Friday 7, Saturday 4, Sunday 3"><title>Tasks completed by day</title>{[0, 5, 10].map(v => <g key={v}><line x1="30" x2={width - 10} y1={155-v*13} y2={155-v*13} stroke="var(--border)" strokeDasharray="3 3" /><text x="10" y={159-v*13}>{v}</text></g>)}{p.values.map((v: number, i: number) => {
    const x = 30 + step * (i + 0.5)
    return <g key={i}><rect x={x - barWidth / 2} y={155-v*13} width={barWidth} height={v*13} rx="4" fill="var(--chart-bar)"><title>{p.labels[i]}: {v} tasks</title></rect><text x={x} y="179" textAnchor="middle">{p.labels[i]}</text></g>
  })}</svg></div></CardContent></Card>
}
const FormReadOnly = React.createContext(false)
function BoundField({ element, bindings }: ComponentRenderProps<{ label: string; checked?: boolean; value?: string; options: string[]; placeholder?: string }>) {
  const p = element.props
  const readonly = React.useContext(FormReadOnly)
  const boolean = element.type === 'Checkbox' || element.type === 'Switch'
  const [value, setValue] = useBoundProp(boolean ? p.checked : p.value, bindings?.[boolean ? 'checked' : 'value'])
  const id = React.useId()
  if (boolean) {
    const Control = element.type === 'Checkbox' ? Checkbox : Switch
    return <label className="gen-check" htmlFor={id}><Control id={id} checked={!!value} onCheckedChange={setValue} disabled={readonly} />{p.label}</label>
  }
  return <div className="gen-field"><label htmlFor={id}>{p.label}</label>{element.type === 'Select' ? <Select value={(value as string) ?? ''} onValueChange={setValue} disabled={readonly}><SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose severity" /></SelectTrigger><SelectContent>{p.options.map((v: string) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select> : element.type === 'Textarea' ? <Textarea id={id} value={(value as string) ?? ''} onChange={e => setValue(e.target.value)} readOnly={readonly} placeholder={p.placeholder} rows={3} /> : <Input id={id} value={(value as string) ?? ''} onChange={e => setValue(e.target.value)} readOnly={readonly} placeholder={p.placeholder} />}</div>
}
const registry: ComponentRegistry = {
  Stack: ({ element: { props: p }, children }) => <div className={'gen-stack ' + (p.direction === 'horizontal' ? 'horizontal' : '')} style={{ gap: p.gap ?? 16 }}>{children}</div>,
  Grid: ({ element: { props: p }, children }) => <div className="gen-grid" style={{ '--columns': p.columns } as React.CSSProperties}>{children}</div>,
  Card: ({ element: { props: p }, children }) => <Card className="gen-card"><CardHeader><CardTitle>{p.title}</CardTitle><CardDescription>{p.description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>,
  Text: ({ element: { props: p } }) => <p className={'gen-text ' + (p.variant ?? '')}>{p.text}</p>,
  Heading: ({ element: { props: p } }) => <h3 className="gen-heading">{p.text}</h3>,
  Badge: ({ element: { props: p } }) => <Badge variant={p.variant}>{p.text}</Badge>,
  Separator: () => <Separator />,
  Metric: ({ element: { props: p } }) => <Card className="gen-metric"><CardContent><p className="gen-muted">{p.label}</p><div className="metric-value">{p.value}{p.delta && <span className="metric-delta">{p.delta}</span>}</div></CardContent></Card>,
  Table: ({ element: { props: p } }) => <div data-slot="table-container" className="relative w-full overflow-x-auto"><table data-slot="table" className="w-full caption-bottom text-sm"><caption className="mt-4 text-sm text-muted-foreground">{p.caption}</caption><thead data-slot="table-header" className="[&_tr]:border-b"><tr className="border-b transition-colors hover:bg-muted/50">{p.columns.map((c: string) => <th key={c} className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap">{c}</th>)}</tr></thead><tbody data-slot="table-body" className="[&_tr:last-child]:border-0">{p.rows.map((row: string[]) => <tr key={row[0]} className="border-b transition-colors hover:bg-muted/50">{row.map((cell, i) => <td key={i} className="p-2 align-middle whitespace-nowrap">{cell}{i === 0 && cell === p.current && <Badge className="current-badge">Current</Badge>}</td>)}</tr>)}</tbody></table></div>,
  Chart: ResponsiveChart,
  Alert: ({ element: { props: p } }) => <Alert className={'gen-alert '+p.variant}><TriangleAlert size={16}/><AlertDescription>{p.text}</AlertDescription></Alert>,
  KeyValue: ({ element: { props: p } }) => <dl className="gen-facts">{p.items.map((item: { label: string; value: string }) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>,
  Progress: ({ element: { props: p } }) => <div className="gen-stack"><div className="gen-split"><span>{p.label}</span><span className="gen-muted">{p.value}%</span></div><Progress value={p.value} aria-label={p.label}/></div>,
  Avatar: ({ element: { props: p } }) => <div className="gen-owner"><Avatar><AvatarFallback>{p.initials}</AvatarFallback></Avatar><div>{p.name}<p className="gen-muted">{p.caption}</p></div></div>,
  Tabs: ({ element: { props: p }, children }) => <Tabs defaultValue={p.labels[0]}><TabsList>{p.labels.map((v: string) => <TabsTrigger key={v} value={v}>{v}</TabsTrigger>)}</TabsList>{React.Children.toArray(children).map((child, i) => <TabsContent key={p.labels[i]} value={p.labels[i]} className="gen-tab-content">{child}</TabsContent>)}</Tabs>,
  Accordion: ({ element: { props: p } }) => <Accordion type="single" collapsible><AccordionItem value="details"><AccordionTrigger>{p.title}</AccordionTrigger><AccordionContent>{p.text}</AccordionContent></AccordionItem></Accordion>,
  CodeBlock: ({ element: { props: p } }) => <CodeBlock size="sm"><CodeBlockHeader><CodeBlockTitle>{p.language}</CodeBlockTitle><CodeBlockCopyButton value={p.code}/></CodeBlockHeader><CodeBlockContent><code>{p.code}</code></CodeBlockContent></CodeBlock>,
  Link: ({ element: { props: p } }) => p.url.startsWith('https://') ? <a className="gen-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.label}<ExternalLink size={13}/></a> : null,
  Input: BoundField, Select: BoundField, Textarea: BoundField, Checkbox: BoundField, Switch: BoundField,
  Button: ({ element: { props: p }, emit }) => { const readonly = React.useContext(FormReadOnly); return <Button className="gen-submit" disabled={readonly} onClick={() => emit('press')}>{readonly ? 'Submitted' : p.label}</Button> },
}
class PartBoundary extends React.Component<{ summary: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div><p>{this.props.summary}</p><p className="gen-fallback">Could not display this view</p></div> : this.props.children }
}
function SpecPart({ value, summary, initialState = {}, readonly = false, onSubmit }: SpecPartProps) {
  return <PartBoundary summary={summary}><StateProvider initialState={initialState}><VisibilityProvider><SpecActions value={value} summary={summary} readonly={readonly} onSubmit={onSubmit}/></VisibilityProvider></StateProvider></PartBoundary>
}
function SpecActions({ value, summary, readonly, onSubmit }: SpecPartProps) {
  const store = useStateStore()
  return <FormReadOnly.Provider value={readonly}><ActionProvider handlers={{ submit: () => {
    const form = store.getSnapshot().form as BugForm | undefined
    if (!form?.title?.trim() || !form?.steps?.trim()) { toast('Add a title and steps to reproduce.'); return }
    onSubmit?.(structuredClone(form))
  } }}><Renderer spec={value} registry={registry} fallback={() => <div><p>{summary}</p><p className="gen-fallback">Could not display this view</p></div>}/></ActionProvider></FormReadOnly.Provider>
}
const submittedExample = { title: 'Thread search loses focus', severity: 'Medium', steps: '1. Open an agent thread.\n2. Search for a message.\n3. Type a second search term.', logs: true }
function FollowUp({ form }: { form: BugForm }) { return <div className="user-message form-followup">Submit bug report<br/>Title: {form.title}<br/>Severity: {form.severity}<br/>Steps to reproduce:<br/>{form.steps}<br/>Include recent logs: {form.logs ? 'Yes' : 'No'}</div> }
function Reply({ user, lead, children, index }: { user: string; lead: string; children: React.ReactNode; index: number }) {
  return <section className="gen-exchange" data-section={index}><div className="user-message">{user}</div><div className="assistant-label"><Avatar className="research-avatar"><AvatarFallback>R</AvatarFallback></Avatar><strong>Research</strong><span className="message-time">4:{40+index} PM</span></div><p className="gen-lead">{lead}</p><div className="gen-part">{children}</div><div className="gen-toolbar"><Button variant="ghost" size="icon-xs" aria-label="Copy response" onClick={() => { navigator.clipboard.writeText(lead); toast('Response copied') }}><Copy size={14}/></Button><Button variant="ghost" size="icon-xs" aria-label="Good response" onClick={() => toast('Feedback recorded')}><ThumbsUp size={14}/></Button><Button variant="ghost" size="icon-xs" aria-label="Poor response" onClick={() => toast('Feedback recorded')}><ThumbsDown size={14}/></Button></div></section>
}
function GenerativeTranscript() {
  const [submitted, setSubmitted] = React.useState<BugForm | null>(null)
  return <div className="messages generative-transcript">
    <Reply index={1} user="Compare our three plans for the team." lead="Here is how the three plans compare for your team."><SpecPart value={plans} summary="Team is $99 per month for 10 seats, 10 agents, and 3 computers."/><p className="gen-after">Team gives you room to grow without moving to Business yet.</p></Reply>
    <Reply index={2} user="How did agents do last week?" lead="Agents completed 42 tasks last week, up 12% from the week before."><SpecPart value={performance} summary="42 tasks completed, 1,284 credits used, median run time 6m 40s."/></Reply>
    <Reply index={3} user="Help me file a bug report." lead="Add the details below. Submit will post them back to this thread."><SpecPart key="live" value={bugForm} summary="Bug report form" initialState={{ form: { title: '', severity: 'Medium', steps: '', logs: true } }} readonly={!!submitted} onSubmit={setSubmitted}/>{submitted && <FollowUp form={submitted}/>}<p className="gen-example-label">Submitted example</p><SpecPart key="submitted" value={bugForm} summary="Submitted bug report" initialState={{ form: submittedExample }} readonly/><FollowUp form={submittedExample}/></Reply>
    <Reply index={4} user="Put the rollout details in one place." lead="Here is the pilot plan, with the owner and remaining details."><SpecPart value={catalog} initialState={{ updates: true }} summary="Q4 pilot is 72% ready. Alex Lee owns the rollout, targeting November 20."/></Reply>
    <Reply index={5} user="Show the regional breakdown." lead="Here is the regional summary."><SpecPart value={spec({ root: { type: 'UnavailableRegionalView', props: {} } })} summary="North America accounted for 24 tasks, Europe for 12, and Asia Pacific for 6. North America had the highest task volume last week."/></Reply>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
