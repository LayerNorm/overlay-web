import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { AtSign, ArrowUp, Bot, ChevronDown, ChevronRight, CircleHelp, Folder, Hash, Mail, ListChecks, MessageSquare, PanelLeft, Plus, RotateCcw, Settings, Sun, Workflow, X, Info } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockFooter, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '../../../packages/overlay-ui/src/components/ui/code-block'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'

/* ---------- Diagram drawing (stands in for mermaid.render with Overlay theme variables) ---------- */

type Box = { x: number; y: number; w: number; h: number; eyebrow?: string; title: string; detail?: string; kind?: 'box' | 'decision' | 'end' }

function Node({ b }: { b: Box }) {
  const cx = b.x + b.w / 2
  if (b.kind === 'decision') {
    const cy = b.y + b.h / 2
    return <g className="d-node">
      <path d={`M${cx} ${b.y} L${b.x + b.w} ${cy} L${cx} ${b.y + b.h} L${b.x} ${cy} Z`} strokeLinejoin="round" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="d-title">{b.title}</text>
    </g>
  }
  const lines = [b.eyebrow, b.title, b.detail].filter(Boolean) as string[]
  const top = b.y + b.h / 2 - (lines.length - 1) * 9
  return <g className={'d-node' + (b.kind === 'end' ? ' d-end' : '')}>
    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.kind === 'end' ? b.h / 2 : 8} />
    {lines.map((line, i) => <text key={i} x={cx} y={top + i * 18 + 4} textAnchor="middle" className={line === b.eyebrow ? 'd-eyebrow' : line === b.title ? 'd-title' : 'd-detail'}>{line}</text>)}
  </g>
}

function Edge({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return <g className="d-edge">
    <path d={d} markerEnd="url(#arrow)" />
    {label ? <g className="d-label"><rect x={(lx ?? 0) - 16} y={(ly ?? 0) - 10} width={32} height={20} rx={6} /><text x={lx} y={(ly ?? 0) + 4} textAnchor="middle">{label}</text></g> : null}
  </g>
}

function Defs() {
  return <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
}

function RoadmapDiagram() {
  const A: Box = { x: 150, y: 16, w: 260, h: 74, eyebrow: 'Stage 1 · Months 0–4', title: 'Validate the target', detail: 'Knock out PAX3::FOXO1 in RH4 / RH30' }
  const G1: Box = { x: 190, y: 124, w: 180, h: 76, title: 'Cancer cells die?', kind: 'decision' }
  const X1: Box = { x: 450, y: 130, w: 170, h: 64, title: 'Stop or switch target', detail: 'e.g. FGFR4' }
  const B: Box = { x: 150, y: 236, w: 260, h: 74, eyebrow: 'Stage 2 · Months 2–8', title: 'Design the molecule', detail: 'AI structure + generative chemistry' }
  const C: Box = { x: 150, y: 346, w: 260, h: 74, eyebrow: 'Stage 3 · Months 6–12', title: 'Test in cells', detail: 'Kills ARMS, spares normal cells?' }
  const G2: Box = { x: 190, y: 454, w: 180, h: 76, title: 'Potent & selective?', kind: 'decision' }
  const D: Box = { x: 150, y: 566, w: 260, h: 74, eyebrow: 'Stage 4 · Months 12–24', title: 'Test in animals', detail: 'Mouse xenografts, dosing, safety' }
  const E: Box = { x: 190, y: 676, w: 180, h: 44, title: 'IND-ready candidate', kind: 'end' }
  return <svg viewBox="90 0 540 736" className="diagram-svg" style={{ maxWidth: 540, minWidth: 405 }} role="img" aria-label="Preclinical roadmap flowchart">
    <Defs />
    <Edge d="M280 90 V122" />
    <Edge d="M370 162 H448" label="No" lx={409} ly={162} />
    <Edge d="M280 200 V234" label="Yes" lx={280} ly={217} />
    <Edge d="M280 310 V344" />
    <Edge d="M280 420 V452" />
    <Edge d="M190 492 H112 Q100 492 100 480 V285 Q100 273 112 273 H148" label="No" lx={100} ly={390} />
    <Edge d="M280 530 V564" label="Yes" lx={280} ly={547} />
    <Edge d="M280 640 V674" />
    {[A, G1, X1, B, C, G2, D, E].map((b, i) => <Node key={i} b={b} />)}
  </svg>
}

function MechanismDiagram() {
  const boxes: Box[] = [
    { x: 8, y: 22, w: 150, h: 64, title: 'Degrader', detail: 'binds PAX3::FOXO1' },
    { x: 196, y: 22, w: 150, h: 64, title: 'Recruits E3 ligase', detail: 'cereblon / VHL' },
    { x: 384, y: 22, w: 150, h: 64, title: 'Tagged + destroyed', detail: 'by the proteasome' },
    { x: 572, y: 22, w: 150, h: 64, title: 'Cancer program', detail: 'switches off', kind: 'box' },
  ]
  return <svg viewBox="0 0 730 108" className="diagram-svg" style={{ maxWidth: 730, minWidth: 548 }} role="img" aria-label="How the degrader works">
    <Defs />
    <Edge d="M158 54 H194" /><Edge d="M346 54 H382" /><Edge d="M534 54 H570" />
    {boxes.map((b, i) => <Node key={i} b={b} />)}
  </svg>
}

/* ---------- Message content ---------- */

const ROADMAP = `flowchart TD
    A["Stage 1 · Months 0–4<br/>Validate the target<br/>Knock out PAX3::FOXO1 in RH4 / RH30"] --> G1{"Cancer cells die?"}
    G1 -- No --> X1["Stop or switch target<br/>e.g. FGFR4"]
    G1 -- Yes --> B["Stage 2 · Months 2–8<br/>Design the molecule<br/>AI structure + generative chemistry"]
    B --> C["Stage 3 · Months 6–12<br/>Test in cells<br/>Kills ARMS, spares normal cells?"]
    C --> G2{"Potent & selective?"}
    G2 -- No --> B
    G2 -- Yes --> D["Stage 4 · Months 12–24<br/>Test in animals<br/>Mouse xenografts, dosing, safety"]
    D --> E(["IND-ready candidate"])`

const MECHANISM = `flowchart LR
    A["Degrader<br/>binds PAX3::FOXO1"] --> B["Recruits E3 ligase<br/>cereblon / VHL"]
    B --> C["Tagged + destroyed<br/>by the proteasome"]
    C --> D["Cancer program<br/>switches off"]`

const OPERATING = `flowchart LR
    subgraph Team
      PI["Principal investigator"] --> CRO["Contract lab (CRO)"]
    PI --> AI["AI design partner"]
    AI --> CRO
    CRO -- weekly data --> PI
    PI --> Board[("Advisory board")]`

type BlockState = 'diagram' | 'code'

function MermaidBlock({ source, children, broken }: { source: string; children?: React.ReactNode; broken?: boolean }) {
  const [view, setView] = React.useState<BlockState>(broken ? 'code' : 'diagram')
  const lines = source.split('\n')
  return <CodeBlock className="my-3">
    <CodeBlockHeader>
      <CodeBlockTitle className="font-mono font-normal text-(--muted)">mermaid</CodeBlockTitle>
      <CodeBlockActions>
        {broken ? null : <div className="view-toggle" role="group" aria-label="Block view">
          <Button variant="ghost" size="xs" data-active={view === 'diagram' || undefined} aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>Diagram</Button>
          <Button variant="ghost" size="xs" data-active={view === 'code' || undefined} aria-pressed={view === 'code'} onClick={() => setView('code')}>Code</Button>
        </div>}
        <CodeBlockCopyButton value={source} />
      </CodeBlockActions>
    </CodeBlockHeader>
    {view === 'diagram' && !broken
      ? <div className="diagram-frame" tabIndex={0} aria-label="Diagram">{children}</div>
      : <CodeBlockContent>{lines.map((line, i) => <CodeBlockLine key={i}>{line}</CodeBlockLine>)}</CodeBlockContent>}
    {broken ? <CodeBlockFooter className="render-note"><Info size={13} aria-hidden /><span className="render-note-text">Couldn’t draw this diagram, so the code is shown instead.</span><span className="render-note-detail">Line 2: subgraph is never closed</span></CodeBlockFooter> : null}
  </CodeBlock>
}

/* ---------- Shell ---------- */

const CHATS = ['ARMS degrader preclinical plan', 'Seed round investor list', 'Weekly metrics summary', 'Rewrite onboarding emails']

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [key, setKey] = React.useState(0)
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const unchanged = (what: string) => toast(`${what} is unchanged in this proposal`)

  function renderSection(id: string) {
    if (id !== 'personal') return null
    return <SidebarMenuSub className="ml-0 border-l-0 pl-0">{CHATS.map((title, i) => <SidebarMenuSubItem key={title}>
      <SidebarMenuSubButton isActive={i === 0} onClick={() => i === 0 ? setSidebarOpen(false) : unchanged('Other chats')} className="h-8 text-sm"><span className="flex-1 truncate">{title}</span></SidebarMenuSubButton>
    </SidebarMenuSubItem>)}</SidebarMenuSub>
  }

  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Mermaid diagrams in chat code blocks</span></span><div>
      <Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={() => { setKey(k => k + 1); setCollapsed(false); setDraft('') }}><RotateCcw size={14} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button>
    </div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <div className="workspace-navigation" data-sidebar-drawer>
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Chats"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="chat"
          scope="personal"
          panelNav={{
            activeId: 'personal', activeChildId: 'personal:personal',
            onSelect: () => unchanged('Chat navigation'),
            items: ['personal', 'workspace'].map(s => ({ id: s, label: s === 'personal' ? 'Personal' : 'Workspace', children: [
              { id: `${s}:personal`, label: 'Personal', icon: MessageSquare },
              { id: `${s}:dms`, label: 'Direct Messages', icon: Mail },
              { id: `${s}:channels`, label: 'Channels', icon: Hash },
            ] })),
          }}
          renderSection={renderSection}
          onToggleActivity={() => unchanged('Activity')}
          onSearch={() => unchanged('Search')}
          panelAction={{ label: 'New chat', onClick: () => unchanged('New chat') }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => unchanged('Work') },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => unchanged('Agents') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, active: true, onSelect: () => setSidebarOpen(false) },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => unchanged('Files') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => unchanged('Automations') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Interactive design preview', { description: 'Switch each block between Diagram and Code. The third block shows the render-error fallback.' }) },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => unchanged('Settings') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => unchanged('Account')}>DL</Button>}
        />
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="app-main">
        <div data-slot="app-screen-main" className="screen-main">
          <header data-slot="app-screen-header" className="main-header">
            <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button>
            <span className="crumb">Personal</span><ChevronRight size={13} className="crumb-sep" /><span className="crumb">Chats</span><ChevronRight size={13} className="crumb-sep" /><span className="crumb-current">{CHATS[0]}</span>
          </header>
          <div className="conversation">
            <div className="messages" key={key}>
              <div className="user-message">Can you make a visual diagram to help me understand this?</div>
              <div className="assistant-label"><span className="assistant-avatar"><OverlayMark size={16} /></span><strong>Overlay</strong><span className="message-time">11:38 AM</span></div>
              <div className="prose">
                <p>Here are three simple diagrams: the roadmap, how the drug would work, and how you’d run the operation.</p>
                <h3>1. The preclinical roadmap</h3>
                <MermaidBlock source={ROADMAP}><RoadmapDiagram /></MermaidBlock>
                <h3>2. How the drug would work</h3>
                <MermaidBlock source={MECHANISM}><MechanismDiagram /></MermaidBlock>
                <h3>3. How you’d run the operation</h3>
                <MermaidBlock source={OPERATING} broken />
                <p>The decision points are where most of the risk sits: if knocking out the fusion protein doesn’t kill the cells, the program should switch targets before spending on chemistry.</p>
              </div>
            </div>
          </div>
          <div className="composer-wrap">
            <div className="composer" data-slot="prompt-input">
              <Textarea rows={1} aria-label="Message Overlay" placeholder="Ask anything" value={draft} onChange={e => setDraft(e.target.value)} />
              <div className="composer-footer">
                <Button variant="ghost" size="icon" className="composer-icon" aria-label="Add attachment" onClick={() => unchanged('Attachments')}><Plus size={16} /></Button>
                <Button variant="ghost" size="icon" className="composer-icon" aria-label="Mention" onClick={() => unchanged('Mentions')}><AtSign size={16} /></Button>
                <Button variant="ghost" size="sm" className="chip" onClick={() => unchanged('Model selection')}>Auto<ChevronDown size={12} /></Button>
                <span className="flex-1" />
                <Button variant="primary" size="icon" className="send" aria-label="Send" disabled={!draft.trim()} onClick={() => setDraft('')}><ArrowUp size={17} strokeWidth={2} /></Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
    <Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)

