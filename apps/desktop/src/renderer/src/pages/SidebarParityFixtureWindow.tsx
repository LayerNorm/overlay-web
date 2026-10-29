import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  FileText,
  Globe,
  Home,
  MessageSquare,
  Mic,
  Puzzle,
  Workflow,
} from 'lucide-react'
import { OverlayMark } from '@overlay/ui'
import {
  SidebarAccountMenu,
  ShellAdapterProvider,
  UnifiedSidebar,
  WorkspaceSwitcherView,
  type PrimaryRailItem,
  type ShellWorkspace,
  type SecondaryPanelNav,
} from '@overlay/shell-react'
import { desktopShellAdapter } from '../shell/DesktopShellAdapter'
import {
  DESKTOP_MORE_GROUPS,
  DESKTOP_SETTINGS_GROUPS,
  DESKTOP_SETTINGS_ITEMS,
} from '../shell/navigation'

const items: PrimaryRailItem[] = [
  { id: 'home', label: 'Home', icon: Home, onSelect: () => undefined },
  { id: 'agents', label: 'Agents', icon: Bot, onSelect: () => undefined },
  { id: 'chat', label: 'Chats', icon: MessageSquare, onSelect: () => undefined },
  { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => undefined },
  { id: 'files', label: 'Files', icon: FileText, onSelect: () => undefined },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, onSelect: () => undefined },
  { id: 'voice', label: 'Voice', icon: Mic, onSelect: () => undefined },
  { id: 'browser', label: 'Browser', icon: Globe, onSelect: () => undefined },
]

const workspaces: ShellWorkspace[] = [
  { id: 'personal', name: 'Personal', memberLabel: 'Personal' },
  { id: 'workspace', name: 'Studio', role: 'member', memberLabel: 'Organization · member' },
]

export function SidebarParityFixtureWindow(): React.ReactElement<any> {
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state') ?? 'chats-expanded'
  const dark = params.get('theme') === 'dark'
  const [collapsed, setCollapsed] = useState(state === 'collapsed')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(state === 'workspace-menu-open')
  const workspaceRootRef = useRef<HTMLDivElement>(null)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const panelKind = state === 'settings'
    ? 'settings'
    : state.startsWith('agents')
      ? 'agents'
      : 'chat'
  const panelNav: SecondaryPanelNav = state === 'settings'
    ? {
        items: DESKTOP_SETTINGS_ITEMS,
        activeId: 'general',
        onSelect: () => undefined,
      }
    : {
        items: [
          {
            id: 'personal',
            label: 'Personal',
            children:
              panelKind === 'agents'
                ? [
                    { id: 'personal:agents', label: 'Agents' },
                    { id: 'personal:threads', label: 'Threads' },
                  ]
                : [{ id: 'personal:chat', label: 'Chats' }],
          },
          {
            id: 'workspace',
            label: 'Workspace',
            children:
              panelKind === 'agents'
                ? [
                    { id: 'workspace:agents', label: 'Agents' },
                    { id: 'workspace:threads', label: 'Threads' },
                  ]
                : [{ id: 'workspace:chat', label: 'Chats' }],
          },
        ],
        activeId: 'personal',
        onSelect: () => undefined,
      }
  const fixtureItems =
    state === 'settings'
      ? [
          {
            id: 'settings-close',
            label: 'Back to app',
            icon: ArrowLeft,
            onSelect: () => undefined,
          },
        ]
      : items.map((item) => ({
          ...item,
          active: item.id === (panelKind === 'agents' ? 'agents' : 'chat'),
        }))
  const renderSection = (id: string): React.ReactElement<any> => {
    const values = panelKind === 'agents'
      ? id.includes('threads')
        ? ['Planning session', 'Research follow-up']
        : ['Atlas', 'Nova']
      : ['Untitled conversation', 'Design review', 'Project notes']
    const Icon = panelKind === 'agents' ? Bot : MessageSquare
    return (
      <div className="space-y-1 pb-2">
        {values.map((value) => (
          <div
            key={value}
            className="flex h-8 min-w-0 items-center gap-2.5 truncate rounded-md px-2 text-sm text-(--foreground) hover:bg-(--surface-subtle)"
          >
            <Icon size={16} className="mx-1 shrink-0" aria-hidden />
            {value}
          </div>
        ))}
      </div>
    )
  }

  useEffect(() => {
    if (state !== 'more-open') return
    document.querySelector<HTMLButtonElement>('[data-tour="nav-more"]')?.click()
  }, [state])

  const account = (
    <WorkspaceSwitcherView
      rootRef={workspaceRootRef}
      menuRef={workspaceMenuRef}
      open={workspaceMenuOpen}
      compact={false}
      placement="footer"
      accountMenu={
        <SidebarAccountMenu
          onAccountClick={() => undefined}
          onSettingsClick={() => undefined}
          onSignOut={() => undefined}
        />
      }
      renderAvatar={(workspace, size) => (
        <span
          className={`${size === 'sm' ? 'size-7' : size === 'md' ? 'size-8' : 'size-9'} flex shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) text-xs font-semibold text-(--foreground)`}
        >
          {workspace.name.slice(0, 1)}
        </span>
      )}
      status="ready"
      workspaces={workspaces}
      activeWorkspace={workspaces[1]!}
      activeWorkspaceId="workspace"
      switchingWorkspaceId={null}
      error={null}
      actionError={null}
      refresh={() => undefined}
      onSelectWorkspace={() => undefined}
      onCreateRequest={() => undefined}
      onOpenChange={setWorkspaceMenuOpen}
    />
  )

  return (
    <div
      data-theme={dark ? 'dark' : 'light'}
      className="flex h-screen bg-(--background) text-(--foreground)"
    >
      <div className="shared-app-scope h-full shrink-0">
        <ShellAdapterProvider value={desktopShellAdapter}>
          <UnifiedSidebar
            brand={
              <span className="flex items-baseline gap-[0.4em] font-serif text-[17px]">
                <OverlayMark size={8.5} className="-translate-y-[0.02em]" />
                overlay
              </span>
            }
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            items={fixtureItems}
            panelKind={panelKind}
            panelNav={panelNav}
            sectionActions={{
              chat: { label: 'New chat', onClick: () => undefined },
              agents: { label: 'New agent', onClick: () => undefined },
              automations: { label: 'New automation', onClick: () => undefined },
              files: { label: 'New file', onClick: () => undefined },
            }}
            renderSection={renderSection}
            onSearch={() => undefined}
            scope="personal"
            moreGroups={DESKTOP_MORE_GROUPS}
            settingsGroups={DESKTOP_SETTINGS_GROUPS}
            account={account}
            keyboardShortcut
            resizable
          />
        </ShellAdapterProvider>
      </div>
      <main className="flex-1 p-6">
        <h1 className="text-lg">{state}</h1>
      </main>
    </div>
  )
}
