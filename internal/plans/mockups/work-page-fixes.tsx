import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Archive, ArrowUp, Bot, CalendarDays, ChevronDown, ChevronRight, CircleHelp, Flag, FolderTree, GitBranch, LayoutGrid, List, ListChecks, MessageSquare, Folder, Network, PanelLeft, Plus, RotateCcw, Search, Settings, Sun, User, UserCheck, Users, Workflow, X, CircleDot, CalendarRange, TriangleAlert, LoaderCircle, Check, ArrowUpRight } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { Creature } from '../../../src/components/orb/Creature'

type Status = 'todo' | 'progress' | 'review'
type Owner = 'agent' | 'me' | null
type Thread = { title: string; state: 'working' | 'finished'; time: string }
type Task = { id: string; title: string; status: Status; owner: Owner; due?: string; needsYou?: boolean; mine?: boolean; thread?: Thread }
const tasks: Task[] = [
  { id: 'yohei', title: 'draft an email to yohei', status: 'review', owner: 'agent', needsYou: true, mine: true, thread: { title: 'Draft an email to Yohei', state: 'finished', time: '1m' } },
  { id: 'pricing', title: 'Compare annual plan pricing with competitors', status: 'progress', owner: 'agent', due: 'Nov 12', thread: { title: 'Compare annual plan pricing', state: 'working', time: 'Now' } },
  { id: 'onboarding', title: 'Fix the onboarding checklist copy', status: 'progress', owner: 'me', due: 'Nov 10', mine: true },
  { id: 'notes', title: 'Write release notes for the Work page', status: 'todo', owner: 'me', mine: true },
  { id: 'faq', title: 'Answer the billing FAQ questions', status: 'todo', owner: null },
  { id: 'invoices', title: 'Reconcile October invoices', status: 'todo', owner: null, due: 'Nov 15' },
]
const GROUPS: Array<{ status: Status; label: string }> = [{ status: 'review', label: 'In review' }, { status: 'progress', label: 'In progress' }, { status: 'todo', label: 'Todo' }]
const STATUS_CLASS: Record<Status, string> = { todo: 'st-todo', progress: 'st-progress', review: 'st-review' }

function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" className={'status-icon ' + STATUS_CLASS[status]} aria-hidden>
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {status === 'progress' ? <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" /> : null}
    {status === 'review' ? <path d="M8 4a4 4 0 0 1 0 8a4 4 0 0 1 0-8Z" fill="currentColor" /> : null}
  </svg>
}
function Agent({ size = 20 }: { size?: number }) { return <Creature size={size} shape="hexagon" color="#1fa89a" animated={false} /> }
function Person({ owner, size = 20 }: { owner: Owner; size?: number }) {
  if (owner === 'agent') return <Agent size={size} />
  if (owner === 'me') return <span className="initials" style={{ width: size, height: size }}>DL</span>
  return <span className="unassigned" style={{ width: size, height: size }} />
}

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>('yohei')
  const [view, setView] = React.useState('list')
  const [draft, setDraft] = React.useState('')
  const [title, setTitle] = React.useState(tasks[0].title)
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const scope = 'workspace' as const
  const open = openId ? tasks.find(t => t.id === openId) ?? null : null
  const unchanged = (what: string) => toast(`${what} is unchanged in this proposal`)
  const viewLabel = { list: 'List', board: 'Board', timeline: 'Timeline', organization: 'Organization' }[view]

  function renderSection(id: string) {
    const rows = tasks.filter(t => id === 'needs-you' ? t.needsYou : id === 'mine' ? t.mine : true)
    return <SidebarMenuSub className="ml-0 border-l-0 pl-0">{rows.map(t => <SidebarMenuSubItem key={t.id}>
      <SidebarMenuSubButton isActive={openId === t.id} onClick={() => { setOpenId(t.id); setSidebarOpen(false) }} className="h-8 gap-2.5 text-sm"><StatusIcon status={t.status} size={14} /><span className="flex-1 truncate">{t.title}</span></SidebarMenuSubButton>
    </SidebarMenuSubItem>)}</SidebarMenuSub>
  }

  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Work page: settled scope, title header, chat-sized composer</span></span><div>
      <Button variant="ghost" size="sm" onClick={() => setOpenId(openId ? null : 'yohei')}>{openId ? 'Close task panel' : 'Open task panel'}</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={() => { setOpenId('yohei'); setView('list'); setCollapsed(false); setDraft(''); setTitle(tasks[0].title) }}><RotateCcw size={14} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button>
    </div></div>
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
          panelNav={{
            activeId: scope,
            activeChildId: `${scope}:${view}`,
            onSelect: id => {
              if (id === 'personal') toast('Scope stays put', { description: 'Switching is one navigation; the header, breadcrumb and lists all read the same scope.' })
              else if (id.startsWith('workspace:')) { setView(id.split(':')[1]); setSidebarOpen(false) }
            },
            items: ['personal', 'workspace'].map(s => ({ id: s, label: s === 'personal' ? 'Personal' : 'Workspace', children: [
              { id: `${s}:list`, label: 'List', icon: List },
              { id: `${s}:board`, label: 'Board', icon: LayoutGrid },
              { id: `${s}:timeline`, label: 'Timeline', icon: CalendarRange },
              { id: `${s}:organization`, label: 'Organization', icon: Network },
            ] })),
          }}
          sectionRows={[{ id: `${scope}:needs-you`, label: 'Needs you', badgeCount: 1 }, { id: `${scope}:mine`, label: 'Assigned to me' }, { id: `${scope}:all`, label: 'Everything' }]}
          renderSection={renderSection}
          onSearch={() => unchanged('Search')}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, active: true, onSelect: () => setSidebarOpen(false) },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => unchanged('Agents') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => unchanged('Chats') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => unchanged('Files') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => unchanged('Automations') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => unchanged('Help') },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => unchanged('Settings') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => unchanged('Account')}>DL</Button>}
        />
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="app-main">
        <div data-slot="app-screen-shell" className="screen-shell">
          <div data-slot="app-screen-layout" className="screen-layout">
            <div data-slot="app-screen-main" className="screen-main">
              <header data-slot="app-screen-header" className="work-header">
                <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button>
                <span className="crumb">Workspace</span><ChevronRight size={13} className="crumb-sep" /><span className="crumb">Work</span><ChevronRight size={13} className="crumb-sep" /><span className="crumb-current">{viewLabel}</span>
                <span className="header-meta">{tasks.length} open</span>
                <span className="flex-1" />
                <Button variant="ghost" size="icon-sm" aria-label="Search tasks" onClick={() => unchanged('Search')}><Search size={16} /></Button>
              </header>
              <div className="work-body">
                <div className="work-list" role="table" aria-label="Tasks">
                  {GROUPS.map(g => {
                    const rows = tasks.filter(t => t.status === g.status)
                    return <section key={g.status}>
                      <div className="group-head"><ChevronDown size={14} /><StatusIcon status={g.status} size={14} /><span>{g.label}</span><span className="group-count">{rows.length}</span></div>
                      {rows.map(t => <div key={t.id} role="row" className={'work-row' + (openId === t.id ? ' selected' : '')} onClick={() => setOpenId(t.id)}>
                        <StatusIcon status={t.status} size={15} />
                        <span className="row-title">{t.id === 'yohei' ? title : t.title}</span>
                        <span className="row-meta">{t.status === 'review' ? <span className="review-pill">Ready for review</span> : null}{t.due ? <span className="due">{t.due}</span> : null}<Person owner={t.owner} /></span>
                      </div>)}
                    </section>
                  })}
                </div>
              </div>
              <div className="composer-wrap">
                <div className="composer" data-slot="prompt-input">
                  <Textarea rows={1} aria-label="Describe a task" placeholder="Describe a task" value={draft} onChange={e => setDraft(e.target.value)} />
                  <div className="composer-footer">
                    <Button variant="ghost" size="icon" className="composer-icon" aria-label="Add file, note, chat or link" onClick={() => unchanged('Context')}><Plus size={16} /></Button>
                    <Button variant="ghost" size="sm" className="chip" onClick={() => unchanged('Assignee')} aria-label="Assignee"><User size={14} /><span className="chip-label">Assignee</span></Button>
                    <Button variant="ghost" size="sm" className="chip" onClick={() => unchanged('Schedule')}><CalendarDays size={14} /><span className="chip-label">Schedule</span></Button>
                    <Button variant="ghost" size="sm" className="chip chip-optional" onClick={() => unchanged('Depends on')}><GitBranch size={14} /><span className="chip-label">Depends on</span></Button>
                    <Button variant="ghost" size="icon" className="composer-icon" aria-label="Task settings" onClick={() => unchanged('Task settings')}><Settings size={15} /></Button>
                    <span className="flex-1" />
                    <Button variant="primary" size="icon" className="send" aria-label="Add task" disabled={!draft.trim()} onClick={() => { toast('Task added', { description: draft.trim() }); setDraft('') }}><ArrowUp size={17} strokeWidth={2} /></Button>
                  </div>
                </div>
              </div>
            </div>
            {open ? <aside data-slot="app-screen-right-panel" data-mode="docked" className="task-panel" aria-label="Task details">
              <header className="panel-header">
                <input className="panel-title" aria-label="Title" value={open.id === 'yohei' ? title : open.title} onChange={e => open.id === 'yohei' && setTitle(e.target.value)} />
                <Button variant="ghost" size="icon-sm" aria-label="Members" onClick={() => unchanged('Members')}><Users size={16} /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Archive task" onClick={() => unchanged('Archive')}><Archive size={16} /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Close task" onClick={() => setOpenId(null)}><X size={16} /></Button>
              </header>
              <div className="panel-body">
                <dl className="props">
                  <dt><CircleDot size={15} />Status</dt><dd><StatusIcon status={open.status} size={15} />{GROUPS.find(g => g.status === open.status)!.label}</dd>
                  <dt><User size={15} />Owner</dt><dd><Person owner={open.owner} size={18} />{open.owner === 'agent' ? 'Email Agent' : open.owner === 'me' ? 'Divyansh' : <span className="muted">None</span>}</dd>
                  <dt><MessageSquare size={15} />Thread</dt><dd>{open.thread ? <Button variant="ghost" size="sm" className="thread-link" onClick={() => toast('Opens the agent thread', { description: `Email Agent › ${open.thread!.title}` })}>
                    <span className="thread-link-title">{open.thread.title}</span>
                    <span className={'thread-state' + (open.thread.state === 'working' ? ' working' : '')}>{open.thread.state === 'working' ? <><LoaderCircle size={12} className="spin" />Working</> : <><Check size={12} />Finished · {open.thread.time}</>}</span>
                    <ArrowUpRight size={14} className="thread-arrow" />
                  </Button> : <span className="muted">{open.owner === 'agent' ? 'Starts when the agent picks it up' : 'None'}</span>}</dd>
                  <dt><UserCheck size={15} />Reviewer</dt><dd><span className="unassigned" style={{ width: 18, height: 18 }} /><span className="muted">None</span></dd>
                  <dt><Flag size={15} />Priority</dt><dd><span className="bars"><i /><i /><i className="off" /></span>Medium</dd>
                  <dt><CalendarDays size={15} />Dates</dt><dd><span className="muted">No dates</span></dd>
                  <dt><FolderTree size={15} />Inside</dt><dd><span className="muted">Not inside another task</span></dd>
                  <dt><TriangleAlert size={15} />Blocked</dt><dd><span className="toggle" /></dd>
                </dl>
                {open.status === 'review' ? <div className="review-card">
                  <p className="review-title"><StatusIcon status="review" size={15} />Waiting for your review</p>
                  <p className="review-copy">“{title}” is ready. Approve it to mark it done, or send it back to keep working.</p>
                  <div className="review-actions"><Button variant="secondary" size="sm" onClick={() => unchanged('Approve')}>Approve</Button><Button variant="ghost" size="sm" onClick={() => unchanged('Request changes')}>Request changes</Button></div>
                </div> : null}
                <section className="peek-section"><div className="section-head"><h3>Objective</h3><span>The outcome, not the steps</span></div><p className="placeholder">Describe what a good result looks like. Markdown works.</p></section>
                <section className="peek-section"><div className="section-head"><h3>Waiting on</h3></div><Button variant="ghost" size="sm" className="add-chip" onClick={() => unchanged('Waiting on')}><Plus size={14} />Wait on a task</Button></section>
                <section className="peek-section"><div className="section-head"><h3>Context</h3></div><Button variant="ghost" size="sm" className="add-chip" onClick={() => unchanged('Context')}><Plus size={14} />Add file, note, chat or link</Button></section>
                <section className="peek-section"><div className="section-head"><h3>Done when</h3></div><p className="placeholder check"><span className="box" />Add a condition</p></section>
                <section className="peek-section"><div className="section-head"><h3>Activity</h3></div><ol className="activity">
                  <li><strong>You</strong> created this task <span>7m</span></li>
                  <li><strong>Email Agent</strong> moved this to In progress <span>2m</span></li>
                  <li><strong>Email Agent</strong> moved this to In review <span>1m</span></li>
                </ol></section>
              </div>
            </aside> : null}
          </div>
        </div>
      </main>
    </div>
    <Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
