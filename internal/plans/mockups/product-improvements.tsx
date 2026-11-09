import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { Bell, Plus, Bot, ListChecks, MessageSquare, Folder, Workflow, Sun, Moon, CircleHelp, Settings, ChevronDown, ChevronRight, PanelLeft, ArrowUp, Paperclip, X, BookOpen, Bug, ExternalLink, Check, LoaderCircle, Hash, MessageCircleQuestion } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../packages/overlay-ui/src/components/ui/dialog'
import { Popover, PopoverTrigger, PopoverContent } from '../../../packages/overlay-ui/src/components/ui/popover'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { AlignedBrandLockup, LibreBaskervilleWordmark, ApprovedOverlayMark as OverlayMark } from './aligned-brand'

const agents = [
  { name: 'Overlay', summary: '1 working · 1 ready', threads: [{ name: 'Review onboarding', state: 'ready', activity: true }, { name: 'Update pricing page', state: 'working', activity: true }, { name: 'Draft release notes', state: 'done', activity: false }] },
  { name: 'Atlas', summary: '1 needs you', threads: [{ name: 'Check the deployment', state: 'needs', activity: true }, { name: 'Audit dependencies', state: 'done', activity: false }] },
  { name: 'Scout', summary: 'No activity', threads: [{ name: 'Research competitors', state: 'done', activity: false }] },
]
function LoadingStatus() {
  const [opening, setOpening] = React.useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  React.useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setTimeout>
    function start() {
      clearTimeout(timer)
      setOpening(reduced.matches)
      if (!reduced.matches) timer = setTimeout(() => setOpening(true), 2600)
    }
    start()
    reduced.addEventListener('change', start)
    return () => { clearTimeout(timer); reduced.removeEventListener('change', start) }
  }, [])
  return <div className="onboarding-intro-line" role="status" aria-live="polite">
    {opening ? <span className="opening-workspace"><LoaderCircle className="spin" size={16}/><span>Opening Workspace…</span></span> : <span className="loader-tagline">Your AI Chief of Staff.</span>}
  </div>
}
function App() {
  const [page, setPage] = React.useState<'Chats' | 'Agents' | 'Loading'>('Loading')
  const [empty, setEmpty] = React.useState(true)
  const [dark, setDark] = React.useState(true)
  const [scope, setScope] = React.useState('workspace')
  const [filters, setFilters] = React.useState({ Chats: false, Agents: false })
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobile, setMobile] = React.useState(false)
  const [selected, setSelected] = React.useState('')
  const [closed, setClosed] = React.useState<string[]>([])
  const [header, setHeader] = React.useState<Element | null>(null)
  const [help, setHelp] = React.useState(false)
  const helpTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [dialog, setDialog] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [files, setFiles] = React.useState<File[]>([])
  const [error, setError] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [replay, setReplay] = React.useState(0)
  const [alignmentGuide, setAlignmentGuide] = React.useState(false)
  const [compareType, setCompareType] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const active = page !== 'Loading' && filters[page]
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  React.useLayoutEffect(() => { setHeader(document.querySelector('.double-sidebar-panel h2')?.parentElement ?? null) }, [page])
  function navigate(next: typeof page) { setPage(next); setCollapsed(false); setMobile(true); setQuery(''); setSearchOpen(false); setSelected('') }
  function toggle(name: string) { setClosed(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]) }
  function choose(name: string) { setSelected(name); setMobile(false) }
  function addFiles(incoming: File[]) {
    if ([...files, ...incoming].reduce((sum, f) => sum + f.size, 0) > 5 * 1024 * 1024) { setError('Attachments must be 5 MB or less in total.'); return }
    setFiles(p => [...p, ...incoming]); setError('')
  }
  function openBug() { setHelp(false); setSent(false); setDialog(true) }
  function keepHelp() { clearTimeout(helpTimer.current); setHelp(true) }
  function closeHelpLater() { helpTimer.current = setTimeout(() => setHelp(false), 180) }
  function group(title: string, children: React.ReactNode, add = true) { return <section className="resource-group"><div className="group-heading"><Button variant="ghost" onClick={() => toggle(title)}>{title}<ChevronDown size={13} style={{ transform: closed.includes(title) ? 'rotate(-90deg)' : undefined }}/></Button>{add && <Button variant="ghost" size="icon-xs" aria-label={`New ${title.toLowerCase()}`} onClick={() => choose(`New ${title === 'Channels' ? 'channel' : 'chat'}`)}><Plus size={15}/></Button>}</div>{!closed.includes(title) && children}</section> }
  function chatRows(channel = false) {
    const rows = channel ? [{name:'general',activity:true},{name:'product',activity:false},{name:'engineering',activity:true}] : [{name:'Maya Chen',activity:true},{name:'Alex Rivera',activity:false}]
    const visible = empty ? [] : rows.filter(r => (!active || r.activity) && r.name.toLowerCase().includes(query.toLowerCase()))
    if (!visible.length) return <p className="section-empty">{query ? 'No results' : active ? 'No activity yet' : channel ? 'No channels yet' : 'No workspace chats yet'}</p>
    return visible.map(r => <Button key={r.name} variant="ghost" className={'resource-row ' + (selected === r.name ? 'active' : '')} onClick={() => choose(r.name)}>{channel ? <Hash size={15}/> : <span className="person-avatar">{r.name.split(' ').map(s=>s[0]).join('')}</span>}<span>{r.name}</span>{r.activity && <span className="activity-dot" aria-label="Unread activity"/>}</Button>)
  }
  return <>
    <div className="preview-bar"><div><span>Mockup</span><Button variant="ghost" size="sm" className={page==='Chats'?'active':''} onClick={()=>navigate('Chats')}>Chats</Button><Button variant="ghost" size="sm" className={page==='Agents'?'active':''} onClick={()=>{setEmpty(false);navigate('Agents')}}>Agents</Button><Button variant="ghost" size="sm" className={page==='Loading'?'active':''} onClick={()=>navigate('Loading')}>Loading</Button></div><div>{page !== 'Loading' ? <Button variant="ghost" size="sm" onClick={()=>{setEmpty(!empty);setSelected('')}}>{empty ? 'Show sample activity' : 'Show empty state'}</Button> : <><Button variant="ghost" size="sm" aria-pressed={compareType} className={compareType ? 'active' : ''} onClick={()=>setCompareType(!compareType)}>Compare</Button><Button variant="ghost" size="sm" aria-pressed={alignmentGuide} onClick={()=>setAlignmentGuide(!alignmentGuide)}>{alignmentGuide ? 'Hide guide' : 'Show guide'}</Button><Button variant="ghost" size="sm" onClick={()=>setReplay(p=>p+1)}>Replay</Button></>}<Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={()=>setDark(!dark)}>{dark?<Sun size={15}/>:<Moon size={15}/>}</Button></div></div>
    {page === 'Loading' ? <main className="loading-stage" key={replay}><div className="loading-content"><div className={compareType ? 'loading-comparison' : ''}><div>{compareType && <p className="comparison-label">Logo wordmark</p>}<span className="onboarding-intro-lockup"><AlignedBrandLockup guide={alignmentGuide} motion="look"/></span></div>{compareType && <div><p className="comparison-label">Libre Baskerville</p><span className="onboarding-intro-lockup"><LibreBaskervilleWordmark guide={alignmentGuide}/></span></div>}</div><LoadingStatus/></div></main> : <div className={'shell '+(mobile?'sidebar-open':'')} data-app-shell>
      <div className="workspace-navigation"><DoubleSidebar brand="Overlay" title={page} panelKind="agents" scope={scope as 'workspace'|'personal'} collapsed={collapsed} onCollapsedChange={setCollapsed} resizable themePreset={dark?'default-dark':'default-light'} railBrand={<OverlayMark size={22}/>} onSearch={()=>setSearchOpen(!searchOpen)} panelAction={{label:page==='Agents'?'New agent':'New chat',onClick:()=>choose(page==='Agents'?'New agent':'New chat')}} panelNav={{activeId:scope,onSelect:setScope,items:[{id:'personal',label:'Personal'},{id:'workspace',label:'Workspace'}]}} items={[{id:'work',label:'Work',icon:ListChecks,onSelect:()=>choose('Work')},{id:'agents',label:'Agents',icon:Bot,active:page==='Agents',onSelect:()=>navigate('Agents')},{id:'chat',label:'Chats',icon:MessageSquare,active:page==='Chats',onSelect:()=>navigate('Chats')},{id:'files',label:'Files',icon:Folder,onSelect:()=>choose('Files')},{id:'automations',label:'Automations',icon:Workflow,onSelect:()=>choose('Automations')}]} account={<div className="rail-footer">
        <Button variant="ghost" size="icon" aria-label="Change theme" onClick={()=>setDark(!dark)}><Sun size={17}/></Button>
        <Popover open={help} onOpenChange={setHelp}><PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label="Help" onPointerEnter={keepHelp} onPointerLeave={closeHelpLater}><CircleHelp size={17}/></Button></PopoverTrigger><PopoverContent side="right" align="end" className="help-menu" onPointerEnter={keepHelp} onPointerLeave={closeHelpLater} onOpenAutoFocus={e=>e.preventDefault()}><Button variant="ghost" asChild><a href="https://getoverlay.io/docs" target="_blank" rel="noreferrer"><BookOpen size={16}/>Docs<ExternalLink size={13} className="end"/></a></Button><Button variant="ghost" onClick={openBug}><Bug size={16}/>Submit a bug</Button></PopoverContent></Popover>
        <Button variant="ghost" size="icon" aria-label="Settings" onClick={()=>choose('Settings')}><Settings size={17}/></Button><Button variant="ghost" className="account-avatar" aria-label="Account">DL</Button>
      </div>}>
        {searchOpen && <Input autoFocus aria-label="Search sidebar" placeholder="Search…" value={query} onChange={e=>setQuery(e.target.value)} className="sidebar-search"/>}
        {page === 'Chats' ? <>{group('Chats',chatRows())}{scope==='workspace' && group('Channels',chatRows(true))}</> : <div className="agents-list">{empty ? <p className="section-empty">{active?'No activity yet':'No agents yet'}</p> : agents.filter(a=> !active || a.threads.some(t=>t.activity)).map((a,i)=><div key={a.name} className="agent-block"><div className="agent-row"><Button variant="ghost" className="agent-name" onClick={()=>toggle(a.name)}>{i===0?<OverlayMark size={23}/>:<span className={'mini-creature creature-'+i}><span/><span/></span>}<span>{a.name}<span className="agent-summary">{a.summary}</span></span></Button><Button variant="ghost" size="icon-xs" aria-label={`New thread in ${a.name}`} onClick={()=>choose('New thread')}><Plus size={14}/></Button><Button variant="ghost" size="icon-xs" aria-label={`Toggle ${a.name} threads`} onClick={()=>toggle(a.name)}><ChevronDown size={13}/></Button></div>{!closed.includes(a.name)&&<div className="nested-threads">{a.threads.filter(t=>(!active||t.activity)&&t.name.toLowerCase().includes(query.toLowerCase())).map(t=><Button key={t.name} variant="ghost" className={'agent-thread '+(selected===t.name?'active':'')} onClick={()=>choose(t.name)}>{t.state==='working'?<LoaderCircle size={14} className="spin"/>:t.state==='needs'?<MessageCircleQuestion size={14} className="attention"/>:<Check size={14} className={t.state==='ready'?'ready':''}/>}<span>{t.name}</span></Button>)}</div>}</div>)}</div>}
      </DoubleSidebar><Button variant="secondary" size="sm" className="mobile-sidebar-close" onClick={()=>setMobile(false)}>Close sidebar</Button></div>
      {header && (page==='Agents'||scope==='workspace') && createPortal(<Button variant="ghost" size="icon" className={'activity-toggle '+(active?'active':'')} aria-label="Only show activity" title={active?'Show all':'Only show activity'} aria-pressed={active} onClick={()=>setFilters(p=>({...p,[page]:!p[page]}))}><Bell size={16}/></Button>,header)}
      <main className="main"><header className="header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={()=>{setCollapsed(!collapsed);setMobile(true)}}><PanelLeft size={16}/></Button><span className="crumb">{scope==='workspace'?'Workspace':'Personal'}</span><ChevronRight size={13}/><span>{page}</span>{selected&&<><ChevronRight size={13}/><span className="breadcrumb-title">{selected}</span></>}</header><section className="conversation">{selected?<><div className="messages"><div className="user-message">Can you review the onboarding flow?</div><div className="assistant-label"><OverlayMark size={22}/><strong>Overlay</strong></div><p>I reviewed the flow. The updated screens are ready for your review.</p></div></>:<div className="empty-thread"><OverlayMark size={32}/><h2>{page==='Agents'?'What would you like to work on?':'Start a conversation'}</h2></div>}<div className="composer"><Textarea aria-label="Message" placeholder="Message…"/><div><Button variant="ghost" size="icon-sm" aria-label="Attach"><Plus size={16}/></Button><Button variant="ghost" size="sm">Auto<ChevronDown size={12}/></Button><span className="grow"/><Button variant="secondary" size="icon-sm" aria-label="Send message"><ArrowUp size={15}/></Button></div></div></section></main>
    </div>}
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent className="bug-dialog"><DialogTitle>{sent?'Bug report submitted':'Submit a bug'}</DialogTitle><DialogDescription>{sent?'Thanks for helping us improve Overlay.':'What went wrong?'}</DialogDescription>{sent?<><p className="submission-note">Preview only. No GitHub issue or email was sent.</p><Button variant="secondary" onClick={()=>{setDialog(false);setDescription('');setFiles([])}}>Done</Button></>:<form onSubmit={e=>{e.preventDefault();if(!description.trim())return;setSending(true);setTimeout(()=>{setSending(false);setSent(true)},600)}}><Textarea autoFocus aria-label="Bug description" placeholder="Describe the bug and how to reproduce it…" value={description} onChange={e=>setDescription(e.target.value)} required disabled={sending}/><div className="attachment-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!sending)addFiles(Array.from(e.dataTransfer.files))}}><Button variant="ghost" size="sm" type="button" disabled={sending} onClick={()=>fileInput.current?.click()}><Paperclip size={15}/>Attach files</Button><span>Up to 5 MB total</span><Input ref={fileInput} type="file" multiple className="hidden" aria-label="Choose attachments" onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value=''}}/></div>{files.map((f,i)=><div className="file-row" key={i}><Paperclip size={14}/><span>{f.name}</span><small>{(f.size/1024).toFixed(0)} KB</small><Button variant="ghost" size="icon-xs" type="button" aria-label={`Remove ${f.name}`} disabled={sending} onClick={()=>{setFiles(p=>p.filter((_,j)=>j!==i));setError('')}}><X size={14}/></Button></div>)}{error&&<p className="file-error" role="alert">{error}</p>}<p className="privacy-note">Reports create a public GitHub issue and notify the Overlay team by email. Don’t include passwords or private information.</p><div className="dialog-actions"><span>Preview only</span><Button variant="ghost" type="button" disabled={sending} onClick={()=>setDialog(false)}>Cancel</Button><Button variant="secondary" type="submit" disabled={!description.trim()||sending}>{sending?<><LoaderCircle size={14} className="spin"/>Submitting…</>:'Submit bug'}</Button></div></form>}</DialogContent></Dialog>
  </>
}
createRoot(document.getElementById('root')!).render(<App/> )
