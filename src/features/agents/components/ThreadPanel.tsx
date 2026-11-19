'use client'

import { useState, type ReactNode } from 'react'
import {
  FileText, Folder, GitCompare, ListChecks, Maximize2, Minimize2, Monitor, Plus, Search, SlidersHorizontal,
  SquareTerminal, X, type LucideIcon,
} from 'lucide-react'
import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { Button, Input } from '@overlay/ui/primitives'
import { useChatFilesHost } from '@overlay/chat-react'
import type { ThreadPanelKind } from '@/shared/agents/agent-right-sidebar-preferences'
import {
  activeTab as activeTabOf, closeTab, replaceLauncher, selectTab, type ThreadPanelTab, type ThreadPanelTabs,
} from '../lib/thread-panel-tabs'
import { ChangesPanel, ProgressPanel, TerminalPanel } from './ThreadPanel.parts'

export const PANEL_META: Record<ThreadPanelKind, { label: string; icon: LucideIcon; hint: string; shortcut?: string }> = {
  progress: { label: 'Progress', icon: ListChecks, hint: 'Plan and activity' },
  computer: { label: 'Computer', icon: Monitor, hint: 'Watch or take control' },
  changes: { label: 'Changes', icon: GitCompare, hint: 'Edits and pull requests' },
  files: { label: 'Files', icon: Folder, hint: 'What this thread made', shortcut: '⌘ P' },
  terminal: { label: 'Terminal', icon: SquareTerminal, hint: 'Commands it ran', shortcut: '⌘ J' },
  agent: { label: 'Agent', icon: SlidersHorizontal, hint: 'Model, instructions, tools' },
}

let launcherCount = 0
/** A fresh id for a launcher ("New tab"); launchers are never remembered, so a counter is enough. */
export const nextLauncherId = () => `new:${++launcherCount}`

export type ThreadComputerStatus = 'running' | 'starting' | 'asleep' | 'unavailable'

export type ThreadPanelProps = {
  agentName: string
  /** The agent's avatar at launcher size; read-only, unlike the Agent tab's avatar picker. */
  avatar: ReactNode
  hero: { avatar: ReactNode; title: ReactNode; titleText: string; subtitle?: ReactNode }
  agent: ReactNode
  files: ReactNode
  computer: ReactNode
  computerStatus: ThreadComputerStatus
  pullRequests: readonly WorkspaceThreadPullRequest[]
  renderFile(fileId: string, close: () => void): ReactNode
  tabs: ThreadPanelTabs
  onTabsChange(update: (tabs: ThreadPanelTabs) => ThreadPanelTabs): void
  onOpenLauncher(): void
  expanded: boolean
  onToggleExpanded(): void
  onClose(): void
}

/** Everything beside an agent thread as tabs in one docked panel; "+" opens a launcher for more. */
export function ThreadPanel(props: ThreadPanelProps) {
  const { tabs, onTabsChange, expanded } = props
  const active = activeTabOf(tabs)
  const close = (id: string) => onTabsChange((current) => closeTab(current, id, nextLauncherId()))
  return (
    <aside data-slot="right-sidebar" aria-label="Thread panel"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-(--sidebar-surface)">
      <div className="flex h-[50px] shrink-0 items-center gap-1 border-b border-(--border) pl-2 pr-1.5">
        <div role="tablist" aria-label="Open panels"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.tabs.map((tab) => (
            <PanelTabButton key={tab.id} tab={tab} agentName={props.agentName}
              active={tab.id === active?.id} compact={tabs.tabs.length > 3 && tab.id !== active?.id}
              onSelect={() => onTabsChange((current) => selectTab(current, tab.id))}
              onClose={() => close(tab.id)} />
          ))}
          <Button variant="ghost" size="icon-xs" type="button" aria-label="New tab" title="New tab  ⌥T"
            onClick={props.onOpenLauncher} className="ml-0.5 shrink-0 text-(--muted)">
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" size="icon-xs" type="button" aria-label={expanded ? 'Restore panel' : 'Expand panel'}
          title={expanded ? 'Restore panel' : 'Expand panel'} onClick={props.onToggleExpanded} className="shrink-0 text-(--muted)">
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button variant="ghost" size="icon-xs" type="button" aria-label="Close panel" title="Close panel" onClick={props.onClose}
          className="shrink-0 text-(--muted)">
          <X />
        </Button>
      </div>
      <div role="tabpanel" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {active ? <PanelBody tab={active} {...props} onCloseTab={() => close(active.id)} /> : null}
      </div>
    </aside>
  )
}

function PanelTabButton({ tab, active, compact, agentName, onSelect, onClose }: {
  tab: ThreadPanelTab
  active: boolean
  compact: boolean
  agentName: string
  onSelect(): void
  onClose(): void
}) {
  const meta = tab.kind === 'file' ? null : tab.kind === 'new' ? { label: 'New tab', icon: Search } : PANEL_META[tab.kind]
  const Icon = meta?.icon ?? FileText
  const text = tab.kind === 'agent' ? agentName : meta?.label
  return (
    <div className={`group/tab relative flex h-7 min-w-0 max-w-[160px] shrink-0 items-center rounded-md ${
      active ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted) hover:bg-(--surface-subtle)/60 hover:text-(--foreground)'
    }`}>
      <Button variant="ghost" size="xs" type="button" role="tab" aria-selected={active} onClick={onSelect}
        title={compact ? text : undefined} aria-label={compact ? text : undefined}
        className={`h-7 min-w-0 max-w-full justify-start gap-1.5 bg-transparent ${compact ? 'px-2' : active ? 'pl-2 pr-7' : 'px-2.5'} text-[12px] font-normal text-inherit hover:bg-transparent hover:text-inherit`}>
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {compact ? null : <span className="truncate">{tab.kind === 'file' ? <FileTabLabel fileId={tab.fileId} /> : text}</span>}
      </Button>
      {active ? (
        <Button variant="ghost" size="icon-xs" type="button" aria-label="Close tab" onClick={onClose}
          className="absolute right-1 size-5 rounded text-(--muted) hover:bg-(--surface-elevated) hover:text-(--foreground) [&_svg]:size-3">
          <X />
        </Button>
      ) : null}
    </div>
  )
}

function FileTabLabel({ fileId }: { fileId: string }) {
  const { useFileSummaries } = useChatFilesHost()
  return <>{useFileSummaries([fileId])?.get(fileId)?.name ?? 'File'}</>
}

function PanelBody({ tab, onCloseTab, ...props }: ThreadPanelProps & { tab: ThreadPanelTab; onCloseTab(): void }) {
  switch (tab.kind) {
    case 'new': return <Launcher launcherId={tab.id} {...props} />
    case 'agent': return (
      <>
        <div className="flex shrink-0 flex-col items-center px-5 pb-4 pt-8 text-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center">{props.hero.avatar}</div>
          <h2 aria-label={props.hero.titleText} className="mt-[14px] max-w-full text-lg font-medium leading-6 text-(--foreground)">
            {props.hero.title}
          </h2>
          {props.hero.subtitle ? <div className="mt-0.5 max-w-full text-[13px] leading-5 text-(--muted)">{props.hero.subtitle}</div> : null}
        </div>
        <div className="flex flex-1 flex-col px-5 pb-6">{props.agent}</div>
      </>
    )
    case 'files': return <div className="flex flex-1 flex-col px-5 pb-6 pt-4">{props.files}</div>
    case 'computer': return <div className="flex flex-1 flex-col px-5 pb-6 pt-4">{props.computer}</div>
    case 'progress': return <ProgressPanel agentName={props.agentName} />
    case 'changes': return <ChangesPanel pullRequests={props.pullRequests} />
    case 'terminal': return <TerminalPanel agentName={props.agentName} />
    case 'file': return <div className="flex min-h-0 flex-1 flex-col [&>aside]:border-0">{props.renderFile(tab.fileId, onCloseTab)}</div>
  }
}

const COMPUTER_STATUS: Record<ThreadComputerStatus, { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'bg-green-600 dark:bg-green-400' },
  starting: { label: 'Starting', dot: 'bg-amber-500' },
  asleep: { label: 'Asleep', dot: 'bg-(--muted-light)' },
  unavailable: { label: 'Unavailable', dot: 'bg-(--muted-light)' },
}

const LAUNCHER_ROWS = ['progress', 'changes', 'files', 'terminal', 'agent'] as const

function Launcher({ launcherId, agentName, avatar, computerStatus, onTabsChange }: ThreadPanelProps & { launcherId: string }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const open = (kind: ThreadPanelKind) => onTabsChange((current) => replaceLauncher(current, launcherId, kind))
  const rows = LAUNCHER_ROWS.filter((kind) => {
    const meta = PANEL_META[kind]
    return `${kind === 'agent' ? agentName : meta.label} ${meta.hint}`.toLowerCase().includes(needle)
  })
  const showComputer = `computer ${PANEL_META.computer.hint}`.toLowerCase().includes(needle)
  const status = COMPUTER_STATUS[computerStatus]
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-col px-5 pb-10 pt-8">
      <div className="mb-6 flex flex-col items-center gap-2.5">
        {avatar}
        <span className="max-w-full truncate text-[15px] font-medium text-(--foreground)">{agentName}</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-(--muted)" />
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search panels"
          placeholder="Search panels"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const first = showComputer ? 'computer' : rows[0]
            if (first) open(first)
          }}
          className="h-9 rounded-lg border-(--border) bg-(--surface-subtle) pl-8 pr-12 text-[13px] focus-visible:border-(--muted-light) focus-visible:ring-0" />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-[11px] text-(--muted-light)">⌥ T</kbd>
      </div>
      {showComputer ? (
        <Button variant="ghost" type="button" onClick={() => open('computer')}
          className="mt-3 flex h-11 w-full items-center justify-start gap-2.5 rounded-xl bg-(--surface-subtle)/50 px-3 text-left text-[13px] font-normal text-(--foreground) hover:bg-(--surface-subtle)">
          <Monitor className="size-4 text-(--muted)" strokeWidth={1.75} />
          Computer
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-(--muted)">
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </Button>
      ) : null}
      <div className="mt-2 flex flex-col">
        {rows.map((kind) => {
          const { icon: Icon, label, hint, shortcut } = PANEL_META[kind]
          return (
            <Button key={kind} variant="ghost" type="button" onClick={() => open(kind)}
              className="group/row h-9 justify-start gap-2.5 rounded-lg px-2 text-[13px] font-normal text-(--foreground)">
              <Icon className="size-4 text-(--muted)" strokeWidth={1.75} />
              <span className="truncate">{kind === 'agent' ? agentName : label}</span>
              <span className="ml-auto text-[11px] text-(--muted-light) group-hover/row:hidden">{shortcut ?? ''}</span>
              <span className="ml-auto hidden text-[11px] text-(--muted) group-hover/row:inline">{hint}</span>
            </Button>
          )
        })}
        {rows.length === 0 && !showComputer ? (
          <p className="px-2 py-6 text-center text-[13px] text-(--muted)">Nothing matches “{query}”.</p>
        ) : null}
      </div>
    </div>
  )
}
