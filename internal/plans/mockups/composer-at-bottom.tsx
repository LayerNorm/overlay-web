import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, AtSign, Bot, ChevronDown, ChevronRight, CircleHelp, Eye, Folder, Globe, ImageIcon, ListChecks, MessageSquare, Pencil, PanelLeft, Plus, Settings, Sun, Workflow, X, Calendar, Code } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SidebarMenu, SidebarMenuSubItem, SidebarMenuSubButton } from '../../../packages/overlay-ui/src/components/ui/sidebar'

type Page = 'chat' | 'automation'
const COPY: Record<Page, { heading: string; crumb: string; chips: { label: string; icon: React.ElementType }[]; recents: string[] }> = {
  chat: {
    heading: 'Hi Divyansh!', crumb: 'Chats',
    chips: [{ label: 'Create an image', icon: ImageIcon }, { label: 'Write or edit', icon: Pencil }, { label: 'Look something up', icon: Globe }],
    recents: ['Release smoke test checklist', 'Learning enterprise go-to-market', 'Mapping mouse buttons', 'Paul Nurse the scientist'],
  },
  automation: {
    heading: 'What are we automating today?', crumb: 'Automations',
    chips: [{ label: 'Build a workflow', icon: Workflow }, { label: 'Monitor a site', icon: Eye }, { label: 'Schedule a report', icon: Calendar }],
    recents: ['Daily email review'],
  },
}

function Composer({ value, onChange, onSend }: { value: string; onChange(v: string): void; onSend(): void }) {
  return <div className="composer" data-slot="prompt-input">
    <Textarea aria-label="Message" value={value} onChange={e => onChange(e.target.value)} placeholder="What do you want to get done?"
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }} />
    <div><Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={() => toast('Attachments are unchanged')}><Plus size={16} /></Button><Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={() => toast('Mentions are unchanged')}><AtSign size={16} /></Button><span className="grow" /><Button variant="ghost" size="sm" onClick={() => toast('Model selection is unchanged')}>Claude Sonnet 4.6<ChevronDown size={12} /></Button><Button size="icon-sm" aria-label="Send" disabled={!value.trim()} onClick={onSend}><ArrowUp size={15} /></Button></div>
  </div>
}

function App() {
  const [page, setPage] = React.useState<Page>('chat')
  const [layout, setLayout] = React.useState<'after' | 'before'>('after')
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
  const [draft, setDraft] = React.useState('')
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const copy = COPY[page]
  const send = () => { if (draft.trim()) { toast('Sending is unchanged in this proposal', { description: 'Only the composer position changes.' }); setDraft('') } }
  const chips = <div className="chips">{copy.chips.map(({ label, icon: Icon }) => <Button key={label} variant="ghost" onClick={() => setDraft(label)}><Icon size={13} />{label}</Button>)}</div>
  const go = (next: Page) => { setPage(next); setDraft(''); setSidebarOpen(false) }
  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Composer at the bottom in new chats and automations</span></span><div><div className="compare-toggle"><Button variant={layout === 'after' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLayout('after')}>Proposed</Button><Button variant={layout === 'before' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLayout('before')}>Current</Button></div><Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
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
          panelKind={page === 'chat' ? 'chat' : 'automations'}
          scope={scope}
          panelNav={{ activeId: scope, onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) }, items: [{ id: 'personal', label: 'Personal', children: [] }, { id: 'workspace', label: 'Workspace', children: [] }] }}
          onSearch={() => toast('Search is unchanged in this proposal')}
          panelAction={{ label: page === 'chat' ? 'New chat' : 'New automation', onClick: () => setDraft('') }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => toast('Tasks already keep the composer at the bottom') },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => toast('Agent threads already keep the composer at the bottom') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, active: page === 'chat', onSelect: () => go('chat') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Files are unchanged in this proposal') },
            { id: 'automations', label: 'Automations', icon: Workflow, active: page === 'automation', onSelect: () => go('automation') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Switch between Chats and Automations, and compare Proposed with Current.') },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => toast('Settings are unchanged in this proposal') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => toast('Account settings are unchanged')}>DL</Button>}
        >
          <SidebarMenu aria-label={copy.crumb}>{copy.recents.map(title => <SidebarMenuSubItem key={title}><SidebarMenuSubButton className="single-line-thread" onClick={() => toast('Existing conversations are unchanged')}>{page === 'chat' ? <MessageSquare size={13} /> : <Code size={13} />}<span className="thread-title">{title}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenu>
        </DoubleSidebar>
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} /><span className="crumb">{copy.crumb}</span><ChevronRight size={13} /><span>{page === 'chat' ? 'New conversation' : 'New automation'}</span><span className="grow" /></header>
        <section className="new-surface">
          {layout === 'after'
            ? <><div className="welcome"><h1>{copy.heading}</h1></div><div className="stack">{chips}<Composer value={draft} onChange={setDraft} onSend={send} /></div></>
            : <div className="welcome"><h1>{copy.heading}</h1><div className="stack"><Composer value={draft} onChange={setDraft} onSend={send} />{chips}</div></div>}
        </section>
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
