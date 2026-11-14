import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Bot, ChevronLeft, ChevronRight, CircleHelp, FileText, Folder, ListChecks, MessageSquare, MoreHorizontal, Package, PanelLeft, PenLine, Plug, Plus, Presentation, RotateCcw, Search, SearchX, Server, Settings, Sheet, Sparkles, Sun, Workflow, X, Mail, ChartLine, Languages, ChevronDown, Unplug, Pencil, Trash2, Globe, Terminal, Upload, type LucideIcon } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../packages/overlay-ui/src/components/ui/dropdown-menu'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import gmail from '../../../public/assets/svg/landing/gmail.svg'
import gcal from '../../../public/assets/svg/landing/google-calendar.svg'
import github from '../../../public/assets/svg/landing/github.svg'
import githubDark from '../../../public/assets/svg/landing/github_dark.svg'
import slack from '../../../public/assets/svg/landing/slack.svg'
import notion from '../../../public/assets/svg/landing/notion.svg'
import linear from '../../../public/assets/svg/landing/linear.svg'
import sentry from '../../../public/assets/svg/landing/sentry.svg'
import mcp from '../../../public/assets/svg/landing/mcp.svg'
import mcpDark from '../../../public/assets/svg/landing/mcp_dark.svg'
import playwright from '../../../public/assets/svg/landing/playwright.svg'

type Kind = 'connectors' | 'skills' | 'mcps' | 'apps'
/** Logo: a catalog image (light/dark), a brand-colored initial (production falls back to an initial), or a Lucide glyph for skills. */
type Logo = { src: string; dark?: string; invertDark?: boolean } | { letter: string; bg: string; fg?: string } | { icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }
type Item = { id: string; name: string; desc: string; logo: Logo }
type Section = { id: string; title: string; items: Item[] }

const L = (letter: string, bg: string, fg?: string): Logo => ({ letter, bg, fg })
const I = (id: string, name: string, desc: string, logo: Logo): Item => ({ id, name, desc, logo })

const CATALOG: Record<Exclude<Kind, 'apps'>, { browse: Section[]; created: Item[] }> = {
  connectors: {
    browse: [
      { id: 'popular', title: 'Popular', items: [
        I('gmail', 'Gmail', 'Read, search and draft email', { src: gmail }),
        I('gcal', 'Google Calendar', 'See and schedule events', { src: gcal }),
        I('github', 'GitHub', 'Issues, pull requests and code', { src: github, dark: githubDark }),
        I('slack', 'Slack', 'Read and send messages', { src: slack }),
        I('notion', 'Notion', 'Search and edit pages', { src: notion }),
        I('linear', 'Linear', 'Track and update issues', { src: linear }),
        I('gdrive', 'Google Drive', 'Docs, Sheets and Slides', L('D', '#1FA463')),
        I('outlook', 'Outlook', 'Mail and calendar', L('O', '#0F6CBD')),
      ] },
      { id: 'new', title: 'New & Noteworthy', items: [
        I('granola', 'Granola', 'Meeting notes and transcripts', L('G', '#3F6A3B')),
        I('attio', 'Attio', 'Records, lists and notes', L('A', '#1F2937')),
        I('sentry', 'Sentry', 'Errors and performance issues', { src: sentry, invertDark: true }),
        I('figma', 'Figma', 'Read designs and comments', L('F', '#A259FF')),
        I('calendly', 'Calendly', 'Share links and see bookings', L('C', '#006BFF')),
        I('zoom', 'Zoom', 'Meetings and recordings', L('Z', '#0B5CFF')),
      ] },
      { id: 'sales', title: 'Sales & CRM', items: [
        I('hubspot', 'HubSpot', 'Contacts, deals and pipelines', L('H', '#FF5C35')),
        I('salesforce', 'Salesforce', 'Accounts, leads and opportunities', L('S', '#0D9DDA')),
        I('affinity', 'Affinity', 'Relationship intelligence for deals', L('A', '#2B59FF')),
        I('apollo', 'Apollo', 'Find and enrich prospects', L('A', '#F6D44B', '#1A1A1A')),
        I('pipedrive', 'Pipedrive', 'Deals and activities', L('P', '#1A1A1A')),
        I('close', 'Close', 'Calls, email and leads', L('C', '#4352F5')),
        I('acculynx', 'AccuLynx', 'Roofing jobs and estimates', L('A', '#E0402F')),
        I('agencyzoom', 'AgencyZoom', 'Insurance pipeline and renewals', L('A', '#E8364F')),
      ] },
      { id: 'business', title: 'Small Business', items: [
        I('stripe', 'Stripe', 'Payments, customers and invoices', L('S', '#635BFF')),
        I('quickbooks', 'QuickBooks', 'Accounting and payroll', L('Q', '#2CA01C')),
        I('shopify', 'Shopify', 'Orders, products and customers', L('S', '#5E8E3E')),
        I('dropbox', 'Dropbox', 'Find and share files', L('D', '#0061FF')),
        I('xero', 'Xero', 'Invoices and bank reconciliation', L('X', '#13B5EA')),
        I('square', 'Square', 'Sales and inventory', L('S', '#1A1A1A')),
      ] },
      { id: 'projects', title: 'Project Management', items: [
        I('asana', 'Asana', 'Tasks, projects and goals', L('A', '#F06A6A')),
        I('jira', 'Jira', 'Issues and sprints', L('J', '#0C66E4')),
        I('airtable', 'Airtable', 'Bases, tables and records', L('A', '#FCB400', '#1A1A1A')),
        I('clickup', 'ClickUp', 'Tasks, docs and goals', L('C', '#7B68EE')),
        I('monday', 'monday.com', 'Boards and automations', L('M', '#FF3D57')),
        I('trello', 'Trello', 'Boards, lists and cards', L('T', '#0C66E4')),
      ] },
    ],
    created: [],
  },
  mcps: {
    browse: [
      { id: 'popular', title: 'Popular', items: [
        I('github-mcp', 'GitHub MCP', 'Repositories, issues and actions', { src: github, dark: githubDark }),
        I('linear-mcp', 'Linear MCP', 'Issues, projects and cycles', { src: linear }),
        I('sentry-mcp', 'Sentry MCP', 'Debug production errors', { src: sentry, invertDark: true }),
        I('notion-mcp', 'Notion MCP', 'Workspace search and edits', { src: notion }),
        I('playwright', 'Playwright', 'Drive a browser for testing', { src: playwright }),
        I('perplexity', 'Perplexity', 'Web search with citations', L('P', '#20808D')),
      ] },
      { id: 'dev', title: 'Developer Tools', items: [
        I('context7', 'Context7', 'Up-to-date library docs', L('C', '#0E9F6E')),
        I('vercel', 'Vercel', 'Deployments, logs and domains', L('V', '#1A1A1A')),
        I('supabase', 'Supabase', 'Databases and edge functions', L('S', '#3ECF8E', '#1A1A1A')),
        I('cloudflare', 'Cloudflare', 'Workers, DNS and storage', L('C', '#F38020')),
      ] },
    ],
    created: [
      I('deepwiki', 'DeepWiki MCP', 'Search any codebase', { src: mcp, dark: mcpDark }),
      I('supermemory', 'Supermemory MCP', 'Memory and context for my agents', { src: mcp, dark: mcpDark }),
    ],
  },
  skills: {
    browse: [
      { id: 'popular', title: 'Popular', items: [
        I('docs', 'Documents', 'Write and edit Word documents', { icon: FileText }),
        I('sheets', 'Spreadsheets', 'Build sheets with formulas and charts', { icon: Sheet }),
        I('slides', 'Slides', 'Make presentation decks', { icon: Presentation }),
        I('pdf', 'PDF', 'Read, fill and merge PDFs', { icon: FileText }),
      ] },
      { id: 'writing', title: 'Writing', items: [
        I('brand-voice', 'Brand voice', 'Keep copy in your house style', { icon: PenLine }),
        I('email-drafts', 'Email drafts', 'Concise replies that match your tone', { icon: Mail }),
        I('translate', 'Translation', 'Translate and localize text', { icon: Languages }),
        I('metrics', 'Metrics review', 'Summarize dashboards each week', { icon: ChartLine }),
      ] },
    ],
    created: [
      I('investor-update', 'Investor update', 'Monthly update in our format', { icon: PenLine }),
    ],
  },
}

const KIND: Record<Kind, { label: string; noun: string; subtitle: string; icon: LucideIcon }> = {
  connectors: { label: 'Connectors', noun: 'connectors', subtitle: 'Let Overlay and your agents work across the apps you use.', icon: Plug },
  skills: { label: 'Skills', noun: 'skills', subtitle: 'Teach Overlay how you like things done.', icon: Sparkles },
  mcps: { label: 'MCPs', noun: 'MCP servers', subtitle: 'Connect any MCP server to give agents new tools.', icon: Server },
  apps: { label: 'Apps', noun: 'apps', subtitle: 'Small apps that run inside your workspace.', icon: Package },
}
const ADD_OPTIONS: Record<Kind, Array<{ label: string; icon: React.ComponentType<{ size?: number }> }>> = {
  connectors: [{ label: 'Custom connector', icon: Plug }],
  mcps: [{ label: 'Remote server (URL)', icon: Globe }, { label: 'Local command', icon: Terminal }],
  skills: [{ label: 'Write a skill', icon: PenLine }, { label: 'Upload SKILL.md', icon: Upload }],
  apps: [{ label: 'Request an app', icon: Package }],
}

function LogoTile({ logo, dark }: { logo: Logo; dark: boolean }) {
  if ('src' in logo) return <span className="logo-tile"><img src={dark && logo.dark ? logo.dark : logo.src} alt="" className={dark && logo.invertDark ? 'invert-dark' : undefined} /></span>
  if ('letter' in logo) return <span className="logo-tile logo-letter" style={{ background: logo.bg, color: logo.fg ?? '#fff' }}>{logo.letter}</span>
  const Icon = logo.icon
  return <span className="logo-tile logo-glyph"><Icon size={18} strokeWidth={1.6} /></span>
}

function Row({ item, dark, added, created, onAdd, onRemove }: { item: Item; dark: boolean; added: boolean; created?: boolean; onAdd: () => void; onRemove: () => void }) {
  return <div className="ext-row">
    <Button variant="ghost" className="ext-row-main" onClick={() => toast(item.name, { description: 'Opens the existing details dialog: what it can access, permissions, and settings.' })}>
      <LogoTile logo={item.logo} dark={dark} />
      <span className="ext-text"><span className="ext-name">{item.name}</span><span className="ext-desc">{item.desc}</span></span>
    </Button>
    {added || created ? <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="ext-action" aria-label={`${item.name} options`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => toast(`${item.name} settings`, { description: 'Opens the existing settings dialog.' })}>{created ? <Pencil size={14} /> : <Settings size={14} />}{created ? 'Edit' : 'Settings'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove}>{created ? <Trash2 size={14} /> : <Unplug size={14} />}{created ? 'Delete' : 'Disconnect'}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <Button variant="ghost" size="icon-sm" className="ext-action" aria-label={`Add ${item.name}`} onClick={onAdd}><Plus size={17} /></Button>}
  </div>
}

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('personal')
  const [kind, setKind] = React.useState<Kind>('connectors')
  const [tab, setTab] = React.useState<'browse' | 'yours'>('browse')
  const [category, setCategory] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [added, setAdded] = React.useState<Set<string>>(() => new Set(['gmail', 'gcal', 'github', 'linear-mcp', 'docs', 'pdf']))
  const [deleted, setDeleted] = React.useState<Set<string>>(() => new Set())
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const unchanged = (what: string) => toast(`${what} is unchanged in this proposal`)
  const meta = KIND[kind]
  const data = kind === 'apps' ? { browse: [] as Section[], created: [] as Item[] } : CATALOG[kind]
  const all = [...data.browse.flatMap(s => s.items), ...data.created].filter((item, i, list) => list.findIndex(x => x.id === item.id) === i)
  const created = data.created.filter(i => !deleted.has(i.id))
  const connected = all.filter(i => added.has(i.id) && !data.created.includes(i))

  function go(next: Kind) { setKind(next); setTab('browse'); setCategory(null); setQuery(''); setSidebarOpen(false) }
  function add(item: Item) {
    const id = toast.loading(`Connecting ${item.name}…`)
    setTimeout(() => { setAdded(prev => new Set(prev).add(item.id)); toast.success(kind === 'skills' ? `${item.name} added` : `${item.name} connected`, { id, description: 'Agents can use it in new chats.' }) }, 700)
  }
  function remove(item: Item) {
    if (data.created.includes(item)) { setDeleted(prev => new Set(prev).add(item.id)); toast(`${item.name} deleted`); return }
    setAdded(prev => { const next = new Set(prev); next.delete(item.id); return next }); toast(`${item.name} disconnected`)
  }
  const row = (item: Item, isCreated = false) => <Row key={item.id} item={item} dark={dark} added={added.has(item.id)} created={isCreated} onAdd={() => add(item)} onRemove={() => remove(item)} />
  const grid = (items: Item[], isCreated = false) => <div className="ext-grid">{items.map(i => row(i, isCreated))}</div>

  const q = query.trim().toLowerCase()
  const results = q ? all.filter(i => !deleted.has(i.id) && (i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q))) : []
  const openSection = category ? data.browse.find(s => s.id === category) : undefined

  function empty(icon: React.ReactNode, title: string, body: string, action?: React.ReactNode) {
    return <div className="ext-empty"><span className="ext-empty-icon">{icon}</span><h3>{title}</h3><p>{body}</p>{action}</div>
  }
  const addMenu = (compact?: boolean) => <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="secondary" size="md" className={'add-button' + (compact ? ' add-compact' : '')} aria-label={`Add ${meta.noun}`}><Plus size={15} /><span className="add-label">Add</span><ChevronDown size={13} className="add-chevron" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-48">
      {ADD_OPTIONS[kind].map(o => <DropdownMenuItem key={o.label} onSelect={() => toast(o.label, { description: 'Opens the existing add flow for this type.' })}><o.icon size={14} />{o.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>

  let body: React.ReactNode
  if (q) {
    body = results.length
      ? <section className="ext-section"><div className="ext-section-head static"><h2>Results</h2><span className="ext-count">{results.length}</span></div>{grid(results)}</section>
      : empty(<SearchX size={20} />, `No ${meta.noun} match “${query.trim()}”`, kind === 'mcps' ? 'Check the spelling, or add any server by its URL.' : 'Check the spelling, or connect any tool through an MCP server.',
        <Button variant="secondary" size="sm" onClick={() => kind === 'mcps' ? toast('Remote server (URL)', { description: 'Opens the existing add flow.' }) : go('mcps')}>{kind === 'mcps' ? 'Add a server' : 'Browse MCPs'}</Button>)
  } else if (kind === 'apps') {
    body = empty(<Package size={20} />, tab === 'browse' ? 'Apps are on the way' : 'No apps yet', tab === 'browse' ? 'Apps will appear here in the same list as connectors, skills and MCPs.' : 'Apps you add or build will appear here.')
  } else if (tab === 'browse' && openSection) {
    body = <section className="ext-section">{grid(openSection.items)}</section>
  } else if (tab === 'browse') {
    body = data.browse.map(s => <section key={s.id} className="ext-section">
      <Button variant="ghost" className="ext-section-head" onClick={() => setCategory(s.id)}><h2>{s.title}</h2><ChevronRight size={16} /></Button>
      {grid(s.items.slice(0, 6))}
    </section>)
  } else {
    const sharedTitle = scope === 'workspace' ? 'Shared in LayerNorm' : 'Created by you'
    body = connected.length || created.length ? <>
      {connected.length ? <section className="ext-section"><div className="ext-section-head static"><h2>{kind === 'skills' ? 'Added' : 'Connected'}</h2></div>{grid(connected)}</section> : null}
      {created.length ? <section className="ext-section"><div className="ext-section-head static"><h2>{sharedTitle}</h2></div>{grid(created, true)}</section> : null}
    </> : empty(<meta.icon size={20} />, `No ${meta.noun} yet`, `${kind === 'skills' ? 'Added' : 'Connected'} and custom ${meta.noun} will appear here.`, <Button variant="secondary" size="sm" onClick={() => setTab('browse')}>Browse {meta.noun}</Button>)
  }

  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Extensions catalog</span></span><div>
      <Button variant="ghost" size="sm" onClick={() => { setCategory(null); setQuery('zapier') }}>No results</Button>
      <Button variant="ghost" size="sm" onClick={() => go('apps')}>Empty</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={() => { go('connectors'); setScope('personal'); setCollapsed(false); setAdded(new Set(['gmail', 'gcal', 'github', 'linear-mcp', 'docs', 'pdf'])); setDeleted(new Set()); toast.dismiss() }}><RotateCcw size={14} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button>
    </div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <div className="workspace-navigation" data-sidebar-drawer>
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Extensions"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="extensions"
          scope={scope}
          panelNav={{
            activeId: scope, activeChildId: `${scope}:${kind}`,
            onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id); else go(id.split(':')[1] as Kind) },
            items: (['personal', 'workspace'] as const).map(s => ({ id: s, label: s === 'personal' ? 'Personal' : 'Workspace', children: (['connectors', 'skills', 'mcps', 'apps'] as const).map(k => ({ id: `${s}:${k}`, label: KIND[k].label, icon: KIND[k].icon })) })),
          }}
          onSearch={() => (document.querySelector('.ext-search input') as HTMLInputElement | null)?.focus()}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => unchanged('Work') },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => unchanged('Agents') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => unchanged('Chats') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => unchanged('Files') },
            { id: 'extensions', label: 'Extensions', icon: Plug, active: true, onSelect: () => setSidebarOpen(false) },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => unchanged('Automations') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Interactive design preview', { description: 'Switch Connectors, Skills, MCPs and Apps; open a section; search; add or disconnect.' }) },
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
            <span className="crumb">{scope === 'personal' ? 'Personal' : 'Workspace'}</span><ChevronRight size={13} className="crumb-sep" /><span className="crumb">Extensions</span><ChevronRight size={13} className="crumb-sep" />
            {openSection && !q ? <><Button variant="ghost" size="xs" className="crumb-link" onClick={() => setCategory(null)}>{meta.label}</Button><ChevronRight size={13} className="crumb-sep" /><span className="crumb-current">{openSection.title}</span></> : <span className="crumb-current">{meta.label}</span>}
          </header>
          <div className="ext-scroll">
            <div className="ext-page">
              <div className="ext-head">
                <div className="ext-title">
                  {openSection && !q ? <Button variant="ghost" size="icon-sm" className="back" aria-label={`Back to ${meta.label}`} onClick={() => setCategory(null)}><ChevronLeft size={18} /></Button> : null}
                  <div><h1>{openSection && !q ? openSection.title : meta.label}</h1><p>{openSection && !q ? `${openSection.items.length} ${meta.noun}` : meta.subtitle}</p></div>
                </div>
                <div className="ext-tools">
                  <label className="ext-search"><Search size={15} aria-hidden /><Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${meta.noun}`} aria-label={`Search ${meta.noun}`} />{query ? <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></Button> : null}</label>
                  {addMenu()}
                </div>
              </div>
              {!q && !openSection ? <div className="ext-tabs" role="tablist">
                {(['browse', 'yours'] as const).map(t => <Button key={t} role="tab" aria-selected={tab === t} variant="ghost" size="sm" data-active={tab === t || undefined} onClick={() => setTab(t)}>{t === 'browse' ? 'Browse' : scope === 'workspace' ? 'Workspace' : 'Yours'}</Button>)}
              </div> : null}
              {body}
            </div>
          </div>
        </div>
      </main>
    </div>
    <Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
