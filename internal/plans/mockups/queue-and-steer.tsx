import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, AtSign, Bot, ChevronDown, ChevronRight, CircleHelp, CornerDownLeft, Folder, ListChecks, ListEnd, MessageSquare, PanelLeft, Pencil, Plus, Settings, Square, Sun, Workflow, X, Code, Check } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SidebarMenu, SidebarMenuSubItem, SidebarMenuSubButton } from '../../../packages/overlay-ui/src/components/ui/sidebar'

type Surface = 'agent' | 'chat' | 'automation'
type Msg = { id: number; role: 'user' | 'assistant'; text: string; steered?: boolean; queued?: boolean; interrupted?: boolean }
type Queued = { id: number; text: string }

const SURFACES: Record<Surface, { crumb: string; title: string; name: string; prompt: string; recents: string[] }> = {
  agent: { crumb: 'Agents', title: 'Weekly pipeline review', name: 'Overlay', prompt: 'Review this week\'s pipeline and flag deals that slipped.', recents: ['Weekly pipeline review', 'Draft investor update', 'Triage support inbox'] },
  chat: { crumb: 'Chats', title: 'Release smoke test checklist', name: 'Overlay', prompt: 'Write a smoke test checklist for Friday\'s release.', recents: ['Release smoke test checklist', 'Learning enterprise go-to-market', 'Mapping mouse buttons'] },
  automation: { crumb: 'Automations', title: 'Daily email review', name: 'Overlay', prompt: 'Run the daily email review now and summarize anything urgent.', recents: ['Daily email review', 'Monday metrics digest'] },
}

const REPLIES = [
  'Here is what I found so far. Three deals moved out of this quarter: Northwind (security review pending), Acme Retail (budget re-approval) and Globex (champion left). Northwind is the largest at $84k and the most likely to recover if legal turns the review around this week. Acme needs a revised proposal before their finance meeting on Thursday, and Globex needs a new sponsor before anything else moves.',
  'Understood, focusing on that now. Northwind is still blocked on the security questionnaire; their team asked for the SOC 2 bridge letter on Tuesday and nobody has replied. I would send it today and propose a 20-minute call with their security lead.',
  'Done. I drafted the follow-up and left it in Drafts for you to review before it goes out.',
]

function useStream(onDone: React.MutableRefObject<() => void>) {
  const [msgs, setMsgs] = React.useState<Msg[]>([])
  const [streaming, setStreaming] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  const replyIndex = React.useRef(0)
  const stopTimer = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null }
  const respond = React.useCallback(() => {
    stopTimer()
    const words = REPLIES[Math.min(replyIndex.current++, REPLIES.length - 1)].split(' ')
    const id = Date.now() + Math.random()
    let i = 0
    setStreaming(true)
    setMsgs(m => [...m, { id, role: 'assistant', text: '' }])
    timer.current = window.setInterval(() => {
      i += 3
      setMsgs(m => m.map(x => x.id === id ? { ...x, text: words.slice(0, i).join(' ') } : x))
      if (i >= words.length) { stopTimer(); setStreaming(false); onDone.current() }
    }, 140)
  }, [onDone])
  const interrupt = () => { stopTimer(); setMsgs(m => m.map((x, i) => i === m.length - 1 && x.role === 'assistant' ? { ...x, interrupted: true } : x)); setStreaming(false) }
  const reset = (prompt: string) => { stopTimer(); replyIndex.current = 0; setMsgs([{ id: 1, role: 'user', text: prompt }]); window.setTimeout(respond, 300) }
  React.useEffect(() => stopTimer, [])
  return { msgs, setMsgs, streaming, respond, interrupt, reset }
}

function QueueTray({ items, onSteer, onEdit, onRemove }: { items: Queued[]; onSteer(q: Queued): void; onEdit(q: Queued): void; onRemove(q: Queued): void }) {
  if (!items.length) return null
  return <div className="queue-tray" aria-label="Queued messages">
    <div className="queue-head"><ListEnd size={13} /><span>{items.length} queued</span><span className="grow" /><span className="queue-hint">Sends when the response finishes</span></div>
    {items.map((q, i) => <div key={q.id} className="queue-row">
      <span className="queue-index">{i + 1}</span>
      <span className="queue-text">{q.text}</span>
      <Button variant="ghost" size="sm" className="queue-action" onClick={() => onSteer(q)}><CornerDownLeft size={13} />Steer now</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Edit queued message" onClick={() => onEdit(q)}><Pencil size={13} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Remove queued message" onClick={() => onRemove(q)}><X size={13} /></Button>
    </div>)}
  </div>
}

function Composer({ value, onChange, streaming, onSend, onQueue, onSteer, onStop }: { value: string; onChange(v: string): void; streaming: boolean; onSend(): void; onQueue(): void; onSteer(): void; onStop(): void }) {
  const hasText = Boolean(value.trim())
  return <div className="composer" data-slot="prompt-input">
    <Textarea aria-label="Message" value={value} onChange={e => onChange(e.target.value)} placeholder={streaming ? 'Queue a follow-up, or press ⌘↵ to steer' : 'Reply to Overlay'}
      onKeyDown={e => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
        e.preventDefault()
        if (!hasText) return
        if (!streaming) onSend()
        else if (e.metaKey || e.ctrlKey) onSteer()
        else onQueue()
      }} />
    <div>
      <Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={() => toast('Attachments are unchanged')}><Plus size={16} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={() => toast('Mentions are unchanged')}><AtSign size={16} /></Button>
      <span className="grow" />
      {streaming && <span className="composer-note"><kbd>↵</kbd> queue <span className="dot">·</span> <kbd>⌘↵</kbd> steer</span>}
      <Button variant="ghost" size="sm" onClick={() => toast('Model selection is unchanged')}>Claude Sonnet 5.5<ChevronDown size={12} /></Button>
      {streaming && hasText
        ? <Button size="icon-sm" aria-label="Queue message" title="Queue (Enter)" onClick={onQueue}><ListEnd size={15} /></Button>
        : streaming
          ? <Button size="icon-sm" aria-label="Stop" onClick={onStop}><Square size={12} fill="currentColor" /></Button>
          : <Button size="icon-sm" aria-label="Send" disabled={!hasText} onClick={onSend}><ArrowUp size={15} /></Button>}
    </div>
  </div>
}

function App() {
  const [surface, setSurface] = React.useState<Surface>('agent')
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
  const [draft, setDraft] = React.useState('')
  const [queue, setQueue] = React.useState<Queued[]>([])
  const onDone = React.useRef<() => void>(() => undefined)
  const s = useStream(onDone)
  const copy = SURFACES[surface]
  const queueRef = React.useRef(queue)
  React.useEffect(() => { queueRef.current = queue }, [queue])
  const scroller = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  React.useEffect(() => { s.reset(copy.prompt); setQueue([]); setDraft('') }, [surface])
  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [s.msgs, queue])
  React.useEffect(() => { onDone.current = () => {
    const [next, ...rest] = queueRef.current
    if (!next) return
    setQueue(rest)
    s.setMsgs(m => [...m, { id: next.id, role: 'user', text: next.text, queued: true }])
    window.setTimeout(s.respond, 350)
  } })
  const send = () => { s.setMsgs(m => [...m, { id: Date.now(), role: 'user', text: draft.trim() }]); setDraft(''); window.setTimeout(s.respond, 300) }
  const enqueue = () => { setQueue(q => [...q, { id: Date.now(), text: draft.trim() }]); setDraft('') }
  const steer = (text: string) => { s.interrupt(); s.setMsgs(m => [...m, { id: Date.now(), role: 'user', text, steered: true }]); window.setTimeout(s.respond, 250) }
  const go = (next: Surface) => { setSurface(next); setSidebarOpen(false) }
  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Queue (Enter) and steer (⌘ Enter) while a response streams</span></span><div>
      <div className="compare-toggle">{(['agent', 'chat', 'automation'] as Surface[]).map(k => <Button key={k} variant={surface === k ? 'secondary' : 'ghost'} size="sm" onClick={() => go(k)}>{k === 'agent' ? 'Agent thread' : k === 'chat' ? 'Chat' : 'Automation run'}</Button>)}</div>
      <Button variant="ghost" size="sm" onClick={() => { s.reset(copy.prompt); setQueue([]) }}>Replay</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <div className="workspace-navigation">
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title={copy.crumb}
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind={surface === 'agent' ? 'agents' : surface === 'chat' ? 'chat' : 'automations'}
          scope={scope}
          panelNav={{ activeId: scope, onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) }, items: [{ id: 'personal', label: 'Personal', children: [] }, { id: 'workspace', label: 'Workspace', children: [] }] }}
          onSearch={() => toast('Search is unchanged in this proposal')}
          panelAction={{ label: 'New', onClick: () => toast('Unchanged in this proposal') }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => toast('Unchanged in this proposal') },
            { id: 'agents', label: 'Agents', icon: Bot, active: surface === 'agent', onSelect: () => go('agent') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, active: surface === 'chat', onSelect: () => go('chat') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Unchanged in this proposal') },
            { id: 'automations', label: 'Automations', icon: Workflow, active: surface === 'automation', onSelect: () => go('automation') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('While a reply streams: Enter queues, ⌘ Enter steers.') },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => toast('Unchanged in this proposal') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => toast('Unchanged')}>DL</Button>}
        >
          <SidebarMenu aria-label={copy.crumb}>{copy.recents.map((title, i) => <SidebarMenuSubItem key={title}><SidebarMenuSubButton className={'single-line-thread' + (i === 0 ? ' active' : '')} onClick={() => toast('Unchanged in this proposal')}>{surface === 'automation' ? <Code size={13} /> : <MessageSquare size={13} />}<span className="thread-title">{title}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenu>
        </DoubleSidebar>
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} /><span className="crumb">{copy.crumb}</span><ChevronRight size={13} /><span className="breadcrumb-title">{copy.title}</span><span className="grow" /></header>
        <div className="conversation" ref={scroller}>
          <div className="messages">
            {s.msgs.map((m, i) => m.role === 'user'
              ? <div key={m.id} className="user-turn">{(m.steered || m.queued) && <span className="turn-tag">{m.steered ? <><CornerDownLeft size={11} />Steered</> : <><ListEnd size={11} />From queue</>}</span>}<div className="user-message">{m.text}</div></div>
              : <div key={m.id} className="assistant-turn">
                  {(i === 0 || s.msgs[i - 1].role === 'user') && <div className="assistant-label"><OverlayMark size={18} /><strong>{copy.name}</strong></div>}
                  <p className="stream-text">{m.text}{m.interrupted && <span className="interrupted"> Interrupted</span>}</p>
                  {s.streaming && i === s.msgs.length - 1 && <OverlayMark size={24} motion="look" />}
                  {!s.streaming && i === s.msgs.length - 1 && !m.interrupted && <span className="done-row"><Check size={12} />Done</span>}
                </div>)}
          </div>
          <div className="composer-stack">
            <QueueTray items={queue}
              onSteer={q => { setQueue(x => x.filter(y => y.id !== q.id)); if (s.streaming) steer(q.text); else { s.setMsgs(m => [...m, { id: q.id, role: 'user', text: q.text }]); window.setTimeout(s.respond, 250) } }}
              onEdit={q => { setQueue(x => x.filter(y => y.id !== q.id)); setDraft(q.text) }}
              onRemove={q => setQueue(x => x.filter(y => y.id !== q.id))} />
            <Composer value={draft} onChange={setDraft} streaming={s.streaming} onSend={send} onQueue={enqueue} onSteer={() => { const t = draft.trim(); setDraft(''); steer(t) }} onStop={s.interrupt} />
          </div>
        </div>
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
