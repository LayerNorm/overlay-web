import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeftRight, Bot, Building2, Check, CircleHelp, Download, Folder, Hash, Link2, ListChecks, Lock, MessageSquare, MoreHorizontal, PanelLeft, Pause, Plus, RotateCcw, Settings, Shield, SlidersHorizontal, Sun, User, UserPlus, Users, WalletCards, Workflow, X, ChevronRight, Timer, Loader2 } from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Switch } from '../../../packages/overlay-ui/src/components/ui/switch'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'

type Provider = 'slack' | 'teams'
type Status = 'syncing' | 'history' | 'catching-up' | 'paused'
type ChannelLink = { id: string; name: string; detail: string; overlay: string; status: Status; progress?: number; note?: string; isPrivate?: boolean }
type Available = { id: string; name: string; detail: string; overlay: string; isPrivate?: boolean }

const PROVIDERS: Record<Provider, { name: string; monogram: string; accent: string; org: string; orgDetail: string; account: string; accountDone: string; autoLabel: string; autoHelp: string; limitNote: string }> = {
  slack: {
    name: 'Slack', monogram: 'S', accent: '#4A154B',
    org: 'LayerNorm Slack', orgDetail: 'Connected Nov 10 by Divyansh',
    account: 'Connect your Slack account to reply from Overlay in linked channels.',
    accountDone: 'Messages you send in linked channels post to Slack as you.',
    autoLabel: 'Auto-link new public channels',
    autoHelp: 'New public Slack channels sync to a new Overlay channel with the same name.',
    limitNote: 'Live updates: 1,204 events in the last hour. Slack allows 30,000 an hour for this workspace.',
  },
  teams: {
    name: 'Microsoft Teams', monogram: 'T', accent: '#4B53BC',
    org: 'LayerNorm (Microsoft 365)', orgDetail: 'Connected Nov 10 by Divyansh · App installed in 3 teams',
    account: 'Connect your Teams account to reply from Overlay in linked channels.',
    accountDone: 'Messages you send in linked channels post to Teams as you.',
    autoLabel: 'Auto-link new standard channels',
    autoHelp: 'New standard channels in teams with Overlay installed sync to a new private Overlay channel.',
    limitNote: 'Live updates: 312 events in the last hour. Subscriptions renew automatically.',
  },
}

const initialLinks: Record<Provider, ChannelLink[]> = {
  slack: [
    { id: 's-general', name: 'general', detail: 'Public', overlay: 'general', status: 'syncing' },
    { id: 's-eng', name: 'eng-platform', detail: 'Private', overlay: 'eng-platform', status: 'history', progress: 64, isPrivate: true },
    { id: 's-acme', name: 'customer-acme', detail: 'Slack Connect · Acme', overlay: 'customer-acme', status: 'syncing', isPrivate: true },
  ],
  teams: [
    { id: 't-product', name: 'General', detail: 'Product', overlay: 'product-general', status: 'syncing', isPrivate: true },
    { id: 't-contoso', name: 'Shared with Contoso', detail: 'Product · Shared', overlay: 'contoso-shared', status: 'paused', isPrivate: true, note: 'Add Overlay to this shared channel in Teams to resume.' },
  ],
}
const initialAvailable: Record<Provider, Available[]> = {
  slack: [
    { id: 's-design', name: 'design', detail: 'Public', overlay: 'design' },
    { id: 's-random', name: 'random', detail: 'Public', overlay: 'random' },
    { id: 's-sales', name: 'sales-pipeline', detail: 'Private', overlay: 'sales-pipeline', isPrivate: true },
  ],
  teams: [
    { id: 't-standups', name: 'Standups', detail: 'Engineering', overlay: 'engineering-standups' },
    { id: 't-planning', name: 'Planning', detail: 'Leadership · Private', overlay: 'leadership-planning', isPrivate: true },
  ],
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

const SETTINGS_ITEMS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, href: '#general' },
  { id: 'profile', label: 'Profile', icon: User, href: '#profile' },
  { id: 'workspace', label: 'Workspace', icon: Building2, href: '#workspace' },
  { id: 'connected-apps', label: 'Connected apps', icon: Link2, href: '#connected-apps' },
]
const TABS = [
  { id: 'people', label: 'People', icon: Users },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'guests', label: 'Guests', icon: UserPlus },
  { id: 'roles', label: 'Roles & permissions', icon: Shield },
  { id: 'sharing', label: 'Sharing & links', icon: Link2 },
  { id: 'billing', label: 'Billing', icon: WalletCards },
  { id: 'import', label: 'Import & sync', icon: ArrowLeftRight },
]

function Monogram({ provider, size = 32 }: { provider: Provider; size?: number }) {
  const p = PROVIDERS[provider]
  return <span className="monogram" style={{ background: p.accent, width: size, height: size }} aria-hidden="true">{p.monogram}</span>
}

function StatusCell({ link }: { link: ChannelLink }) {
  if (link.status === 'history') return <span className="sync-status"><Loader2 size={12} className="spin" /><span>Importing history<span className="status-sub">{link.progress}% of the last 180 days · new messages already sync</span><span className="progress" aria-hidden="true"><span style={{ width: (link.progress ?? 0) + '%' }} /></span></span></span>
  if (link.status === 'catching-up') return <span className="sync-status"><Timer size={12} /><span>Catching up<span className="status-sub">Slack’s hourly limit was reached. Resumes automatically in 2 min.</span></span></span>
  if (link.status === 'paused') return <span className="sync-status warning"><Pause size={12} /><span>Paused<span className="status-sub">{link.note}</span></span></span>
  return <span className="sync-status"><span className="dot" aria-hidden="true" />Syncing</span>
}

function App() {
  const [dark, setDark] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [provider, setProvider] = React.useState<Provider>('slack')
  const [links, setLinks] = React.useState(() => clone(initialLinks))
  const [available, setAvailable] = React.useState(() => clone(initialAvailable))
  const [accounts, setAccounts] = React.useState<Record<Provider, boolean>>({ slack: false, teams: false })
  const [dms, setDms] = React.useState<Record<Provider, boolean>>({ slack: false, teams: false })
  const [auto, setAuto] = React.useState<Record<Provider, boolean>>({ slack: false, teams: false })
  const [picking, setPicking] = React.useState(false)
  const p = PROVIDERS[provider]
  const rows = links[provider]
  const options = available[provider]
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])

  function switchProvider(next: Provider) { setProvider(next); setPicking(false) }
  function link(item: Available) {
    setAvailable(previous => ({ ...previous, [provider]: previous[provider].filter(a => a.id !== item.id) }))
    setLinks(previous => ({ ...previous, [provider]: [...previous[provider], { ...item, status: 'history', progress: 3 }] }))
    if (options.length === 1) setPicking(false)
    toast('Channel linked', { description: '#' + item.overlay + ' now receives new messages. History imports in the background.' })
  }
  function unlink(row: ChannelLink) {
    setLinks(previous => ({ ...previous, [provider]: previous[provider].filter(l => l.id !== row.id) }))
    setAvailable(previous => ({ ...previous, [provider]: [...previous[provider], { id: row.id, name: row.name, detail: row.detail, overlay: row.overlay, isPrivate: row.isPrivate }] }))
    toast('Sync stopped', { description: '#' + row.overlay + ' keeps its members and messages in Overlay.' })
  }
  function advance() {
    setLinks(previous => {
      const next = clone(previous)
      for (const key of ['slack', 'teams'] as Provider[]) for (const l of next[key]) if (l.status === 'history') { l.progress = Math.min(100, (l.progress ?? 0) + 18); if (l.progress >= 100) { l.status = 'syncing'; delete l.progress } }
      return next
    })
  }
  function limit() {
    setProvider('slack'); setPicking(false)
    setLinks(previous => ({ ...previous, slack: previous.slack.map(l => l.id === 's-acme' ? { ...l, status: l.status === 'catching-up' ? 'syncing' : 'catching-up' } : l) }))
  }
  function resume(row: ChannelLink) {
    setLinks(previous => ({ ...previous, [provider]: previous[provider].map(l => l.id === row.id ? { ...l, status: 'syncing', note: undefined } : l) }))
    toast('Sync resumed', { description: 'Overlay was found in ' + row.name + ' and picked up where it left off.' })
  }
  function reset() { setProvider('slack'); setLinks(clone(initialLinks)); setAvailable(clone(initialAvailable)); setAccounts({ slack: false, teams: false }); setDms({ slack: false, teams: false }); setAuto({ slack: false, teams: false }); setPicking(false); toast.dismiss() }

  return <>
    <div className="preview-bar"><span>Design preview <span className="preview-muted">/ Slack and Teams sync</span></span><div>
      <Button variant="ghost" size="sm" onClick={advance}>Advance history import</Button>
      <Button variant="ghost" size="sm" onClick={limit}>Simulate Slack limit</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Reset preview" onClick={reset}><RotateCcw size={14} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button>
    </div></div>
    <div data-app-shell className={'shell' + (sidebarOpen ? ' sidebar-open' : '')}>
      <div className="workspace-navigation">
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Settings"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="settings"
          scope="workspace"
          panelNav={{ activeId: 'workspace', items: SETTINGS_ITEMS, onSelect: id => { if (id !== 'workspace') toast('Other settings pages are unchanged in this proposal') ; setSidebarOpen(false) } }}
          items={[
            { id: 'settings-close', label: 'Back to app', icon: X, onSelect: () => toast('The rest of the app is unchanged in this proposal') },
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => toast('Work is unchanged in this proposal') },
            { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => toast('Agents are unchanged in this proposal') },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => toast('Linked channels appear under Chats with a small source label') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Files are unchanged in this proposal') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => toast('Automations are unchanged in this proposal') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Interactive design preview', { description: 'Switch between Slack and Teams, connect your account, link and unlink channels, and use the preview bar to advance an import or hit a rate limit.' }) },
            { id: 'settings', label: 'Settings', icon: Settings, active: true, onSelect: () => {} },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account" onClick={() => toast('LayerNorm', { description: 'Workspace and account settings are unchanged.' })}>DL</Button>}
        />
        <Button className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main settings-main">
        <header className="header" data-slot="app-screen-header"><Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (window.innerWidth < 768) { setCollapsed(false); setSidebarOpen(!sidebarOpen) } else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button><span className="crumb">Settings</span><ChevronRight size={13} /><span className="crumb">Workspace</span><ChevronRight size={13} /><span>Import &amp; sync</span></header>
        <div className="settings-scroll"><section className="workspace-card">
          <header className="workspace-head"><span className="workspace-icon">L</span><span className="workspace-name"><strong>LayerNorm</strong><small>Organization workspace</small></span><span className="role-chip">owner</span></header>
          <div className="tabs-row" role="tablist" aria-label="Workspace settings">{TABS.map(tab => { const Icon = tab.icon; const active = tab.id === 'import'; return <Button key={tab.id} variant="ghost" size="sm" role="tab" aria-selected={active} className={'tab' + (active ? ' active' : '')} onClick={() => active ? null : toast(tab.label + ' is unchanged in this proposal')}><Icon size={13} />{tab.label}</Button> })}</div>
          <div className="sync-body">
            <div className="provider-switch" role="tablist" aria-label="Service">{(['slack', 'teams'] as Provider[]).map(key => <Button key={key} role="tab" aria-selected={provider === key} variant={provider === key ? 'secondary' : 'ghost'} size="sm" onClick={() => switchProvider(key)}><Monogram provider={key} size={16} />{PROVIDERS[key].name}</Button>)}<span className="grow" /><Button variant="ghost" size="sm" onClick={() => toast('One-time import', { description: 'The existing history import, including Slack export uploads, stays available here.' })}><Download size={13} />One-time import</Button></div>
            <div className="intro"><h3>{p.name} sync</h3><p>Choose which {p.name} channels stay in sync with Overlay. Each channel links to one Overlay channel.</p></div>

            <div className="connection-grid">
              <div><p className="label">Your {provider === 'slack' ? 'Slack workspace' : 'Teams organization'}</p><div className="connection"><Monogram provider={provider} /><span className="connection-copy"><strong>{p.org}</strong><small><span className="dot" aria-hidden="true" />{p.orgDetail}</small></span><Button variant="ghost" size="icon-sm" aria-label="Connection options" onClick={() => toast(provider === 'slack' ? 'Refresh channels or disconnect Slack' : 'Download app package, refresh channels or disconnect Teams', { description: 'Disconnecting pauses every link. Synced messages stay in Overlay.' })}><MoreHorizontal size={16} /></Button></div></div>
              <div><p className="label">Your {p.name} account</p><div className="connection">
                <Monogram provider={provider} />
                {accounts[provider] ? <span className="connection-copy"><strong>Connected as Divyansh</strong><small>{p.accountDone}</small></span> : <span className="connection-copy"><span className="plain">{p.account}</span></span>}
                {accounts[provider] ? <Button variant="ghost" size="icon-sm" aria-label="Account options" onClick={() => toast('Disconnect your account', { description: 'Stops replies from Overlay. Messages you wrote stay yours.' })}><MoreHorizontal size={16} /></Button> : <Button variant="secondary" size="sm" onClick={() => { setAccounts(previous => ({ ...previous, [provider]: true })); toast('Account connected', { description: 'You can now reply from Overlay in linked ' + p.name + ' channels.' }) }}>Connect</Button>}
              </div>
              {accounts[provider] && <div className="dm-row"><span><strong>Sync my direct messages</strong><small>Only you see them. Off by default.</small></span><Switch aria-label="Sync my direct messages" checked={dms[provider]} onCheckedChange={value => setDms(previous => ({ ...previous, [provider]: value }))} /></div>}
              </div>
            </div>

            <div className="channels-head"><div><h3>Channels</h3></div><Button variant="secondary" size="sm" onClick={() => setPicking(!picking)} disabled={!options.length}><Plus size={13} />Link channel</Button></div>
            <div className="auto-row"><span><strong>{p.autoLabel}</strong><small>{p.autoHelp}</small></span><Switch aria-label={p.autoLabel} checked={auto[provider]} onCheckedChange={value => setAuto(previous => ({ ...previous, [provider]: value }))} /></div>

            {picking && options.length > 0 && <div className="picker"><div className="picker-head"><span>Available in {p.name}</span><Button variant="ghost" size="icon-xs" aria-label="Close channel list" onClick={() => setPicking(false)}><X size={14} /></Button></div>{options.map(item => <div className="picker-row" key={item.id}>{item.isPrivate ? <Lock size={13} /> : <Hash size={13} />}<span className="cell-copy"><strong>{item.name}</strong><small>{item.detail}</small></span><span className="picker-target">to new {item.isPrivate || provider === 'teams' ? 'private ' : ''}channel #{item.overlay}</span><Button variant="ghost" size="sm" onClick={() => link(item)}>Link</Button></div>)}</div>}

            <div className="channel-table" role="table" aria-label={p.name + ' channel links'}>
              <div className="table-head" role="row"><span role="columnheader">{p.name} channel</span><span role="columnheader">Overlay channel</span><span role="columnheader">Status</span><span role="columnheader" className="sr-only">Actions</span></div>
              {rows.length === 0 && <p className="empty">No channels linked yet. Link a channel to start syncing.</p>}
              {rows.map(row => <div className="table-row" role="row" key={row.id}>
                <span role="cell" className="cell-copy"><strong>{provider === 'slack' ? '#' : ''}{row.name}</strong><small>{row.detail}</small></span>
                <span role="cell" className="overlay-channel">{row.isPrivate ? <Lock size={12} /> : <Hash size={12} />}{row.overlay}</span>
                <span role="cell"><StatusCell link={row} /></span>
                <span role="cell" className="row-actions">{row.status === 'paused' ? <Button variant="ghost" size="sm" onClick={() => resume(row)}>Check again</Button> : null}<Button variant="ghost" size="sm" onClick={() => unlink(row)}>Unlink</Button></span>
              </div>)}
            </div>
            <p className="health"><Check size={12} />{p.limitNote}</p>
          </div>
        </section></div>
      </main>
    </div><Toaster theme={dark ? 'dark' : 'light'} visibleToasts={3} />
  </>
}
createRoot(document.getElementById('root')!).render(<App />)
