'use client'

import type { ReactNode } from 'react'
import {
  FileText, Folder, GitBranch, GitCompare, Globe, ListChecks, Maximize2, Minimize2, Monitor, Plus, SlidersHorizontal,
  X, type LucideIcon,
} from 'lucide-react'
import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { LinkPreviewTab, linkTabLabel, useChatFilesHost } from '@overlay/chat-react'
import { checkLinkEmbeddable } from '@/shared/web/link-preview'
import type { ThreadPanelKind } from '@/shared/agents/agent-right-sidebar-preferences'
import {
  activeTab as activeTabOf, closeTab, openPanel, replaceLauncher, selectTab, type ThreadPanelTab, type ThreadPanelTabs,
} from '../lib/thread-panel-tabs'
import { ChangesPanel, ProgressPanel } from './ThreadPanel.parts'

export const PANEL_META: Record<ThreadPanelKind, { label: string; icon: LucideIcon; hint: string }> = {
  assignments: { label: 'Assignments', icon: GitBranch, hint: 'Work handed to other agents' },
  progress: { label: 'Progress', icon: ListChecks, hint: 'Plan and activity' },
  computer: { label: 'Cloud computer', icon: Monitor, hint: "The agent's machine in the cloud, not your Mac" },
  changes: { label: 'Changes', icon: GitCompare, hint: 'Edits and pull requests' },
  files: { label: 'Files', icon: Folder, hint: 'What this thread made' },
  agent: { label: 'Settings', icon: SlidersHorizontal, hint: 'Model, instructions, tools' },
}

let launcherCount = 0
/** A fresh id for a launcher ("New tab"); launchers are never remembered, so a counter is enough. */
export const nextLauncherId = () => `new:${++launcherCount}`

export type ThreadComputerStatus = 'running' | 'starting' | 'asleep' | 'unavailable'

export type ThreadPanelProps = {
  agentName: string
  hero: { avatar: ReactNode; title: ReactNode; titleText: string; subtitle?: ReactNode }
  agent: ReactNode
  /** The conversation's assignments, grouped by the response that made them. */
  assignments: ReactNode
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

/** Everything beside an agent thread as tabs in one docked panel; "+" opens the agent's home as a new tab. */
export function ThreadPanel(props: ThreadPanelProps) {
  const { tabs, onTabsChange, expanded } = props
  const active = activeTabOf(tabs)
  const close = (id: string) => onTabsChange((current) => closeTab(current, id))
  const home = tabs.tabs.length === 0
  return (
    <aside data-slot="right-sidebar" aria-label="Thread panel"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-(--sidebar-surface)">
      <div className="flex h-[50px] shrink-0 items-center gap-1 pl-2 pr-1.5">
        {home ? <div className="flex-1" /> : <div role="tablist" aria-label="Open panels"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.tabs.map((tab) => (
            <PanelTabButton key={tab.id} tab={tab} agentName={props.agentName}
              active={tab.id === active?.id} compact={tabs.tabs.length > 3 && tab.id !== active?.id}
              onSelect={() => onTabsChange((current) => selectTab(current, tab.id))}
              onClose={() => close(tab.id)} />
          ))}
          <Button variant="ghost" size="icon-xs" type="button" aria-label="New tab" title="New tab"
            onClick={props.onOpenLauncher} className="ml-0.5 shrink-0 text-(--muted)">
            <Plus />
          </Button>
        </div>}
        <Button variant="ghost" size="icon-xs" type="button" aria-label={expanded ? 'Restore panel' : 'Expand panel'}
          title={expanded ? 'Restore panel' : 'Expand panel'} onClick={props.onToggleExpanded} className="shrink-0 text-(--muted)">
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button variant="ghost" size="icon-xs" type="button" aria-label="Close panel" title="Close panel" onClick={props.onClose}
          className="shrink-0 text-(--muted)">
          <X />
        </Button>
      </div>
      <div role={home ? undefined : 'tabpanel'} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {home ? <Home {...props} /> : active ? <PanelBody tab={active} {...props} onCloseTab={() => close(active.id)} /> : null}
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
  const meta = tab.kind === 'file' ? null
    : tab.kind === 'link' ? { label: linkTabLabel(tab.url, tab.title), icon: Globe }
      : tab.kind === 'new' ? { label: 'New tab', icon: Plus } : PANEL_META[tab.kind]
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
    case 'new': return <Home launcherId={tab.id} {...props} />
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
    case 'assignments': return props.assignments
    case 'progress': return <ProgressPanel agentName={props.agentName} />
    case 'changes': return <ChangesPanel pullRequests={props.pullRequests} />
    case 'file': return <div className="flex min-h-0 flex-1 flex-col [&>aside]:border-0">{props.renderFile(tab.fileId, onCloseTab)}</div>
    case 'link': return <LinkPreviewTab key={tab.url} url={tab.url} title={tab.title} onClose={onCloseTab} checkEmbeddable={checkLinkEmbeddable} />
  }
}

const COMPUTER_STATUS: Record<ThreadComputerStatus, { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'bg-green-600 dark:bg-green-400' },
  starting: { label: 'Starting', dot: 'bg-amber-500' },
  asleep: { label: 'Asleep', dot: 'bg-(--muted-light)' },
  unavailable: { label: 'Unavailable', dot: 'bg-(--muted-light)' },
}

/** The panels in the order they are listed: the agent's settings first, then the computer and the thread's panels. */
const PANEL_ORDER: readonly ThreadPanelKind[] = ['agent', 'computer', 'assignments', 'progress', 'changes', 'files']

/**
 * With no tabs open the panel is the agent's home: who it is, and the panels it can open. "+" opens the same view as
 * a new tab, which turns into the panel picked from it.
 */
function Home({ launcherId, ...props }: ThreadPanelProps & { launcherId?: string }) {
  const { hero, onTabsChange } = props
  const open = (kind: ThreadPanelKind) => onTabsChange((current) => (
    launcherId ? replaceLauncher(current, launcherId, kind) : openPanel(current, kind)
  ))
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-col px-5 pb-10 pt-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="flex h-[72px] w-[72px] items-center justify-center">{hero.avatar}</div>
        <h2 aria-label={hero.titleText} className="mt-[14px] max-w-full text-lg font-medium leading-6 text-(--foreground)">{hero.title}</h2>
        {hero.subtitle ? <div className="mt-0.5 max-w-full text-[13px] leading-5 text-(--muted)">{hero.subtitle}</div> : null}
      </div>
      <PanelPicker computerStatus={props.computerStatus} onOpen={open} />
    </div>
  )
}

function PanelPicker({ computerStatus, onOpen }: { computerStatus: ThreadComputerStatus; onOpen(kind: ThreadPanelKind): void }) {
  const status = COMPUTER_STATUS[computerStatus]
  return (
    <div className="flex flex-col">
      {PANEL_ORDER.map((kind) => {
        const { icon: Icon, label, hint } = PANEL_META[kind]
        return (
          <Button key={kind} variant="ghost" type="button" onClick={() => onOpen(kind)}
            className="group/row h-9 justify-start gap-2.5 rounded-lg px-2 text-[13px] font-normal text-(--foreground)">
            <Icon className="size-4 text-(--muted)" strokeWidth={1.75} />
            <span className="truncate">{label}</span>
            {kind === 'computer' ? (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-(--muted)">
                <span className={`size-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
            ) : <span className="ml-auto hidden text-[11px] text-(--muted) group-hover/row:inline">{hint}</span>}
          </Button>
        )
      })}
    </div>
  )
}
