import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowUp, AtSign, Bot, Check, ChevronDown, ChevronRight, CircleHelp, File, Folder, LoaderCircle, ListChecks, MessageSquare, Monitor, MoreHorizontal, PanelLeft, PanelRight, Plus, RotateCcw, Settings, Square, Sun, Users, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { AccountMenu } from './sidebar-account-menu'

type Thread = { id: string; title: string; status: 'working' | 'completed' | 'attention' | 'idle'; unread: boolean; activity: number; time: string; computer?: 'primary' | 'temporary'; prompt: string }
const initial: Thread[] = [
  { id: 'pricing', title: 'Review subscription pricing', status: 'working', unread: false, activity: 4, time: 'Now', computer: 'temporary', prompt: 'Review our subscription pricing and compare it with the current market.' },
  { id: 'onboarding', title: 'Test the onboarding flow', status: 'working', unread: false, activity: 3, time: '2 min ago', computer: 'primary', prompt: 'Test the onboarding flow and flag anything that blocks a new customer.' },
  { id: 'research', title: 'Research customer feedback', status: 'completed', unread: true, activity: 2, time: '8 min ago', prompt: 'Summarize the recurring themes from this week’s customer feedback.' },
  { id: 'release', title: 'Draft release notes', status: 'completed', unread: false, activity: 1, time: 'Yesterday', prompt: 'Draft release notes for the latest update.' },
]
const cloneInitial = () => initial.map(t => ({ ...t }))
function Status({ thread }: { thread: Thread }) {
  if (thread.status === 'working') return <span className="state"><LoaderCircle className="spin" size={12} />Working</span>
  if (thread.status === 'attention') return <span className="state attention"><CircleHelp size={12} />Needs you</span>
  if (thread.status === 'completed') return <span className={'state ' + (thread.unread ? 'ready' : '')}><Check size={12} />{thread.unread ? 'Ready to review' : 'Completed'}</span>
  return <span className="state">New thread</span>
}
function App() {
  const [threads, setThreads] = React.useState(cloneInitial)
  const [selected, setSelected] = React.useState('pricing')
  const [page, setPage] = React.useState('thread')
  const [expanded, setExpanded] = React.useState(true)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
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
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Sidebar account</span></span><div><Button variant="ghost" size="sm" onClick={finish} disabled={!working}>Simulate completion</Button><Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={reset}><RotateCcw size={14} /></Button><Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
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
          account={<AccountMenu />}
        >
          {page === 'thread' ? <>
          <div className="agent-row">

            <Button variant="ghost" className="agent-name" onClick={() => open(sorted[0].id)}><OverlayMark size={22} /><span>Overlay<span className="agent-summary">{working > 0 ? `${working} working` : 'No active tasks'}{ready > 0 && <span className="ready"> · {ready} ready</span>}</span></span></Button>
            <Button variant="ghost" size="icon-xs" aria-label="New thread in Overlay" title="New thread" onClick={newThread}><Plus size={15} /></Button><Button variant="ghost" size="icon-xs" aria-label={expanded ? 'Collapse Overlay threads' : 'Expand Overlay threads'} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Button>
          </div>
          {expanded && <div className="thread-tree">{sorted.map(t => <Button key={t.id} variant="ghost" className={'thread-row ' + (selected === t.id && page === 'thread' ? 'active' : '')} onClick={() => open(t.id)} aria-current={selected === t.id && page === 'thread' ? 'page' : undefined}>
            <span className="thread-title">{t.title}</span>{t.unread && <span className="unread" aria-label="Unread result" />}<span className="thread-meta"><Status thread={t} /><span>· {t.time}</span></span>
          </Button>)}</div>}
          <div className="other-agent"><div className="mini-creature"><span /><span /></div><span>Scout<span className="agent-summary attention">Needs you</span></span><Button variant="ghost" size="icon-xs" aria-label="Preview Scout status" onClick={() => toast('Scout needs your input', { description: 'An approval or a question is waiting. This is an example of the attention state.' })}><CircleHelp size={15} /></Button></div>
          </> : <p className="chat-preview-note">Task completions appear in your existing Activity feed.</p>}
        </DoubleSidebar>
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={()=>setSidebarOpen(false)}><X size={16}/></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} />{page === 'activity' ? <><span className="crumb">Chats</span><ChevronRight size={13} /><span>Activity</span></> : <><span className="crumb">Agents</span><ChevronRight size={13} /><OverlayMark size={18} /><Button variant="ghost" className="crumb-agent" onClick={() => open(sorted[0].id)}>Overlay</Button><ChevronRight size={13} /><span className="breadcrumb-title">{current.title}</span></>}<span className="grow" />{page === 'thread' && <><Button variant="ghost" size="icon-sm" aria-label="Thread options" onClick={()=>toast('Thread options are unchanged')}><MoreHorizontal size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Thread members" onClick={()=>toast('Thread membership is unchanged')}><Users size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Thread computer details" onClick={() => setComputerOpen(!computerOpen)}><PanelRight size={16} /></Button></>}</header>
        {page === 'activity' ? <section className="activity-view"><h1>Activity</h1><div className="filters">{['all','unread','tasks'].map(f => <Button key={f} variant={filter === f ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(f)}>{f[0].toUpperCase()+f.slice(1)}</Button>)}</div><p className="day">Recent</p>{notifications.filter(t => filter !== 'unread' || !feedRead.includes(t.id)).map(t => <Button key={t.id} variant="ghost" className="notification-row" onClick={() => open(t.id)}><span className="notification-icon"><Check size={16} /></span><span className="notification-copy"><span>Overlay completed a task</span><strong>{t.title}</strong><small>{t.id === 'research' ? 'The feedback summary is ready.' : 'The result is ready in your thread.'}</small></span><span className="notification-time">{t.time}{!feedRead.includes(t.id) && <span className="unread" />}</span></Button>)}{filter === 'unread' && notifications.every(t => feedRead.includes(t.id)) && <p className="empty">You’re all caught up.</p>}</section> : <div className="thread-layout"><section className="conversation">
          <div className="conversation-heading"><div className="heading-meta"><Status thread={current} />{current.computer && <><span className="meta-separator">·</span><Button variant="ghost" size="xs" onClick={() => setComputerOpen(!computerOpen)}><Monitor size={13} />{current.computer === 'temporary' ? 'Temporary computer' : 'Agent computer'}{current.status === 'completed' ? current.computer === 'temporary' ? ' · Stopped' : ' · Released' : ''}</Button></>}</div></div>
          {current.status === 'idle' ? <div className="empty-thread"><OverlayMark size={36} /><h2>What should we work on?</h2><p>{working} other {working === 1 ? 'thread is' : 'threads are'} working. Start another task here.</p></div> : <div className="messages"><div className="user-message">{current.prompt}</div><div className="assistant-label"><OverlayMark size={22} /><strong>Overlay</strong><span className="message-time">4:42 PM</span></div>{current.status === 'working' ? <><p>{current.id === 'pricing' ? 'I’m comparing plan limits and pricing across similar products. I’ll put together a recommendation.' : current.id === 'onboarding' ? 'I’m walking through signup and the first-task experience, checking each step as a new customer.' : 'I’m working on this in its own thread. Your other tasks will continue independently.'}</p><div className="tool-row"><ChevronRight size={13} />{current.id === 'pricing' ? 'Comparing pricing pages' : 'Reviewing the task'}</div><OverlayMark size={24} motion="look" /></> : <><p>{current.id === 'research' ? 'Three themes came up repeatedly: getting started faster, clearer task progress, and knowing when results are ready.' : 'The review is complete. Here’s the summary and the recommended next step.'}</p><div className="result"><File size={20} /><span>{current.id === 'research' ? 'Customer feedback summary' : `${current.title} · Summary`}<small>Example result for this preview</small></span></div><p className="result-copy">{current.id === 'research' ? 'I’d prioritize clearer progress and completion notifications first. They address two of the three themes without adding another screen.' : 'The detailed findings and next steps are saved with this thread.'}</p></>}</div>}
          <div className="composer" data-slot="prompt-input"><Textarea aria-label="Message Overlay" value={draft} onChange={e => setDraft(e.target.value)} placeholder={current.status === 'working' ? 'Add a follow-up...' : 'Give Overlay a task...'} /><div><Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={()=>toast('Attachments are unchanged')}><Plus size={16}/></Button><Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={()=>toast('Mentions are unchanged')}><AtSign size={16}/></Button><Button variant="ghost" size="sm" onClick={()=>toast('Model selection is unchanged')}>Auto<ChevronDown size={12}/></Button><span className="grow" />{current.status === 'working' ? <><span className="composer-note">Working</span><Button variant="secondary" size="icon-sm" aria-label="Stop task" onClick={()=>toast('Use Simulate completion to preview a finished task')}><Square size={12}/></Button></> : <Button size="icon-sm" aria-label="Start task" disabled={!draft.trim()} onClick={start}><ArrowUp size={15} /></Button>}</div></div>
        </section>{computerOpen && <aside className="computer-panel"><div className="panel-title"><h2>Computer</h2><Button variant="ghost" size="icon-xs" aria-label="Close computer details" onClick={() => setComputerOpen(false)}><X size={15} /></Button></div><Monitor size={26} /><h3>{current.computer === 'temporary' ? 'Temporary computer' : current.computer ? 'Agent computer' : 'No computer in use'}</h3><p>{!current.computer ? 'This task does not need a computer yet.' : current.status === 'completed' ? current.computer === 'temporary' ? 'Stopped after the task finished. Results were saved to the thread.' : 'The task has released this computer. It is available for another thread.' : current.computer === 'temporary' ? 'The agent computer is busy in another thread. This task has its own isolated computer.' : 'Reserved for this thread while it uses the computer.'}</p>{current.computer && current.status === 'working' && <div className="computer-facts"><span>Used by<strong>{current.title}</strong></span><span>When this task ends<strong>{current.computer === 'temporary' ? 'Save results, then stop' : 'Release for another thread'}</strong></span>{current.computer === 'temporary' && <p>Normal computer usage rates apply. Workspace limits still apply.</p>}</div>}</aside>}</div>}
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
