import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowUp, AtSign, Bot, Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp, Clock3, FilePlus2, FileText, Folder, FolderOpen, Image as ImageIcon, ListChecks, MessageSquare, Monitor, Moon, MoreHorizontal, PanelLeft, Play, Plus, Settings, Sun, Terminal, Upload, Workflow, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../packages/overlay-ui/src/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../../packages/overlay-ui/src/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../packages/overlay-ui/src/components/ui/tabs'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SidebarMenu, SidebarMenuSubButton, SidebarMenuSubItem } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { AgentCreature } from '../../../src/components/orb/Creature'

type FixtureFile = {
  fileId: string
  name: string
  kind: 'video' | 'image' | 'markdown' | 'pdf'
  mimeType: string
  size: string
  metadata: string
  updated: string
  duration?: string
  mediaKey?: 'a' | 'b'
  poster?: string
  note?: 'launch' | 'recap'
}

type Scenario = 'normal' | 'empty' | 'loading' | 'unavailable' | 'failed'
type PanelView = 'library' | 'preview'
type DockTab = 'details' | 'library' | 'computer'

declare global {
  interface Window {
    __AGENT_FILES_MEDIA__?: Record<string, string>
  }
}

const VIDEO_AGENT = { name: 'Video Agent', avatarColor: '#e44f46', avatarShape: 'blob', agentRole: 'custom' }

function svgData(svg: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const POSTER_A = svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#303b3a"/><stop offset="1" stop-color="#8c7761"/></linearGradient><radialGradient id="sun"><stop stop-color="#f6d6a1" stop-opacity=".9"/><stop offset="1" stop-color="#e5a86d" stop-opacity="0"/></radialGradient></defs><rect width="640" height="360" fill="url(#a)"/><circle cx="434" cy="138" r="160" fill="url(#sun)"/><path d="M0 278 171 206l105 44 118-83 246 102v91H0z" fill="#182423" opacity=".82"/><path d="M0 314 172 267l144 40 122-54 202 54v53H0z" fill="#33423b"/><rect x="86" y="46" width="4" height="260" fill="#f6d6a1" opacity=".42"/><rect x="105" y="72" width="2" height="215" fill="#f6d6a1" opacity=".24"/></svg>`)
const POSTER_B = svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d7c6ae"/><stop offset="1" stop-color="#a9a18b"/></linearGradient><linearGradient id="shadow" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#34413a" stop-opacity=".1"/><stop offset="1" stop-color="#17201c" stop-opacity=".84"/></linearGradient></defs><rect width="640" height="360" fill="url(#b)"/><circle cx="480" cy="104" r="108" fill="#f2d9ae" opacity=".56"/><path d="M0 259h640v101H0z" fill="#5c6959"/><path d="M98 250c42-56 115-79 185-65 52 11 94 39 122 72v103H98z" fill="#3f5148"/><path d="M0 0h640v360H0z" fill="url(#shadow)"/><path d="M452 0v360M473 0v360" stroke="#f8e7c7" stroke-opacity=".22" stroke-width="2"/><circle cx="477" cy="171" r="4" fill="#fff0cf"/></svg>`)
const END_CARD = svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="end" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d8c5a8"/><stop offset="1" stop-color="#9aab9c"/></linearGradient><radialGradient id="glow"><stop stop-color="#f4dfb8" stop-opacity=".88"/><stop offset="1" stop-color="#f4dfb8" stop-opacity="0"/></radialGradient></defs><rect width="960" height="540" fill="url(#end)"/><circle cx="746" cy="103" r="246" fill="url(#glow)"/><path d="M0 410 287 326l214 79 188-80 271 77v138H0z" fill="#32413a" opacity=".85"/><path d="M0 468 284 414l233 50 202-44 241 55v65H0z" fill="#24312c"/><circle cx="111" cy="111" r="24" fill="#f5ead7" opacity=".85"/><text x="112" y="244" fill="#f8f3e9" font-family="Arial,sans-serif" font-size="24" letter-spacing="5">A SMALL BEGINNING</text><text x="108" y="309" fill="#fffaf1" font-family="Arial,sans-serif" font-size="48" font-weight="500" letter-spacing="-1">Make room for the next.</text><text x="112" y="359" fill="#f3eadb" font-family="Arial,sans-serif" font-size="16" letter-spacing="4">DAY 01 · LAUNCH SERIES</text></svg>`)

const FILES: FixtureFile[] = [
  { fileId: 'file-day-01-a', name: 'Day 01 A.mp4', kind: 'video', mimeType: 'video/mp4', size: '186 KB', metadata: 'MP4 · 640 × 360', updated: 'Just now', duration: '0:04', mediaKey: 'a', poster: POSTER_A },
  { fileId: 'file-day-01-b', name: 'Day 01 B.mp4', kind: 'video', mimeType: 'video/mp4', size: '174 KB', metadata: 'MP4 · 640 × 360', updated: 'Just now', duration: '0:04', mediaKey: 'b', poster: POSTER_B },
  { fileId: 'file-end-card', name: 'End card.png', kind: 'image', mimeType: 'image/png', size: '2.4 MB', metadata: 'PNG · 1600 × 900', updated: 'Just now', poster: END_CARD },
  { fileId: 'file-launch-notes', name: 'Launch notes.md', kind: 'markdown', mimeType: 'text/markdown', size: '3.2 KB', metadata: 'Markdown · 8 min read', updated: '2 min ago', note: 'launch' },
  { fileId: 'file-launch-checklist', name: 'Launch checklist.pdf', kind: 'pdf', mimeType: 'application/pdf', size: '482 KB', metadata: 'PDF · 4 pages', updated: '2 min ago' },
]

const NEW_FILE: FixtureFile = {
  fileId: 'file-launch-recap', name: 'Launch recap.md', kind: 'markdown', mimeType: 'text/markdown',
  size: '1.1 KB', metadata: 'Markdown · 2 min read', updated: 'Just now', note: 'recap',
}

type ActivityStep = {
  id: string
  title: string
  icon: LucideIcon
  status: 'complete' | 'failed'
  details: { label: string; value: string }[]
}

function activitySteps(scenario: Scenario): ActivityStep[] {
  const read: ActivityStep = {
    id: 'read-notes', title: 'Read launch-notes.md', icon: FileText, status: 'complete',
    details: [
      { label: 'Path', value: '/workspace/launch/launch-notes.md' },
      { label: 'Exit code', value: '0' },
      { label: 'Duration', value: '0.8s' },
    ],
  }
  const encode: ActivityStep = {
    id: 'encode-video', title: 'Ran ffmpeg -i source.mp4 …', icon: Terminal, status: 'complete',
    details: [
      { label: 'Command', value: 'ffmpeg -i source.mp4 -vf "scale=640:-2" -c:v libx264 "Day 01 A.mp4"' },
      { label: 'Path', value: '/workspace/launch/Day 01 A.mp4' },
      { label: 'Exit code', value: '0' },
      { label: 'Duration', value: '18.4s' },
    ],
  }
  const failedEncode: ActivityStep = {
    id: 'encode-video-failed', title: 'Ran ffmpeg -i source.mp4 …', icon: Terminal, status: 'failed',
    details: [
      { label: 'Command', value: 'ffmpeg -i source.mp4 -c:v libx264 -profile:v high "Day 01 A.mp4"' },
      { label: 'Path', value: '/workspace/launch/Day 01 A.mp4' },
      { label: 'Exit code', value: '1 · encoder profile unsupported' },
      { label: 'Duration', value: '4.1s' },
    ],
  }
  const retry: ActivityStep = {
    id: 'encode-video-retry', title: 'Retried ffmpeg with baseline profile', icon: Terminal, status: 'complete',
    details: [
      { label: 'Command', value: 'ffmpeg -i source.mp4 -c:v libx264 -profile:v baseline "Day 01 A.mp4"' },
      { label: 'Path', value: '/workspace/launch/Day 01 A.mp4' },
      { label: 'Exit code', value: '0' },
      { label: 'Duration', value: '8.4s' },
    ],
  }
  const write: ActivityStep = {
    id: 'write-end-card', title: 'Wrote end-card.svg', icon: ImageIcon, status: 'complete',
    details: [
      { label: 'Path', value: '/workspace/launch/end-card.svg' },
      { label: 'Exit code', value: '0' },
      { label: 'Duration', value: '1.2s' },
    ],
  }
  const publish: ActivityStep = {
    id: 'publish-video', title: 'Published Day 01 A.mp4', icon: Upload, status: 'complete',
    details: [
      { label: 'File', value: 'Day 01 A.mp4 · video/mp4' },
      { label: 'Destination', value: 'This conversation · Library' },
      { label: 'Exit code', value: '0' },
      { label: 'Duration', value: '2.6s' },
    ],
  }
  return scenario === 'failed' ? [read, failedEncode, retry, write, publish] : [read, encode, write, publish]
}

function FileGlyph({ file, compact = false }: { file: FixtureFile; compact?: boolean }) {
  if ((file.kind === 'video' || file.kind === 'image') && file.poster) {
    return <img className={compact ? 'file-glyph file-glyph-compact' : 'file-glyph'} src={file.poster} alt="" />
  }
  const Icon = file.kind === 'pdf' ? FileText : FileText
  return <span className={`file-glyph file-glyph-icon ${file.kind === 'pdf' ? 'pdf-glyph' : ''}`}><Icon size={compact ? 16 : 18} aria-hidden /></span>
}

function ActivityGroup({ scenario }: { scenario: Scenario }) {
  const [expanded, setExpanded] = React.useState(false)
  const [openSteps, setOpenSteps] = React.useState<Record<string, boolean>>({})
  const steps = activitySteps(scenario)
  return <section className="worked-group" aria-label="Agent activity">
    <Button variant="ghost" className="worked-summary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="worked-clock"><Clock3 size={14} aria-hidden /></span>
      <span className="worked-title">Worked for 2m 14s</span>
      <span className="worked-caption">{scenario === 'failed' ? 'one retry' : '4 steps'}</span>
      <ChevronDown size={14} className={expanded ? 'worked-chevron is-open' : 'worked-chevron'} aria-hidden />
    </Button>
    {expanded && <div className="activity-steps">
      {steps.map(step => {
        const Icon = step.icon
        const open = Boolean(openSteps[step.id])
        return <article className={`activity-step ${step.status === 'failed' ? 'step-failed' : ''}`} key={step.id}>
          <Button variant="ghost" className="activity-step-button" aria-expanded={open} aria-controls={`activity-detail-${step.id}`} onClick={() => setOpenSteps(previous => ({ ...previous, [step.id]: !previous[step.id] }))}>
            <span className="activity-step-icon"><Icon size={14} aria-hidden /></span>
            <span className="activity-step-title">{step.title}<small>{step.status === 'failed' ? 'Failed' : 'Completed'}</small></span>
            {step.status === 'failed' ? <CircleAlert size={14} className="step-status-error" aria-label="Failed" /> : <Check size={14} className="step-status-ok" aria-label="Completed" />}
            <ChevronRight size={13} className={open ? 'step-chevron step-chevron-open' : 'step-chevron'} aria-hidden />
          </Button>
          {open && <dl className="activity-step-detail" id={`activity-detail-${step.id}`}>
            {step.details.map(detail => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
          </dl>}
        </article>
      })}
      <p className="activity-fixture-note">Local activity fixture · not a live execution record</p>
    </div>}
  </section>
}

function VideoCard({ file, onOpen }: { file: FixtureFile; onOpen: (fileId: string) => void }) {
  return <Button variant="ghost" className="video-card" aria-label={`Open ${file.name} preview in the side panel`} onClick={() => onOpen(file.fileId)}>
    <span className="video-poster">
      <img src={file.poster} alt="" />
      <span className="poster-play"><Play size={16} fill="currentColor" aria-hidden /></span>
      <span className="poster-duration">{file.duration}</span>
    </span>
    <span className="video-card-copy"><strong>{file.name}</strong><span>Video · {file.size}</span></span>
    <ChevronRight size={14} className="video-card-arrow" aria-hidden />
  </Button>
}

function ImageCard({ file, onOpen }: { file: FixtureFile; onOpen: (fileId: string) => void }) {
  return <Button variant="ghost" className="image-card" aria-label={`Open ${file.name} preview in the side panel`} onClick={() => onOpen(file.fileId)}>
    <span className="image-card-art"><img src={file.poster} alt="" /></span>
    <span className="image-card-copy"><strong>{file.name}</strong><small>End card · {file.size}</small></span>
  </Button>
}

function NoteRow({ file, onOpen, fresh = false }: { file: FixtureFile; onOpen: (fileId: string) => void; fresh?: boolean }) {
  return <Button variant="ghost" className={`note-row ${fresh ? 'note-row-fresh' : ''}`} aria-label={`Open ${file.name} preview in the side panel`} onClick={() => onOpen(file.fileId)}>
    <span className="note-row-icon"><FileText size={16} aria-hidden /></span>
    <span className="note-row-copy"><strong>{file.name}</strong><small>{fresh ? 'New file · added to this conversation' : 'Markdown note · 3.2 KB'}</small></span>
    {fresh && <span className="new-file-pill">NEW</span>}
    <ChevronRight size={14} className="note-row-arrow" aria-hidden />
  </Button>
}

function FilePreview({ file }: { file: FixtureFile }) {
  if (file.kind === 'video') {
    const source = window.__AGENT_FILES_MEDIA__?.[file.mediaKey ?? 'a'] ?? ''
    return <div className="file-preview-body">
      <div className="preview-media-bar"><span><span className="media-dot" />Demo media</span><span>00:04 · synthetic clip</span></div>
      <video key={file.fileId} className="preview-video" controls playsInline preload="metadata" poster={file.poster} src={source} aria-label={`Preview of ${file.name}`} />
      <div className="preview-meta"><span>{file.name}</span><small>{file.mimeType} · {file.size} · {file.duration}</small></div>
    </div>
  }
  if (file.kind === 'image') {
    return <div className="file-preview-body">
      <div className="preview-media-bar"><span>Image preview</span><span>Embedded fixture</span></div>
      <div className="image-preview-frame"><img src={file.poster} alt="End card artwork: Make room for the next" /></div>
      <div className="preview-meta"><span>{file.name}</span><small>{file.metadata} · {file.size}</small></div>
    </div>
  }
  if (file.kind === 'markdown') {
    return <div className="file-preview-body note-preview-body">
      <div className="preview-media-bar"><span>Markdown preview</span><span>{file.size}</span></div>
      <article className="note-paper">
        {file.note === 'recap' ? <>
          <div className="note-eyebrow">DAY 01 · RECAP</div>
          <h2>Launch recap</h2>
          <p>The two short cuts are ready for review. Both keep the same quiet opening and warm closing frame.</p>
          <h3>Next pass</h3>
          <ul><li>Confirm the final title copy.</li><li>Keep the end card on screen for two beats.</li><li>Share the selected cut with the launch team.</li></ul>
        </> : <>
          <div className="note-eyebrow">VIDEO AGENT · WORKING NOTES</div>
          <h2>Day 01 launch</h2>
          <p>Keep the piece warm, quiet, and tactile. Let the first shot breathe before the title lands.</p>
          <h3>Cut A</h3>
          <p>Open on the golden-hour movement. Hold the final frame long enough to read without rushing.</p>
          <h3>Cut B</h3>
          <p>Use a tighter crop for the second version; keep the same sound bed and close on the end card.</p>
          <h3>Delivery</h3>
          <ul><li>Vertical-safe framing, with room around the title.</li><li>Keep the closing frame for two beats.</li><li>Export a clean master before sharing.</li></ul>
        </>}
      </article>
      <div className="preview-meta"><span>{file.name}</span><small>{file.mimeType} · {file.size}</small></div>
    </div>
  }
  return <div className="file-preview-body">
    <div className="preview-media-bar"><span>PDF preview</span><span>{file.size}</span></div>
    <div className="unsupported-preview" role="status">
      <span className="unsupported-icon"><FileText size={24} aria-hidden /></span>
      <h3>PDF preview isn’t available here</h3>
      <p>This standalone mockup keeps the file in the conversation Library. Open a video, image, or note to see an in-panel preview.</p>
      <small>{file.name} · {file.metadata}</small>
    </div>
  </div>
}

function FileRow({ file, onOpen }: { file: FixtureFile; onOpen: (fileId: string) => void }) {
  return <Button variant="ghost" className="file-row" onClick={() => onOpen(file.fileId)} aria-label={`Preview ${file.name} in the side panel`}>
    <FileGlyph file={file} />
    <span className="file-row-copy"><strong>{file.name}</strong><small>{file.size} <span>·</span> {file.metadata}</small></span>
    <span className="file-row-updated">{file.updated}</span>
    <ChevronRight size={14} className="file-row-chevron" aria-hidden />
  </Button>
}

function RightDock({
  files, scenario, setScenario, view, selectedFileId, activeTab, setActiveTab, onOpenFile, onBack, onClose, className = '',
}: {
  files: FixtureFile[]
  scenario: Scenario
  setScenario: (scenario: Scenario) => void
  view: PanelView
  selectedFileId: string | null
  activeTab: DockTab
  setActiveTab: (tab: DockTab) => void
  onOpenFile: (fileId: string) => void
  onBack: () => void
  onClose: () => void
  className?: string
}) {
  const selectedFile = files.find(file => file.fileId === selectedFileId)
  const isPreview = view === 'preview' && Boolean(selectedFile)
  return <aside className={`right-dock ${className}`} aria-label={isPreview ? `${selectedFile?.name} preview` : 'Agent details and conversation files'}>
    <div className="dock-header">
      {isPreview ? <div className="dock-preview-heading">
        <Button variant="ghost" size="sm" className="back-to-library" onClick={onBack}><ArrowLeft size={14} aria-hidden />Library</Button>
        <span className="dock-preview-name" title={selectedFile?.name}>{selectedFile?.name}</span>
      </div> : <span className="dock-heading-title">Agent workspace</span>}
      <Button variant="ghost" size="icon-sm" className="dock-close" aria-label="Close right panel" title="Close panel" onClick={onClose}><X size={15} aria-hidden /></Button>
    </div>
    {isPreview && selectedFile ? <FilePreview file={selectedFile} /> : <>
      <div className="dock-agent-hero">
        <AgentCreature agent={VIDEO_AGENT} isDefault={false} size={36} />
        <div><strong>Video Agent</strong><p>Short-form edits for launch moments.</p></div>
        <Button variant="ghost" size="icon-xs" aria-label="More agent details" onClick={() => toast('Agent actions are unchanged in this design preview.')}><MoreHorizontal size={16} aria-hidden /></Button>
      </div>
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as DockTab)} className="dock-tabs-root">
        <TabsList className="dock-tabs" aria-label="Agent workspace sections">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="computer">Computer</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="dock-tab-content">
          <div className="details-card">
            <div className="details-eyebrow">ABOUT THIS AGENT</div>
            <p>Creates thoughtful launch videos and supporting assets from your source footage.</p>
            <div className="details-divider" />
            <div className="details-fact"><span>Current thread</span><strong>Daily launch video</strong></div>
            <div className="details-fact"><span>Recent outputs</span><strong>{files.length} files</strong></div>
          </div>
        </TabsContent>
        <TabsContent value="library" className="dock-tab-content library-content">
          <div className="library-toolbar">
            <div><strong>{scenario === 'empty' ? 0 : files.length} files</strong><span>in this conversation</span></div>
            <div className="scenario-control">
              <span>Preview state</span>
              <Select value={scenario} onValueChange={value => setScenario(value as Scenario)}>
                <SelectTrigger className="scenario-trigger" aria-label="Preview state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="empty">Empty Library</SelectItem>
                  <SelectItem value="loading">Loading</SelectItem>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                  <SelectItem value="failed">Failed step</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {scenario === 'loading' ? <div className="library-loading" aria-busy="true" aria-label="Loading conversation files">
            {[0, 1, 2, 3].map(index => <div className="file-skeleton" key={index}><span /><span><i /><i /></span></div>)}
            <small>Loading files from this conversation…</small>
          </div> : scenario === 'unavailable' ? <div className="library-state" role="status">
            <span className="state-icon unavailable-icon"><CircleAlert size={20} aria-hidden /></span>
            <strong>Files are temporarily unavailable</strong>
            <p>Your chat is still here. Try loading the conversation Library again.</p>
            <Button variant="outline" size="sm" onClick={() => setScenario('normal')}>Retry</Button>
          </div> : scenario === 'empty' ? <div className="library-state" role="status">
            <span className="state-icon"><FolderOpen size={21} aria-hidden /></span>
            <strong>No files yet</strong>
            <p>Files created in this conversation will appear here and in the chat.</p>
          </div> : <div className="file-list" aria-label="Files in this conversation">
            {files.map(file => <FileRow key={file.fileId} file={file} onOpen={onOpenFile} />)}
          </div>}
          {scenario === 'failed' && <p className="scenario-footnote">The activity above includes a failed export and its successful retry.</p>}
          <div className="library-footer"><span className="library-footer-mark"><OverlayMark size={14} /></span><span>Files created in this conversation</span></div>
        </TabsContent>
        <TabsContent value="computer" className="dock-tab-content">
          <div className="computer-card">
            <span className="computer-icon"><Monitor size={20} aria-hidden /></span>
            <span className="computer-status"><i /> Ready for this thread</span>
            <h3>Computer</h3>
            <p>Video Agent used a temporary workspace to prepare these files. Published outputs are linked to this conversation.</p>
            <div className="computer-fact"><span>Workspace</span><strong>Daily launch video</strong></div>
            <div className="computer-fact"><span>Files published</span><strong>{files.length}</strong></div>
          </div>
        </TabsContent>
      </Tabs>
    </>}
  </aside>
}

function WorkspaceSidebar({
  dark, collapsed, setCollapsed, scope, setScope, toggleTheme, fileCount, mobile = false, closeMobile,
}: {
  dark: boolean
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  scope: 'personal' | 'workspace'
  setScope: (scope: 'personal' | 'workspace') => void
  toggleTheme: () => void
  fileCount: number
  mobile?: boolean
  closeMobile?: () => void
}) {
  const [threadsExpanded, setThreadsExpanded] = React.useState(true)
  const unchanged = (label: string) => toast(`${label} is unchanged in this design preview.`)
  return <DoubleSidebar
    railBrand={<OverlayMark size={24} />}
    brand={<OverlayMark size={24} />}
    title="Agents"
    themePreset={dark ? 'default-dark' : 'default-light'}
    collapsed={collapsed}
    onCollapsedChange={setCollapsed}
    resizable
    keyboardShortcut
    panelKind="agents"
    scope={scope}
    panelNav={{
      activeId: scope,
      onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) },
      items: [{ id: 'personal', label: 'Personal', children: [] }, { id: 'workspace', label: 'Workspace', children: [] }],
    }}
    onSearch={() => unchanged('Search')}
    panelAction={{ label: 'New agent', onClick: () => unchanged('New agent') }}
    items={[
      { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => unchanged('Work') },
      { id: 'agents', label: 'Agents', icon: Bot, active: true, onSelect: () => closeMobile?.() },
      { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => unchanged('Chats') },
      { id: 'files', label: 'Files', icon: Folder, onSelect: () => unchanged('Files') },
      { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => unchanged('Automations') },
    ]}
    footerItems={[
      { id: 'theme', label: 'Toggle theme', icon: dark ? Sun : Moon, onSelect: toggleTheme },
      { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => unchanged('Help') },
      { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => unchanged('Settings') },
    ]}
    account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => unchanged('Workspace and account')}>LM</Button>}
    className={mobile ? 'agent-files-sidebar mobile-agent-files-sidebar' : 'agent-files-sidebar'}
  >
    <div className="agent-row">
      <Button variant="ghost" className="agent-name" onClick={() => closeMobile?.()}>
        <AgentCreature agent={VIDEO_AGENT} isDefault={false} size={26} />
        <span>Video Agent<span className="agent-summary">{fileCount} files · active now</span></span>
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="New Video Agent thread" title="New thread" onClick={() => unchanged('New thread')}><FilePlus2 size={14} aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" aria-label={threadsExpanded ? 'Collapse Video Agent threads' : 'Expand Video Agent threads'} aria-expanded={threadsExpanded} onClick={() => setThreadsExpanded(value => !value)}>{threadsExpanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}</Button>
    </div>
    {threadsExpanded && <SidebarMenu className="agent-thread-tree" aria-label="Video Agent threads">
      <SidebarMenuSubItem>
        <SidebarMenuSubButton className="single-line-thread active-thread" isActive aria-current="page" onClick={() => closeMobile?.()}>
          <span className="thread-status-dot" aria-hidden="true" />
          <span className="thread-title">Daily launch video</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenu>}
    {threadsExpanded && <div className="sidebar-thread-note"><span>Today</span><span>1 thread</span></div>}
  </DoubleSidebar>
}

function App() {
  const [dark, setDark] = React.useState(false)
  const [isNarrow, setIsNarrow] = React.useState(false)
  const [desktopPanelOpen, setDesktopPanelOpen] = React.useState(true)
  const [mobilePanelOpen, setMobilePanelOpen] = React.useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
  const [scenario, setScenario] = React.useState<Scenario>('normal')
  const [panelView, setPanelView] = React.useState<PanelView>('library')
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<DockTab>('library')
  const [newFileAdded, setNewFileAdded] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const [localMessages, setLocalMessages] = React.useState<string[]>([])
  const conversationScrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1080px)')
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  React.useEffect(() => {
    if (!localMessages.length) return
    const conversation = conversationScrollRef.current
    conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' })
  }, [localMessages.length])

  const files = React.useMemo(() => newFileAdded ? [NEW_FILE, ...FILES] : FILES, [newFileAdded])

  function openLibrary() {
    setPanelView('library')
    setSelectedFileId(null)
    setActiveTab('library')
    if (isNarrow) setMobilePanelOpen(true)
    else setDesktopPanelOpen(true)
  }

  function openPreview(fileId: string) {
    setSelectedFileId(fileId)
    setPanelView('preview')
    setActiveTab('library')
    if (isNarrow) setMobilePanelOpen(true)
    else setDesktopPanelOpen(true)
  }

  function closeDock() {
    if (isNarrow) setMobilePanelOpen(false)
    else setDesktopPanelOpen(false)
  }

  function backToLibrary() {
    setPanelView('library')
    setSelectedFileId(null)
    setActiveTab('library')
  }

  function simulateNewFile() {
    const alreadyAdded = newFileAdded
    setNewFileAdded(true)
    setScenario('normal')
    setPanelView('library')
    setSelectedFileId(null)
    setActiveTab('library')
    setAnnouncement(alreadyAdded ? 'Launch recap.md is already in the chat and Library.' : 'Launch recap.md added to the chat and Library.')
    if (isNarrow) setMobilePanelOpen(true)
    else setDesktopPanelOpen(true)
  }

  function sendLocalMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message) return
    event.currentTarget.querySelector('textarea')?.style.removeProperty('height')
    setLocalMessages(previous => [...previous, message])
    setDraft('')
    toast('Preview-only message added', { description: 'No live agent was contacted.' })
  }

  function toggleWorkspaceSidebar() {
    if (window.matchMedia('(max-width: 840px)').matches) {
      setSidebarCollapsed(false)
      setMobileSidebarOpen(value => !value)
    } else {
      setSidebarCollapsed(value => !value)
    }
  }

  const openMobileLibrary = () => { setPanelView('library'); setSelectedFileId(null); setActiveTab('library'); setMobilePanelOpen(true) }
  const sidebar = (mobile: boolean) => <WorkspaceSidebar
    dark={dark}
    collapsed={sidebarCollapsed}
    setCollapsed={setSidebarCollapsed}
    scope={scope}
    setScope={setScope}
    mobile={mobile}
    fileCount={files.length}
    toggleTheme={() => setDark(value => !value)}
    closeMobile={mobile ? () => setMobileSidebarOpen(false) : undefined}
  />

  return <>
    <div className="preview-bar">
      <div className="preview-label"><span className="preview-kicker">DESIGN PREVIEW</span><span className="preview-divider">/</span><span className="preview-title">Agent files &amp; activity</span><span className="fixture-pill">Local fixtures</span></div>
      <div className="preview-actions">
        {announcement && <span className="preview-announcement" role="status">{announcement}</span>}
        <Button variant="outline" size="sm" className="simulate-file-button" onClick={simulateNewFile}><FilePlus2 size={14} aria-hidden />Simulate new file</Button>
        <Button variant="ghost" size="icon-sm" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}</Button>
      </div>
    </div>
    <div data-app-shell className="app-shell">
      <div className="workspace-navigation">{sidebar(false)}</div>
      <div className="workspace">
        <main className="conversation-panel" aria-label="Daily launch video conversation">
          <header className="conversation-header">
            <div className="conversation-breadcrumb">
              <Button variant="ghost" size="icon-sm" className="sidebar-toggle-button" aria-label="Toggle workspace sidebar" title="Toggle workspace sidebar" onClick={toggleWorkspaceSidebar}><PanelLeft size={16} aria-hidden /></Button>
              <nav className="breadcrumb-trail" aria-label={`Breadcrumb: ${scope === 'personal' ? 'Personal' : 'Workspace'}, Agents, Video Agent, Daily launch video`}>
                <span className="crumb breadcrumb-scope">{scope === 'personal' ? 'Personal' : 'Workspace'}</span>
                <ChevronRight size={13} className="breadcrumb-scope-separator" aria-hidden />
                <span className="crumb breadcrumb-section">Agents</span>
                <ChevronRight size={13} className="breadcrumb-section-separator" aria-hidden />
                <span className="breadcrumb-agent"><AgentCreature agent={VIDEO_AGENT} isDefault={false} size={19} /><span>Video Agent</span></span>
                <ChevronRight size={13} className="breadcrumb-thread-separator" aria-hidden />
                <strong>Daily launch video</strong>
              </nav>
            </div>
            <div className="conversation-header-actions">
              {(isNarrow || !desktopPanelOpen) && <Button variant="outline" size="sm" className="open-library-button" onClick={openLibrary}><FolderOpen size={14} aria-hidden />Library</Button>}
              <Button variant="ghost" size="icon-sm" aria-label="Conversation options" onClick={() => toast('Conversation actions are unchanged in this design preview.')}><MoreHorizontal size={16} aria-hidden /></Button>
            </div>
          </header>
          <div className="conversation-scroll" ref={conversationScrollRef}>
            <div className="conversation-content">
              <div className="thread-overline"><span>Today</span><span className="overline-dot" /><span>10:42 AM</span></div>
              <div className="user-message"><p>Create two launch cuts and an end card from the footage. Keep the pacing quiet and the closing frame warm.</p></div>
              <ActivityGroup scenario={scenario} />
              <section className="assistant-message" aria-label="Video Agent response">
                <div className="assistant-label"><AgentCreature agent={VIDEO_AGENT} isDefault={false} size={24} /><strong>Video Agent</strong><span>10:44 AM</span></div>
                <p>I made two short launch versions from the same source, then added a quiet closing card. Open any file to review it here without leaving the conversation.</p>
                <div className="asset-section-label"><span>Created files</span><span>{newFileAdded ? 5 : 4}</span></div>
                <div className="video-grid">
                  <VideoCard file={FILES[0]} onOpen={openPreview} />
                  <VideoCard file={FILES[1]} onOpen={openPreview} />
                </div>
                <div className="supporting-files">
                  <ImageCard file={FILES[2]} onOpen={openPreview} />
                  <NoteRow file={FILES[3]} onOpen={openPreview} />
                  {newFileAdded && <NoteRow file={NEW_FILE} onOpen={openPreview} fresh />}
                </div>
                <p className="assistant-footnote">The checklist PDF is in Library. Files shown here are local design fixtures.</p>
              </section>
              {localMessages.map((message, index) => <div className="user-message local-user-message" key={`${index}-${message}`}>{message}</div>)}
            </div>
          </div>
          <form className="composer" data-slot="prompt-input" aria-label="Message Video Agent" onSubmit={sendLocalMessage}>
            <Textarea
              aria-label="Message Video Agent"
              value={draft}
              onChange={event => {
                if (!event.target.value) event.target.style.removeProperty('height')
                setDraft(event.target.value)
              }}
              onInput={event => {
                event.currentTarget.style.height = 'auto'
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Message Video Agent…"
              rows={1}
            />
            <div className="composer-footer">
              <div className="composer-controls">
                <Button variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={() => toast('Attachments are unchanged in this design preview.')}><Plus size={16} aria-hidden /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Mention" onClick={() => toast('Mentions are unchanged in this design preview.')}><AtSign size={15} aria-hidden /></Button>
                <Button variant="ghost" size="sm" className="composer-model-button" onClick={() => toast('Model selection is unchanged in this design preview.')}>Auto<ChevronDown size={12} aria-hidden /></Button>
              </div>
              <span className="composer-local-note">Preview only · no live agent</span>
              <Button type="submit" size="icon-sm" className="composer-send" aria-label="Add message to preview" disabled={!draft.trim()}><ArrowUp size={16} aria-hidden /></Button>
            </div>
          </form>
        </main>
        {!isNarrow && desktopPanelOpen && <RightDock
          files={files} scenario={scenario} setScenario={setScenario} view={panelView} selectedFileId={selectedFileId}
          activeTab={activeTab} setActiveTab={value => setActiveTab(value)} onOpenFile={openPreview} onBack={backToLibrary} onClose={closeDock}
        />}
      </div>
    </div>
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent side="left" className="mobile-sidebar-sheet" showCloseButton>
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <SheetDescription className="sr-only">Choose an area, agent, or thread.</SheetDescription>
        <div className="mobile-sidebar-wrap">{sidebar(true)}</div>
      </SheetContent>
    </Sheet>
    <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
      <SheetContent side="right" className="mobile-file-sheet" showCloseButton={false}>
        <SheetTitle className="sr-only">Conversation Library and file preview</SheetTitle>
        <SheetDescription className="sr-only">Browse conversation files or preview a selected file.</SheetDescription>
        <RightDock
          files={files} scenario={scenario} setScenario={setScenario} view={panelView} selectedFileId={selectedFileId}
          activeTab={activeTab} setActiveTab={value => setActiveTab(value)} onOpenFile={openPreview} onBack={backToLibrary} onClose={closeDock} className="right-dock-in-sheet"
        />
      </SheetContent>
    </Sheet>
    <Toaster theme={dark ? 'dark' : 'light'} visibleToasts={2} />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
