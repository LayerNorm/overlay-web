import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, ArrowUpRight, Bot, ChartGantt, ChevronDown, ChevronRight, CircleAlert, Folder, List, ListChecks, Menu, MessageSquare, Network, Plus, Settings, SquareKanban, Sun, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { BrandLockup } from '../../../packages/overlay-ui/src/components/orb/BrandLockup'
import { Avatar, StatusIcon, Tag } from '../../../src/features/work/components/work-ui'
import { LegacyAssignmentRows as AssignmentExecutionRows } from './legacy-work-assignment-rows'
import type { AssignmentExecution } from '../../../src/shared/work/assignment-execution'
import type { WorkStatus } from '../../../src/shared/work/status'

type Scenario = 'working' | 'blocked' | 'complete' | 'exceptions'
type Placement = 'group' | 'status'
type Design = 'proposed' | 'shipped'

const AGENTS = {
  sales: { name: 'Sales', color: '#899eaa', shape: 'cloud' },
  product: { name: 'Product', color: '#b599bb', shape: 'blob' },
  support: { name: 'Support', color: '#c8a27a', shape: 'droplet' },
} as const
type AgentId = keyof typeof AGENTS
const PARENT = 'Enterprise launch plan'
const BRIEFS: Record<string, string> = {
  sales: 'Assess the enterprise pipeline for accounts that could join a limited pilot. Return the strongest two candidates with the sponsor and the blocking requirement for each.',
  product: 'Identify launch blockers for the enterprise tier. Separate what gates a limited pilot from what gates general availability.',
  support: 'Summarize customer concerns from the last quarter that bear on an enterprise launch, with one suggested mitigation each.',
}
const RESULTS: Record<string, string> = {
  sales: 'Acme and Northstar are the strongest pilot candidates. Both have a confirmed sponsor and a clear need for SSO.',
  product: 'Start a limited pilot after SSO validation. Keep general availability gated on audit-log export and the security review.',
  support: 'Publish migration guidance and name an incident owner before inviting pilot accounts.',
}

type Fixture = { id: AgentId; title: string; status: string; disposition?: AssignmentExecution['disposition']; reason?: string; attempt: number; blocker?: string }
function fixtures(scenario: Scenario): Fixture[] {
  const base = [
    { id: 'sales' as const, title: 'Assess enterprise pipeline', attempt: 1 },
    { id: 'product' as const, title: 'Identify launch blockers', attempt: scenario === 'complete' ? 2 : 1 },
    { id: 'support' as const, title: 'Summarize customer concerns', attempt: 1 },
  ]
  return base.map(item => {
    if (scenario === 'complete') return { ...item, status: 'completed', disposition: 'accepted' as const }
    if (scenario === 'exceptions') {
      if (item.id === 'product') return { ...item, status: 'failed', disposition: 'excluded' as const, reason: 'Release data unavailable; omitted from this recommendation.' }
      if (item.id === 'support') return { ...item, status: 'cancelled', disposition: 'excluded' as const, reason: 'Optional follow-up cancelled by the Chief.' }
      return { ...item, status: 'completed', disposition: 'accepted' as const }
    }
    if (item.id === 'sales') return { ...item, status: 'completed' }
    if (item.id === 'product' && scenario === 'blocked') return { ...item, status: 'waiting_for_input', blocker: 'Should the recommendation cover a limited pilot or general availability?' }
    return { ...item, status: 'running' }
  })
}

/** How an execution state reads in Work vocabulary: a glyph, the group it sits in, and an optional tag. */
function workState(item: Fixture): { glyph: WorkStatus | 'failed'; group: WorkStatus; label: string; tag?: { tone: 'neutral' | 'danger' | 'attention'; text: string } } {
  if (item.status === 'completed') return { glyph: 'done', group: 'done', label: 'Done', tag: item.disposition === 'revision_requested' ? { tone: 'neutral', text: 'Revision requested' } : undefined }
  if (item.status === 'failed') return { glyph: 'failed', group: 'done', label: 'Failed', tag: { tone: 'danger', text: 'Failed' } }
  if (item.status === 'cancelled') return { glyph: 'backlog', group: 'done', label: 'Cancelled', tag: { tone: 'neutral', text: 'Cancelled' } }
  if (item.status.startsWith('waiting_for_')) return { glyph: 'review', group: 'review', label: 'Needs you', tag: { tone: 'attention', text: 'Needs you' } }
  return { glyph: 'progress', group: 'progress', label: 'In progress' }
}

function Glyph({ glyph, size = 16 }: { glyph: WorkStatus | 'failed'; size?: number }) {
  if (glyph === 'failed') return <CircleAlert size={size} strokeWidth={1.6} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />
  return <StatusIcon status={glyph} size={size} />
}

const agentPerson = (id: AgentId) => ({ displayName: AGENTS[id].name, type: 'agent' as const, isDefault: false, avatarColor: AGENTS[id].color, avatarShape: AGENTS[id].shape, photoUrl: undefined })
const DEV = { displayName: 'Dev Lalwani', type: 'human' as const, isDefault: false, avatarColor: undefined, avatarShape: undefined, photoUrl: undefined }

type Task = { id: string; title: string; status: WorkStatus; assignee: 'dev' | AgentId | null; due?: string }
const TASKS: Task[] = [
  { id: 'task-1', title: 'Publish launch checklist', status: 'todo', assignee: 'dev', due: 'Fri' },
  { id: 'task-2', title: 'Draft pilot invite email', status: 'progress', assignee: 'support' },
]
const GROUPS: WorkStatus[] = ['progress', 'review', 'todo', 'done']
const GROUP_LABELS: Record<WorkStatus, string> = { backlog: 'Backlog', todo: 'Todo', progress: 'In progress', review: 'In review', done: 'Done' }

function GroupHeader({ icon, label, count, open, onToggle }: { icon: React.ReactNode; label: string; count: number; open: boolean; onToggle(): void }) {
  return <Button variant="ghost" aria-expanded={open} onClick={onToggle} className="work-group-header flex w-full items-center gap-2.5 px-6 pb-1.5 pt-5 text-left text-[13px] font-medium text-(--foreground)">
    <ChevronDown size={14} className={'text-(--muted-light) transition-transform ' + (open ? '' : '-rotate-90')} aria-hidden />{icon}<span>{label}</span><span className="font-normal text-(--muted-light)">{count}</span>
  </Button>
}

function TaskRow({ task }: { task: Task }) {
  const person = task.assignee === 'dev' ? DEV : task.assignee ? agentPerson(task.assignee) : null
  return <div role="row" className="work-row flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6 transition-colors hover:bg-(--surface-muted)">
    <StatusIcon status={task.status} /><span className="min-w-0 flex-1 truncate text-left text-sm leading-5 text-(--foreground)">{task.title}</span>
    <div className="flex shrink-0 items-center gap-3.5 text-[12.5px] text-(--muted)">{task.due ? <span className="hidden w-14 text-right text-(--muted-light) sm:inline">{task.due}</span> : null}<Avatar person={person} /></div>
  </div>
}

function AssignmentRow({ item, selected, onOpen }: { item: Fixture; selected: boolean; onOpen(): void }) {
  const state = workState(item)
  return <div role="row" aria-selected={selected} onClick={onOpen} className={'work-row flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6 transition-colors hover:bg-(--surface-muted) ' + (selected ? 'bg-(--surface-subtle)' : '')}>
    <Glyph glyph={state.glyph} />
    <span className={'min-w-0 flex-1 truncate text-left text-sm leading-5 ' + (item.status === 'completed' ? 'text-(--muted)' : 'text-(--foreground)')}>{item.title}</span>
    <div className="flex shrink-0 items-center gap-3.5 text-[12.5px] text-(--muted)">
      {state.tag ? <Tag tone={state.tag.tone}>{state.tag.text}</Tag> : null}
      <span className="hidden max-w-36 truncate md:inline" title={PARENT}>{PARENT}</span>
      <Avatar person={agentPerson(item.id)} title={AGENTS[item.id].name + ' (agent)'} />
    </div>
  </div>
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return <><div className="flex h-[30px] items-center text-(--muted)">{label}</div><div className="flex h-[30px] min-w-0 items-center gap-2 text-(--foreground)">{children}</div></>
}

function AssignmentPanel({ item, origin, onClose, notify }: { item: Fixture; origin: boolean; onClose(): void; notify(message: string): void }) {
  const state = workState(item)
  return <aside className="work-peek" aria-label={item.title}>
    <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 px-3 py-3">
      <span className="flex min-w-0 items-center gap-2 px-2 text-[11.5px] uppercase tracking-[0.06em] text-(--muted-light)"><Bot size={13} aria-hidden />Agent assignment</span>
      <Button variant="ghost" size="icon-sm" aria-label="Close assignment" onClick={onClose}><X size={15} /></Button>
    </header>
    <div className="min-h-0 flex-1 overflow-auto px-5 pb-6">
      <h2 className="text-lg font-medium leading-snug tracking-[-0.2px]">{item.title}</h2>
      <div className="mt-4 grid grid-cols-[112px_1fr] gap-x-4 text-[13px]">
        <Property label="Status"><Glyph glyph={state.glyph} size={14} />{state.label}{item.disposition === 'accepted' ? <span className="text-(--muted)">· Accepted by the Chief</span> : null}</Property>
        <Property label="Agent"><Avatar person={agentPerson(item.id)} size={18} />{AGENTS[item.id].name}</Property>
        <Property label="Assigned from"><Button variant="ghost" className="h-7 gap-1.5 px-1.5 font-normal" onClick={() => notify('Opens the Chief thread in Agents.')}><OverlayMark size={16} />{PARENT}</Button></Property>
        {item.attempt > 1 ? <Property label="Attempt">{item.attempt} of {item.attempt} <span className="text-(--muted)">· revised in the same thread</span></Property> : null}
        {origin ? <Property label="Origin">Slack · #launch</Property> : null}
      </div>
      <section className="mt-6"><h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-(--muted-light)">Brief</h3><p className="text-[13.5px] leading-relaxed text-(--foreground)">{BRIEFS[item.id]}</p></section>
      {item.status === 'completed' ? <section className="mt-6"><h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-(--muted-light)">Result</h3><p className="text-[13.5px] leading-relaxed text-(--foreground)">{RESULTS[item.id]}</p></section> : null}
      {item.blocker ? <div className="mt-6 rounded-xl border border-violet-300/70 bg-(--surface-elevated) p-4 dark:border-violet-500/40"><div className="mb-1 flex items-center gap-2 text-[13px] font-medium"><StatusIcon status="review" />Waiting on you</div><p className="text-[13.5px] leading-relaxed text-(--muted)">{item.blocker}</p><p className="mt-2 text-[12px] text-(--muted-light)">Answer in the assignment thread. The Chief resumes once the agent replies.</p></div> : null}
      {item.reason ? <section className="mt-6"><h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-(--muted-light)">Excluded by the Chief</h3><p className="text-[13.5px] leading-relaxed text-(--foreground)">{item.reason}</p></section> : null}
      <div className="mt-7 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => notify('Opens the assignment thread under ' + AGENTS[item.id].name + '.')}>Open thread<ArrowUpRight size={13} aria-hidden /></Button>
        <Button variant="secondary" size="sm" onClick={() => notify('Opens the Chief thread.')}>Open Chief thread</Button>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-(--muted-light)">Read-only record of an agent run. Status, owner and result come from the agent threads; there is nothing to edit here.</p>
    </div>
  </aside>
}

function SidebarRows({ rows, empty }: { rows: { id: string; glyph: WorkStatus | 'failed'; title: string; active?: boolean; onClick(): void }[]; empty: string }) {
  return <SidebarMenuSub className="ml-0 border-l-0 pl-0">
    {rows.length === 0 ? <SidebarMenuSubItem><p className="px-2 py-1.5 text-xs text-(--muted-light)">{empty}</p></SidebarMenuSubItem> : rows.map(row => <SidebarMenuSubItem key={row.id}>
      <SidebarMenuSubButton isActive={row.active} aria-current={row.active ? 'page' : undefined} onClick={row.onClick} className="h-8 gap-2.5 text-sm"><Glyph glyph={row.glyph} size={14} /><span className="flex-1 truncate">{row.title}</span></SidebarMenuSubButton>
    </SidebarMenuSubItem>)}
  </SidebarMenuSub>
}

function App() {
  const [design, setDesign] = React.useState<Design>('proposed')
  const [scenario, setScenario] = React.useState<Scenario>('working')
  const [placement, setPlacement] = React.useState<Placement>('group')
  const [origin, setOrigin] = React.useState(false)
  const [dark, setDark] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [closed, setClosed] = React.useState<string[]>(['done'])
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [scope, setScope] = React.useState<'workspace' | 'personal'>('workspace')
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  React.useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer) }, [notice])
  React.useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMobileOpen(false); setSelected(null) } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
  const notify = (message: string) => setNotice(message + ' Mockup only; nothing is opened or changed.')
  const items = fixtures(scenario).filter(item => (item.title + ' ' + AGENTS[item.id].name).toLowerCase().includes(query.trim().toLowerCase()))
  const tasks = TASKS.filter(task => task.title.toLowerCase().includes(query.trim().toLowerCase()))
  const current = items.find(item => item.id === selected) ?? null
  const toggle = (id: string) => setClosed(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
  const openCount = tasks.filter(task => task.status !== 'done').length + items.filter(item => workState(item).group !== 'done').length
  const shippedItems: AssignmentExecution[] = fixtures(scenario).map(item => ({ kind: 'agent_assignment', assignmentId: item.id, conversationId: item.id, agentId: item.id, agentName: AGENTS[item.id].name, agent: { avatarColor: AGENTS[item.id].color, avatarShape: AGENTS[item.id].shape }, title: item.title, brief: BRIEFS[item.id], createdAt: 1, scope, status: item.status, disposition: item.disposition, dispositionReason: item.reason, parent: { conversationId: 'chief', agentId: 'chief', title: PARENT, scope }, origin: origin ? { platform: 'slack', channelId: 'launch', channelName: 'launch', threadLinkId: 'link' } : undefined }))

  const group = (status: WorkStatus, extra: Fixture[] = []) => {
    const groupTasks = tasks.filter(task => task.status === status)
    if (groupTasks.length + extra.length === 0) return null
    const open = !closed.includes(status)
    return <section key={status} role="rowgroup">
      <GroupHeader icon={<StatusIcon status={status} />} label={GROUP_LABELS[status]} count={groupTasks.length + extra.length} open={open} onToggle={() => toggle(status)} />
      {open ? <>{groupTasks.map(task => <TaskRow key={task.id} task={task} />)}{extra.map(item => <AssignmentRow key={item.id} item={item} selected={item.id === selected} onOpen={() => setSelected(item.id)} />)}</> : null}
    </section>
  }

  const list = <div role="table" aria-label="Tasks" className="pb-10">
    {placement === 'status' ? GROUPS.map(status => group(status, items.filter(item => workState(item).group === status))) : <>
      {GROUPS.map(status => group(status))}
      {items.length > 0 ? <section role="rowgroup" aria-label="Agent assignments">
        <GroupHeader icon={<Bot size={16} strokeWidth={1.6} className="text-(--muted)" aria-hidden />} label="Agent assignments" count={items.length} open={!closed.includes('assignments')} onToggle={() => toggle('assignments')} />
        {!closed.includes('assignments') ? items.map(item => <AssignmentRow key={item.id} item={item} selected={item.id === selected} onOpen={() => setSelected(item.id)} />) : null}
      </section> : null}
    </>}
  </div>

  const shipped = <div className="pb-10">
    {GROUPS.map(status => group(status))}
    <section aria-label="Agent assignments" className="mx-6 mb-6 max-h-64 shrink-0 overflow-y-auto border-t border-(--border) pt-4">
      <h2 className="px-2 text-xs font-medium text-(--muted)">Agent assignments</h2>
      <AssignmentExecutionRows items={shippedItems} />
    </section>
  </div>

  const needsYou = items.filter(item => workState(item).group === 'review')
  const renderSection = (id: string) => {
    if (id === 'needs-you') return <SidebarRows empty="Nothing needs you" rows={needsYou.map(item => ({ id: item.id, glyph: 'review' as const, title: item.title, active: item.id === selected, onClick: () => setSelected(item.id) }))} />
    if (id === 'mine') return <SidebarRows empty="Nothing assigned to you" rows={tasks.filter(task => task.assignee === 'dev').map(task => ({ id: task.id, glyph: task.status, title: task.title, onClick: () => notify('Opens the task.') }))} />
    if (design === 'shipped') return <>
      <SidebarRows empty="No open tasks" rows={tasks.map(task => ({ id: task.id, glyph: task.status, title: task.title, onClick: () => notify('Opens the task.') }))} />
      <section className="mt-3 border-t border-(--border) pt-3"><h2 className="px-2 text-xs font-medium text-(--muted)">Agent assignments</h2><AssignmentExecutionRows items={shippedItems} /></section>
    </>
    return <SidebarRows empty="No open tasks" rows={[
      ...tasks.filter(task => task.status !== 'done').map(task => ({ id: task.id, glyph: task.status as WorkStatus | 'failed', title: task.title, onClick: () => notify('Opens the task.') })),
      ...items.filter(item => workState(item).group !== 'done').map(item => ({ id: item.id, glyph: workState(item).glyph, title: item.title, active: item.id === selected, onClick: () => setSelected(item.id) })),
    ]} />
  }

  return <>
    <div className="audit-toolbar" aria-label="Mockup controls"><div className="audit-toolbar-title"><strong>Work · agent assignments</strong><span>Design proposal for PR #409</span></div>
      <div className="cos-switch">{(['proposed', 'shipped'] as const).map(id => <Button key={id} variant="ghost" size="sm" aria-pressed={design === id} onClick={() => { setDesign(id); setSelected(null) }}>{id === 'proposed' ? 'Proposed' : 'Shipped today'}</Button>)}</div>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(value => !value)}><Sun size={15} /></Button>
    </div>
    <div className="audit-fixtures" aria-label="Fixture controls"><span>Preview state</span>
      <div className="audit-scenarios">{([['working', 'Working'], ['blocked', 'Needs you'], ['complete', 'Completed'], ['exceptions', 'Exceptions']] as const).map(([id, label]) => <Button key={id} size="sm" variant="ghost" aria-pressed={scenario === id} onClick={() => { setScenario(id); setSelected(null) }}>{label}</Button>)}</div>
      {design === 'proposed' ? <div className="audit-scenarios"><Button size="sm" variant="ghost" aria-pressed={placement === 'group'} onClick={() => setPlacement('group')}>Own group</Button><Button size="sm" variant="ghost" aria-pressed={placement === 'status'} onClick={() => setPlacement('status')}>Mixed by status</Button></div> : null}
      <Button size="sm" variant="ghost" aria-pressed={origin} onClick={() => setOrigin(value => !value)}>Slack origin</Button>
    </div>
    <div data-app-shell className={'cos-shell audit-shell ' + (mobileOpen ? 'cos-nav-open' : '')}>
      <div className="cos-navigation" data-sidebar-drawer={mobileOpen || undefined}><DoubleSidebar brand={<BrandLockup />} railBrand={<OverlayMark size={26} />} title="Work" collapsed={collapsed} onCollapsedChange={setCollapsed} resizable keyboardShortcut
        panelId="work-sidebar" panelKind="work" themePreset={dark ? 'default-dark' : 'default-light'} scope={scope}
        panelNav={{ activeId: scope, activeChildId: 'list', onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id); else notify('Switches the Work view.') }, items: [{ id: 'personal', label: 'Personal' }, { id: 'workspace', label: 'Workspace', children: [{ id: 'list', label: 'List', icon: List }, { id: 'board', label: 'Board', icon: SquareKanban }, { id: 'timeline', label: 'Timeline', icon: ChartGantt }, { id: 'organization', label: 'Organization', icon: Network }] }] }}
        sectionRows={[{ id: 'needs-you', label: 'Needs you' }, { id: 'mine', label: 'Assigned to me' }, { id: 'all', label: 'Everything' }]} renderSection={renderSection} sectionActions={{ all: { label: 'New task', onClick: () => notify('Focuses the task composer.') } }}
        items={[{ id: 'work', label: 'Work', icon: ListChecks, active: true, onSelect: () => setMobileOpen(false) }, { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => notify('Opens Agents.') }, { id: 'chat', label: 'Chats', icon: MessageSquare, onSelect: () => notify('Opens Chats.') }, { id: 'files', label: 'Files', icon: Folder, onSelect: () => notify('Opens Files.') }, { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => notify('Opens Automations.') }]}
        footerItems={[{ id: 'settings', label: 'Settings', icon: Settings, onSelect: () => notify('Opens Settings.') }]} onSearch={() => notify('Opens search.')}
        account={<Button size="icon-sm" variant="ghost" className="cos-account" aria-label="Account" onClick={() => notify('Opens the account menu.')}>DL</Button>} /></div>
      {mobileOpen && <Button variant="ghost" className="cos-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="cos-main">
        <header className="cos-header"><Button variant="ghost" size="icon-sm" className="cos-menu" aria-label="Open navigation" onClick={() => setMobileOpen(value => !value)}><Menu size={17} /></Button><span className="cos-muted work-crumb">Workspace</span><ChevronRight size={12} className="work-crumb" /><span className="cos-muted">Work</span><ChevronRight size={12} /><span>List</span><span className="cos-muted work-open-count">{openCount} open</span><span className="cos-grow" />
          <Input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={event => setQuery(event.target.value)} className="work-search h-8 text-[13px]" />
          <Button variant="secondary" size="sm" className="work-new-task" onClick={() => notify('Focuses the task composer.')}><Plus size={14} aria-hidden />New task</Button></header>
        <div className="work-body">
          <div className="work-column">
            <div className="cos-scroll">{design === 'proposed' ? list : shipped}</div>
            <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4"><div className="work-composer mx-auto w-full max-w-4xl rounded-2xl border border-(--border) bg-(--surface-elevated) px-4 py-3"><Textarea rows={1} aria-label="Describe a task" placeholder="Describe a task" className="min-h-11 w-full resize-none border-0 bg-transparent px-0.5 py-1 text-sm shadow-none focus-visible:ring-0" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); notify('Adds a task.') } }} /><div className="flex items-center justify-between text-[11px] text-(--muted-light)"><span>Enter to add · tasks land in Todo</span><Button variant="secondary" size="icon-sm" aria-label="Add task" onClick={() => notify('Adds a task.')}><ArrowUp size={15} /></Button></div></div></div>
          </div>
          {current && design === 'proposed' ? <AssignmentPanel item={current} origin={origin} onClose={() => setSelected(null)} notify={notify} /> : null}
        </div>
        <footer className="audit-footer"><span>{design === 'proposed' ? 'Proposed: assignments are Work rows. Same height, glyphs, tags and avatars as tasks; details open in the side panel; one-line sidebar rows.' : 'Shipped today in PR #409: a separate scroll box of three-line rows under the list, repeated in the sidebar.'}</span><span>Fictional data · no live services</span></footer>
      </main>
    </div>
    {notice && <div role="status" className="cos-toast audit-toast"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></Button></div>}
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
