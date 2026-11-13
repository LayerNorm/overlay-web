import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowUp, AtSign, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Download, ExternalLink, FileText, Folder, ListChecks, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Play, Plus, RotateCcw, Settings, Square, Sun, Users, Workflow, X } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { Dialog, DialogContent, DialogTitle } from '../../../packages/overlay-ui/src/components/ui/dialog'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { RightSidebar } from '../../../packages/overlay-modules-react/src/components/RightSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { Creature } from '../../../src/components/orb/Creature'

const AGENT = { name: 'Video Agent', color: '#d13b32', shape: 'squircle' }

type Kind = 'video' | 'image' | 'note'
type LibraryFile = { id: string; name: string; kind: Kind; meta: string; created: string; fresh?: boolean; hue?: number; snippet?: string }
const FILES: LibraryFile[] = [
  { id: 'a', name: 'day-01-v3-a.mp4', kind: 'video', meta: '0:35 · 1080p 60fps · Cinematic piano', created: 'Just now', fresh: true, hue: 222 },
  { id: 'b', name: 'day-01-v3-b.mp4', kind: 'video', meta: '0:35 · 1080p 60fps · Minimal electronic', created: 'Just now', fresh: true, hue: 262 },
  { id: 'c', name: 'day-01-v3-c.mp4', kind: 'video', meta: '0:35 · 1080p 60fps · Warm acoustic', created: 'Just now', fresh: true, hue: 192 },
  { id: 'sheet', name: 'end-card-contact-sheet.png', kind: 'image', meta: 'PNG · 2400 × 1350', created: 'Just now', fresh: true, hue: 222 },
  { id: 'notes', name: 'Day 01 render notes', kind: 'note', meta: 'Note', created: '2m ago', fresh: true, snippet: 'Removed the counters and autonomy meter. End card now types getoverlay.io into a large address bar with a soft key click. Loudness leveled to −14 LUFS on all three versions.' },
  { id: 'strategy', name: 'Overlay 30-Day Launch: Video Strategy (Approved)', kind: 'note', meta: 'Note', created: '1d ago', snippet: 'One 30–40 second film a day for 30 days. Each film shows one real task finished end to end, ending on the address bar.' },
]
const byId = (id: string) => FILES.find(f => f.id === id)!

function Poster({ hue = 222, small = false }: { hue?: number; small?: boolean }) {
  return <span className={'poster' + (small ? ' poster-small' : '')} style={{ '--poster-hue': hue } as React.CSSProperties} aria-hidden="true">
    <span className="poster-bar"><OverlayMark size={small ? 6 : 12} /><span>getoverlay.io</span></span>
  </span>
}
function FileThumb({ file }: { file: LibraryFile }) {
  if (file.kind === 'note') return <span className="file-thumb"><FileText size={15} /></span>
  return <span className="file-thumb media">{file.kind === 'image' ? <span className="sheet sheet-small">{[0, 1, 2, 3].map(i => <Poster key={i} small hue={file.hue! + i * 14} />)}</span> : <Poster small hue={file.hue} />}</span>
}

type Row = { verb: string; target?: string; code?: string; detail?: string; add?: number; del?: number; file?: string }
const DONE_ROWS: Row[] = [
  { verb: 'Read', target: 'day-01-brief.md' },
  { verb: 'Read', target: 'end-card.html', detail: ':1-120' },
  { verb: 'Searched', target: 'assets/music', detail: 'for "cinematic|electronic|acoustic"' },
  { verb: 'Edited', target: 'end-card.html', add: 42, del: 18 },
  { verb: 'Created', target: 'address-bar.css', add: 36 },
  { verb: 'Ran', code: 'npx hyperframes render day-01.html --fps 60 --size 1920x1080' },
  { verb: 'Ran', code: 'ffmpeg -i day-01.mp4 -i piano.wav -af loudnorm=I=-14 day-01-v3-a.mp4' },
  { verb: 'Created', target: 'day-01-v3-a.mp4', file: 'a' },
  { verb: 'Created', target: 'day-01-v3-b.mp4', file: 'b' },
  { verb: 'Created', target: 'day-01-v3-c.mp4', file: 'c' },
  { verb: 'Created', target: 'end-card-contact-sheet.png', file: 'sheet' },
  { verb: 'Saved note', target: 'Day 01 render notes', file: 'notes' },
]
const LIVE_ROWS: Row[] = [
  { verb: 'Read', target: 'day-02-brief.md' },
  { verb: 'Searched', target: 'src/films', detail: 'for "AddressBar"' },
  { verb: 'Edited', target: 'day-02.html', add: 20, del: 6 },
  { verb: 'Running', code: 'npx hyperframes render day-02.html --fps 60' },
]

function ToolRow({ row, onOpen, live }: { row: Row; onOpen(id: string): void; live?: boolean }) {
  const body = <>
    <span className="tool-verb">{row.verb}</span>
    {row.target && <span className={'tool-target' + (row.file ? ' is-file' : '')}>{row.target}{row.detail?.startsWith(':') && <span className="tool-range">{row.detail}</span>}</span>}
    {row.detail && !row.detail.startsWith(':') && <span className="tool-detail">{row.detail}</span>}
    {row.code && <code className="tool-code">{row.code}</code>}
    {row.add !== undefined && <span className="diff-add">+{row.add}</span>}
    {row.del !== undefined && <span className="diff-del">−{row.del}</span>}
    {live && <span className="tool-live" aria-label="In progress" />}
  </>
  if (row.file) return <Button variant="ghost" className="tool-line tool-line-button" onClick={() => onOpen(row.file!)}>{body}</Button>
  return <div className="tool-line">{body}</div>
}
function ToolGroup({ label, rows, open, onToggle, onOpen, live }: { label: string; rows: Row[]; open: boolean; onToggle(): void; onOpen(id: string): void; live?: boolean }) {
  return <div className="tool-group">
    <Button variant="ghost" className="tool-group-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{label}</span>{!live && <><span className="diff-add">+98</span><span className="diff-del">−18</span></>}</Button>
    {open && <div className="tool-lines">{rows.map((row, i) => <ToolRow key={i} row={row} onOpen={onOpen} live={live && i === rows.length - 1} />)}</div>}
  </div>
}

function VideoCard({ file, onOpen }: { file: LibraryFile; onOpen(id: string): void }) {
  return <Button variant="ghost" className="media-card" onClick={() => onOpen(file.id)} aria-label={`Preview ${file.name}`}>
    <span className="media-frame"><Poster hue={file.hue} /><span className="play"><Play size={11} fill="currentColor" /></span><span className="duration">0:35</span></span>
    <span className="media-caption"><span>{file.name}</span><small>{file.meta.split(' · ').slice(2).join('')}</small></span>
  </Button>
}
function ImageCard({ file, onOpen }: { file: LibraryFile; onOpen(id: string): void }) {
  return <Button variant="ghost" className="image-card" onClick={() => onOpen(file.id)} aria-label={`Enlarge ${file.name}`}>
    <span className="sheet">{[0, 1, 2, 3, 4, 5].map(i => <Poster key={i} small hue={file.hue! + i * 12} />)}</span>
  </Button>
}
function NoteCard({ file, onOpen }: { file: LibraryFile; onOpen(id: string): void }) {
  return <Button variant="ghost" className="note-card" onClick={() => onOpen(file.id)}>
    <span className="file-thumb"><FileText size={15} /></span>
    <span className="note-copy"><strong>{file.name}</strong><span>{file.snippet}</span></span>
  </Button>
}

function LibraryList({ onOpen }: { onOpen(id: string): void }) {
  return <div className="library-list">{FILES.map(file => <Button key={file.id} variant="ghost" className="library-row" onClick={() => onOpen(file.id)}>
    <FileThumb file={file} />
    <span className="library-copy"><span>{file.name}</span><small>{file.kind === 'note' ? 'Note' : file.kind === 'image' ? 'Image' : 'Video'} · Created {file.created.toLowerCase()}</small></span>
    {file.fresh && <span className="unread" aria-label="New in this thread" />}
  </Button>)}</div>
}

function FilePreview({ file, onBack, onClose }: { file: LibraryFile; onBack(): void; onClose(): void }) {
  const [playing, setPlaying] = React.useState(false)
  React.useEffect(() => setPlaying(false), [file.id])
  return <aside data-slot="right-sidebar" aria-label="File preview" className="file-preview">
    <div className="preview-head">
      <Button variant="ghost" size="icon-sm" aria-label="Back to Library" onClick={onBack}><ArrowLeft size={16} /></Button>
      <span className="preview-title"><strong>{file.name}</strong><small>{file.meta}</small></span>
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><X size={16} /></Button>
    </div>
    <div className="preview-body">
      {file.kind === 'video' && <Button variant="ghost" className="preview-video" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
        <Poster hue={file.hue} />{!playing && <span className="play"><Play size={15} fill="currentColor" /></span>}
        <span className="scrubber"><span style={{ width: playing ? '38%' : '0%' }} /></span>
      </Button>}
      {file.kind === 'image' && <span className="sheet preview-sheet">{[0, 1, 2, 3, 4, 5].map(i => <Poster key={i} small hue={file.hue! + i * 12} />)}</span>}
      {file.kind === 'note' && <div className="preview-note"><h3>{file.name}</h3><p>{file.snippet}</p><p>Music versions differ only in the audio bed. Picture, timing and end card are identical across A, B and C.</p><ul><li>Address bar types at 18 characters per second.</li><li>Key clicks sit 6 dB under the music.</li><li>Final frame holds for 1.2 s.</li></ul></div>}
      {file.kind !== 'note' && <dl className="preview-facts"><div><dt>Created by</dt><dd><Creature shape={AGENT.shape} color={AGENT.color} size={14} animated={false} label={AGENT.name} />{AGENT.name} · {file.created}</dd></div><div><dt>Thread</dt><dd>Daily launch video strategy</dd></div></dl>}
      <div className="preview-actions">
        <Button variant="secondary" size="sm" onClick={() => toast('Opens the file in Files')}><ExternalLink size={14} />Open in Files</Button>
        <Button variant="ghost" size="sm" onClick={() => toast('Downloads the original file')}><Download size={14} />Download</Button>
      </div>
    </div>
  </aside>
}

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
  const [panelOpen, setPanelOpen] = React.useState(() => window.innerWidth >= 768)
  const [tab, setTab] = React.useState('library')
  const [preview, setPreview] = React.useState<string | null>(null)
  const [lightbox, setLightbox] = React.useState(false)
  const [doneOpen, setDoneOpen] = React.useState(true)
  const [liveOpen, setLiveOpen] = React.useState(true)
  const [draft, setDraft] = React.useState('')
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  function open(id: string) {
    if (byId(id).kind === 'image' && !panelOpen) { setLightbox(true); return }
    setPanelOpen(true); setTab('library'); setPreview(id)
  }
  function openFromChat(id: string) {
    if (byId(id).kind === 'image') { setLightbox(true); return }
    open(id)
  }
  function reset() { setCollapsed(false); setSidebarOpen(false); setPanelOpen(true); setTab('library'); setPreview(null); setLightbox(false); setDoneOpen(true); setLiveOpen(true); setDraft(''); toast.dismiss() }
  const previewFile = preview ? byId(preview) : null
  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Agent files and tool rows</span></span><div>
      <Button variant={previewFile ? 'ghost' : 'secondary'} size="sm" onClick={() => { setPanelOpen(true); setTab('library'); setPreview(null) }}>Library</Button>
      <Button variant={previewFile ? 'secondary' : 'ghost'} size="sm" onClick={() => open('a')}>Preview</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={reset}><RotateCcw size={14} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button>
    </div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '') + (panelOpen ? ' panel-open' : '')}>
      <div className="workspace-navigation">
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Agents"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="agents"
          scope={scope}
          panelNav={{ activeId: scope, onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) }, items: [{ id: 'personal', label: 'Personal', children: [] }, { id: 'workspace', label: 'Workspace', children: [] }] }}
          onSearch={() => toast('Search is unchanged in this proposal')}
          panelAction={{ label: 'New agent', onClick: () => toast('Agent creation is unchanged in this proposal') }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => toast('Work is unchanged in this proposal') },
            { id: 'agents', label: 'Agents', icon: Bot, active: true, onSelect: () => setSidebarOpen(false) },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => toast('Chats render the same file cards and tool rows') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Files are unchanged in this proposal') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => toast('Automations are unchanged in this proposal') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Interactive design preview', { description: 'Open files from the chat, the tool rows or the Library tab.' }) },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => toast('Settings are unchanged in this proposal') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => toast('Account settings are unchanged.')}>DL</Button>}
        >
          <div className="agent-row">
            <Button variant="ghost" className="agent-name" onClick={() => setSidebarOpen(false)}><Creature shape={AGENT.shape} color={AGENT.color} size={22} animated={false} label={AGENT.name} /><span>{AGENT.name}<span className="agent-summary">1 working</span></span></Button>
            <Button variant="ghost" size="icon-xs" aria-label="New thread in Video Agent" onClick={() => toast('New threads are unchanged')}><Plus size={15} /></Button><Button variant="ghost" size="icon-xs" aria-label="Collapse Video Agent threads"><ChevronDown size={13} /></Button>
          </div>
          <div className="thread-tree">
            <Button variant="ghost" className="thread-row active" aria-current="page" onClick={() => setSidebarOpen(false)}><span className="thread-title">Daily launch video strategy</span><span className="thread-meta"><span className="state">Working</span><span>· Now</span></span></Button>
            <Button variant="ghost" className="thread-row" onClick={() => toast('Only one thread is interactive in this preview')}><span className="thread-title">Launch film sound pass</span><span className="thread-meta"><span className="state"><Check size={12} />Completed</span><span>· Yesterday</span></span></Button>
          </div>
          <div className="other-agent"><OverlayMark size={21} /><span>Overlay<span className="agent-summary">No active tasks</span></span></div>
        </DoubleSidebar>
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} /><span className="crumb">Agents</span><ChevronRight size={13} /><Creature shape={AGENT.shape} color={AGENT.color} size={18} animated={false} label={AGENT.name} /><Button variant="ghost" className="crumb-agent">{AGENT.name}</Button><ChevronRight size={13} /><span className="breadcrumb-title">Daily launch video strategy</span><span className="grow" /><Button variant="ghost" size="icon-sm" aria-label="Thread options" onClick={() => toast('Thread options are unchanged')}><MoreHorizontal size={16} /></Button><Button variant="ghost" size="icon-sm" aria-label="Thread members" onClick={() => toast('Thread membership is unchanged')}><Users size={16} /></Button><Button variant="ghost" size="icon-sm" aria-label="Toggle details panel" aria-pressed={panelOpen} className={panelOpen ? 'pressed' : ''} onClick={() => setPanelOpen(!panelOpen)}><PanelRight size={16} /></Button></header>
        <div className="thread-layout"><section className="conversation">
          <div className="messages">
            <div className="user-message">Remove the counters and the autonomy meter, rebuild the end card as an animated address bar, and give me three music options.</div>
            <div className="assistant-label"><Creature shape={AGENT.shape} color={AGENT.color} size={22} animated={false} label={AGENT.name} /><strong>{AGENT.name}</strong><span className="message-time">4:42 PM</span></div>
            <ToolGroup label="Worked for 4m 12s" rows={DONE_ROWS} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} onOpen={open} />
            <p>Day 01 v3 is done. The three versions share the same picture and differ only in music. None of them shows the day counter or the autonomy meter, and the end card now types “getoverlay.io” into a large address bar.</p>
            <div className="media-grid">{['a', 'b', 'c'].map(id => <VideoCard key={id} file={byId(id)} onOpen={openFromChat} />)}</div>
            <p>Here is the end card across the six key frames:</p>
            <ImageCard file={byId('sheet')} onOpen={openFromChat} />
            <NoteCard file={byId('notes')} onOpen={openFromChat} />
            <p><strong>Need from you:</strong> pick a music version (A, B or C), or tell me the feel you want if none of them works.</p>
            <div className="user-message">I love A. Lock it for Day 01 and start the Day 02 brief.</div>
            <div className="assistant-label"><Creature shape={AGENT.shape} color={AGENT.color} size={22} animated={false} label={AGENT.name} /><strong>{AGENT.name}</strong><span className="message-time">4:51 PM</span></div>
            <p>Locked A for Day 01. Starting Day 02 with the same end card.</p>
            <ToolGroup label="Working for 0:41" rows={LIVE_ROWS} open={liveOpen} onToggle={() => setLiveOpen(!liveOpen)} onOpen={open} live />
            <div className="pending-mark"><OverlayMark size={24} motion="look" /></div>
          </div>
          <div className="composer" data-slot="prompt-input"><Textarea aria-label="Message Video Agent" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a follow-up..." /><div><Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={() => toast('Attachments are unchanged')}><Plus size={16} /></Button><Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={() => toast('Mentions are unchanged')}><AtSign size={16} /></Button><Button variant="ghost" size="sm" onClick={() => toast('Model selection is unchanged')}>Auto<ChevronDown size={12} /></Button><span className="grow" /><span className="composer-note">Working</span><Button variant="secondary" size="icon-sm" aria-label="Stop task" onClick={() => toast('Stopping is unchanged')}><Square size={12} /></Button></div></div>
        </section></div>
      </main>
      {panelOpen && <div className="details-panel" data-slot="app-screen-right-panel">
        {previewFile ? <FilePreview file={previewFile} onBack={() => setPreview(null)} onClose={() => { setPreview(null); setPanelOpen(false) }} /> :
          <RightSidebar ariaLabel="Agent sidebar"
            hero={{ avatar: <Creature shape={AGENT.shape} color={AGENT.color} size={72} label={AGENT.name} />, title: AGENT.name, titleText: AGENT.name, subtitle: 'Add a description' }}
            tabs={[
              { id: 'details', label: 'Details', content: <p className="panel-note">Details are unchanged in this proposal.</p> },
              { id: 'library', label: 'Library', content: <LibraryList onOpen={open} /> },
              { id: 'computer', label: 'Computer', content: <p className="panel-note">Computer is unchanged in this proposal.</p> },
            ]}
            activeTab={tab} onTabChange={setTab} onClose={() => setPanelOpen(false)} />}
      </div>}
    </div>
    <Dialog open={lightbox} onOpenChange={setLightbox}>
      <DialogContent className="lightbox" showCloseButton>
        <DialogTitle className="lightbox-title">end-card-contact-sheet.png</DialogTitle>
        <span className="sheet">{[0, 1, 2, 3, 4, 5].map(i => <Poster key={i} hue={222 + i * 12} />)}</span>
        <div className="lightbox-actions"><Button variant="ghost" size="sm" onClick={() => { setLightbox(false); setPanelOpen(true); setTab('library'); setPreview('sheet') }}><PanelRight size={14} />Show in Library</Button><Button variant="ghost" size="sm" onClick={() => toast('Downloads the original file')}><Download size={14} />Download</Button></div>
      </DialogContent>
    </Dialog>
    <Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
