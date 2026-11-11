import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Bot, ChevronDown, ChevronRight, CircleHelp, Folder, Hash, KeyRound, ListChecks, MessageSquare, PanelLeft, Plus, Settings, Sun, Trash2, Workflow, X } from 'lucide-react'
import slackLogo from '../../../public/assets/svg/landing/slack.svg'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Input } from '../../../packages/overlay-ui/src/components/ui/input'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { ListboxSelect } from '../../../packages/overlay-ui/src/components/primitives/ListboxSelect'
import { TabsList, TabButton } from '../../../packages/overlay-ui/src/components/primitives/Tabs'
import { SegmentedControl } from '../../../packages/overlay-ui/src/components/primitives/SegmentedControl'
import { Toggle } from '../../../packages/overlay-ui/src/components/primitives/Toggle'
import { AGENT_TOOL_GROUPS } from '../../../src/shared/agents/tool-groups'
import { Popover, PopoverContent, PopoverTrigger } from '../../../packages/overlay-ui/src/components/ui/popover'
import { ConfirmDialog } from '../../../packages/overlay-ui/src/components/overlays/ConfirmDialog'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { ShellAdapterProvider, type ShellLinkProps } from '../../../packages/overlay-shell-react/src/adapter'
import { SidebarMenu, SidebarMenuSubItem, SidebarMenuSubButton } from '../../../packages/overlay-ui/src/components/ui/sidebar'
import { AppBreadcrumbContext } from '../../../packages/overlay-modules-react/src/components/AppBreadcrumbs'
import { SettingsPageShell } from '../../../packages/overlay-modules-react/src/settings/page-shell'
import { DEFAULT_OVERLAY_SETTINGS_SECTIONS } from '../../../packages/overlay-app-core/src/app-shell'
import { SETTINGS_SECTION_ICONS } from '../../../src/components/layout/sidebar/appSidebarNav'
import { WorkspaceAvatar } from '../../../src/components/identity/WorkspaceAvatar'
import { WORKSPACE_SETTINGS_TABS } from '../../../src/features/workspaces/lib/workspace-settings-tabs'

type Preview = 'admin-disconnected' | 'admin-connected' | 'member-linked' | 'member-unlinked' | 'agent-editor'
const previews: { value: Preview; label: string }[] = [
  { value: 'admin-disconnected', label: 'Admin · Not connected' },
  { value: 'admin-connected', label: 'Admin · Connected' },
  { value: 'member-linked', label: 'Member · Linked' },
  { value: 'member-unlinked', label: 'Member · Not linked' },
  { value: 'agent-editor', label: 'Agent editor' },
]
function SlackLogo({ size = 24, className = '' }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={slackLogo} width={size} height={size} className={'shrink-0 ' + className} alt="" />
}
const workspaceTabs = WORKSPACE_SETTINGS_TABS.filter(tab => tab.id !== 'teams').map(tab => tab.id === 'slack' ? { ...tab, icon: SlackLogo } : tab)
const settingsItems = DEFAULT_OVERLAY_SETTINGS_SECTIONS.map(({ id, label }) => ({ id, label, icon: SETTINGS_SECTION_ICONS[id] ?? Settings }))
function PreviewLink({ prefetch, onClick, ...props }: ShellLinkProps) {
  void prefetch
  return <a {...props} onClick={event => { event.preventDefault(); onClick?.(event) }} />
}

function AgentEditor() {
  const [permission, setPermission] = React.useState('ask')
  const [tools, setTools] = React.useState(() => new Set(AGENT_TOOL_GROUPS.map(group => group.id)))
  return <div className="mx-auto w-full max-w-2xl">
    <p className="mt-5 rounded-xl border border-(--border) bg-(--surface-subtle) p-4 text-xs leading-5 text-(--muted)">Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).</p>
    <div className="mt-5 space-y-5">
      <div className="space-y-3.5">
        <div className="flex items-center gap-3"><OverlayMark size={40} /><span className="text-xs text-(--muted)">Workspace Chief</span></div>
        <div><label className="mb-1.5 block text-xs font-medium" htmlFor="agent-name">Name</label><Input id="agent-name" defaultValue="Overlay" /></div>
        <div><label className="mb-1.5 block text-xs font-medium" htmlFor="agent-description">Description</label><Textarea id="agent-description" defaultValue="Your workspace Chief of Staff." className="min-h-16 resize-none!" /></div>
      </div>
      <label className="block text-xs font-medium">Agent instructions<Textarea defaultValue="Help the team get work done. Delegate to specialists when needed and bring back one clear answer." className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-(--border) bg-(--background) px-3 py-2.5 text-sm leading-5" /></label>
      <div><p className="text-xs font-medium">Model</p><Button variant="secondary" className="mt-1.5 w-full justify-between">Auto<ChevronDown size={12} /></Button></div>
      <div><p className="text-xs font-medium">Tools</p><p className="mt-1 text-[11px] leading-4 text-(--muted)">Grant this agent the same tools the personal chat can use. It only acts on what you enable here.</p><div className="mt-1">{AGENT_TOOL_GROUPS.map(group => <div key={group.id} className="flex items-center gap-3 border-b border-(--border) py-2.5 last:border-b-0"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-(--foreground)">{group.label}</p><p className="mt-0.5 text-[11px] leading-4 text-(--muted)">{group.description}</p></div><Toggle checked={tools.has(group.id)} aria-label={group.label} onCheckedChange={enabled => setTools(previous => { const next = new Set(previous); if (enabled) next.add(group.id); else next.delete(group.id); return next })} /></div>)}</div></div>
      <Button variant="ghost" size="sm" className="justify-start text-xs text-(--muted)">Advanced<ChevronDown size={13} /></Button>
      <div><p className="mb-1.5 text-xs font-medium">Permissions</p><SegmentedControl ariaLabel="Permissions" layout="stretch" value={permission} options={[{ value: 'ask', label: 'Ask' }, { value: 'auto', label: 'Auto' }]} onChange={setPermission} /><p className="mt-1.5 text-[11px] leading-4 text-(--muted)">{permission === 'ask' ? 'Asks before typing, terminal commands, risky clicks and app actions.' : 'Runs everything without asking, including in automations.'}</p></div>
      <Button className="mt-2 w-full" disabled>Save changes</Button>
      <Button variant="ghost" className="w-full">Cancel</Button>
    </div>
  </div>
}

function App() {
  const params = new URLSearchParams(location.search)
  const [preview, setPreview] = React.useState<Preview>(previews.find(option => option.value === params.get('state'))?.value ?? 'admin-connected')
  const [dark, setDark] = React.useState(params.get('theme') === 'dark')
  const [collapsed, setCollapsed] = React.useState(false)
  const [drawer, setDrawer] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('workspace')
  const [expanded, setExpanded] = React.useState(true)
  const [channels, setChannels] = React.useState(['general', 'product'])
  const [search, setSearch] = React.useState('')
  const [picker, setPicker] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState<'disconnect' | 'unlink' | null>(null)
  const [accountLinked, setAccountLinked] = React.useState(preview !== 'member-unlinked')
  const editor = preview === 'agent-editor'
  const admin = preview.startsWith('admin')
  const connected = preview !== 'admin-disconnected'
  const linked = accountLinked
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  React.useEffect(() => {
    const tabs = document.querySelector('[aria-label="Workspace settings"]')
    const reveal = () => tabs?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'end' })
    void document.fonts.ready.then(reveal)
    const resize = new ResizeObserver(reveal)
    if (tabs?.parentElement) resize.observe(tabs.parentElement)
    return () => resize.disconnect()
  }, [editor])
  function changePreview(next: Preview) { setPreview(next); setAccountLinked(next !== 'member-unlinked'); setChannels(['general', 'product']); setConfirmation(null); setPicker(false); setDrawer(false) }
  const available = ['general', 'product', 'engineering', 'support', 'team-updates'].filter(channel => !channels.includes(channel) && channel.includes(search.toLowerCase().replace(/^#/, '')))
  function linkAccount() { setAccountLinked(true); if (!admin) setPreview('member-linked') }
  const sidebarToggle = <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar" onClick={() => { if (innerWidth < 768) setDrawer(!drawer); else setCollapsed(!collapsed) }}><PanelLeft size={16} /></Button>
  return <ShellAdapterProvider value={{ Link: PreviewLink, rememberScope: setScope }}>
    <div className="preview-bar"><span className="preview-caption">Mockup · Slack</span><div><ListboxSelect value={preview} options={previews} onChange={changePreview} aria-label="Preview state" buttonClassName="h-8 min-h-8 text-xs" /><Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setDark(!dark)}><Sun size={15} /></Button></div></div>
    <div data-app-shell className={'shell' + (drawer ? ' sidebar-open' : '')}>
      <div className="workspace-navigation">
        <DoubleSidebar brand={<OverlayMark size={24} />} railBrand={<OverlayMark size={24} />} title={editor ? 'Agents' : 'Settings'} themePreset={dark ? 'default-dark' : 'default-light'} collapsed={collapsed} onCollapsedChange={setCollapsed} resizable keyboardShortcut panelKind={editor ? 'agents' : 'settings'} scope={scope}
          onSearch={editor ? () => {} : undefined} panelAction={editor ? { label: 'New agent', onClick: () => {} } : undefined}
          panelNav={editor ? { activeId: scope, onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) }, items: [{ id: 'personal', label: 'Personal' }, { id: 'workspace', label: 'Workspace' }] } : {
            activeId: 'workspace', onSelect: () => setDrawer(false), items: settingsItems,
          }}
          items={[{ id: 'work', label: 'Work', icon: ListChecks, onSelect: () => {} }, { id: 'agents', label: 'Agents', icon: Bot, active: editor, onSelect: () => changePreview('agent-editor') }, { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => {} }, { id: 'files', label: 'Files', icon: Folder, onSelect: () => {} }, { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => {} }, ...(!editor ? [{ id: 'settings-close', label: 'Back to app', icon: ChevronRight, onSelect: () => changePreview('agent-editor') }] : [])]}
          footerItems={[{ id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(!dark) }, { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => {} }, { id: 'settings', label: 'Settings', icon: Settings, active: !editor, onSelect: () => changePreview('admin-connected') }]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account">DL</Button>}>
          {editor && <><div className="agent-row"><Button variant="ghost" className="agent-name" aria-label="Toggle Overlay threads" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<OverlayMark size={24} />Overlay</Button></div>{expanded && <SidebarMenu className="agent-thread-tree" aria-label="Overlay threads">{['Plan the next release', 'Review customer feedback'].map(title => <SidebarMenuSubItem key={title}><SidebarMenuSubButton className="single-line-thread"><span className="thread-title">{title}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenu>}</>}
        </DoubleSidebar>
        <Button variant="ghost" size="icon-sm" className="mobile-sidebar-close" aria-label="Close sidebar" onClick={() => setDrawer(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <AppBreadcrumbContext value={{ items: [], leading: sidebarToggle }}>
          <SettingsPageShell title={editor ? 'Agents' : 'Settings'} activeLabel={editor ? 'Edit Overlay' : 'Workspace'}>
            {editor ? <AgentEditor /> : <section className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface-elevated)">
              <header className="flex items-center gap-3 px-5 py-4">
                <WorkspaceAvatar workspace={{ name: 'LayerNorm' }} size="lg" />
                <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">LayerNorm</h2><p className="mt-0.5 truncate text-xs text-(--muted)">Organization workspace</p></div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-(--border) px-2.5 py-1 text-[10px] font-medium capitalize text-(--muted)"><KeyRound size={11} />{admin ? 'Admin' : 'Member'}</span>
              </header>
              <div className="overflow-x-auto border-b border-(--border) px-5"><TabsList className="min-w-max gap-1 rounded-none bg-transparent p-0" aria-label="Workspace settings">{workspaceTabs.map(({ label, icon: Icon }) => <TabButton key={label} active={label === 'Slack'} className={'relative h-11 gap-1.5 rounded-none bg-transparent px-2.5 shadow-none ' + (label === 'Slack' ? 'after:absolute after:inset-x-1 after:bottom-0 after:h-px after:bg-(--foreground)' : '')}><Icon size={13} />{label}</TabButton>)}</TabsList></div>
              {!connected ? <div className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 px-5 py-4 sm:grid-cols-[36px_minmax(0,1fr)_auto]"><span className="flex size-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle)"><SlackLogo /></span><div className="min-w-0"><h3 className="text-sm font-medium leading-5">Connect Slack</h3><p className="mt-1 text-sm leading-relaxed text-(--muted)">The Overlay bot joins your Slack workspace and routes every message to your workspace Chief.</p></div><Button size="sm" variant="secondary" className="col-start-2 justify-self-start sm:col-start-3" onClick={() => { changePreview('admin-connected'); setAccountLinked(false) }}>Connect Slack</Button></div> : <>
                <div data-slack-connection className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-4"><span data-slack-logo className="flex size-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle)"><SlackLogo /></span><div className="min-w-0"><h3 data-slack-team className="text-sm font-medium leading-5">LayerNorm</h3><p className="mt-0.5 text-xs leading-4 text-(--muted)">Slack workspace</p></div><span className="self-start justify-self-end pr-3 text-xs leading-5 text-(--muted)">Connected</span><p data-slack-bot className="col-span-2 col-start-2 flex items-center gap-1.5 text-xs leading-5 text-(--muted)"><OverlayMark size={15} /><span>Overlay bot · Workspace Chief</span></p></div>
                <div data-slack-channels-heading className="flex h-10 items-center justify-between gap-3 border-t border-(--border) px-5 py-1"><h3 className="text-xs font-medium leading-5 text-(--muted)">Enabled public channels</h3>{admin && <Popover open={picker} onOpenChange={setPicker}><PopoverTrigger asChild><Button variant="ghost" size="sm" onClick={() => setSearch('')}><Plus size={13} />Add channel</Button></PopoverTrigger><PopoverContent align="end" className="w-64 p-2"><Input aria-label="Search public channels" placeholder="Search public channels…" value={search} onChange={event => setSearch(event.target.value)} className="mb-1" />{available.map(channel => <Button key={channel} variant="ghost" className="w-full justify-start text-sm" onClick={() => { setChannels(previous => [...previous, channel]); setPicker(false) }}><Hash size={14} />{channel}</Button>)}{!available.length && <p className="px-2 py-3 text-xs text-(--muted)">No matching public channels.</p>}</PopoverContent></Popover>}</div>
                <div className="divide-y divide-(--border)">{channels.map(channel => <div data-slack-channel key={channel} className="flex h-12 items-center gap-3 px-5 py-3"><span data-slack-channel-icon className="flex h-6 w-9 shrink-0 items-center justify-center text-(--muted)"><Hash size={16} /></span><span data-slack-channel-name className="min-w-0 flex-1 truncate text-sm font-medium leading-5">{channel}</span>{admin && <Button variant="ghost" size="icon-xs" data-slack-remove aria-label={`Remove #${channel}`} onClick={() => setChannels(previous => previous.filter(item => item !== channel))}><Trash2 size={13} /></Button>}</div>)}{!channels.length && <p className="px-5 py-3 text-sm text-(--muted)">No channels enabled. Add a public channel to receive messages.</p>}</div>
                <div data-slack-account className={'flex min-h-16 items-center justify-between gap-3 border-t border-(--border) px-5 py-3 ' + (!linked ? 'max-sm:items-start max-sm:flex-col' : '')}><div className="min-w-0"><h3 className="text-sm font-medium leading-5">Your Slack account</h3><p className="mt-0.5 text-xs leading-4 text-(--muted)">{linked ? 'Linked as @dana' : 'Link your account to message Overlay in Slack.'}</p></div><Button variant={linked ? 'ghost' : 'secondary'} size="sm" onClick={() => linked ? setConfirmation('unlink') : linkAccount()}>{linked ? 'Unlink' : 'Link your Slack account'}</Button></div>
                {admin && <div className="flex items-center justify-between gap-3 border-t border-(--border) px-5 py-3"><span className="text-sm text-(--muted)">Slack connection</span><Button variant="ghost" size="sm" onClick={() => setConfirmation('disconnect')}>Disconnect</Button></div>}
              </>}
              <p className="border-t border-(--border) px-5 py-3 text-xs leading-5 text-(--muted)">DMs, private channels and Slack Connect aren’t supported yet.</p>
            </section>}
          </SettingsPageShell>
        </AppBreadcrumbContext>
      </main>
    </div>
    <ConfirmDialog isOpen={confirmation !== null} title={confirmation === 'disconnect' ? 'Disconnect Slack?' : 'Unlink your Slack account?'} description={confirmation === 'disconnect' ? 'Overlay will stop receiving and replying to messages in every enabled channel in LayerNorm. You can reconnect later.' : 'You won’t be able to send requests to Overlay in Slack until you link your account again. The workspace connection stays connected.'} confirmLabel={confirmation === 'disconnect' ? 'Disconnect Slack' : 'Unlink account'} onCancel={() => setConfirmation(null)} onConfirm={() => { if (confirmation === 'disconnect') changePreview('admin-disconnected'); else { setAccountLinked(false); if (!admin) setPreview('member-unlinked'); setConfirmation(null) } }} />
  </ShellAdapterProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
