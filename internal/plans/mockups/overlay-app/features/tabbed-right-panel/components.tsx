'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  CircleCheck, CircleDashed, CircleHelp, ExternalLink, FileText, Folder, GitCompare, GitPullRequest, ListChecks,
  Maximize2, Minimize2, Monitor, Plus, Search, SlidersHorizontal, SquareTerminal, X, type LucideIcon,
} from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import { useChatFilesHost } from '@overlay/chat-react'
import {
  closeTab, openTab, replaceTab, selectTab, toggleExpanded, usePanelState, type PanelKind, type PanelTab,
} from './store'

const PRICING_THREAD = 'k17convatlastable000000000000000'

const KINDS: Record<Exclude<PanelKind, 'file'>, { label: string; icon: LucideIcon; hint?: string; shortcut?: string }> = {
  new: { label: 'New tab', icon: Search },
  progress: { label: 'Progress', icon: ListChecks, hint: 'Plan and activity' },
  computer: { label: 'Computer', icon: Monitor, hint: 'Watch or take control' },
  changes: { label: 'Changes', icon: GitCompare, hint: 'Diff and pull request' },
  files: { label: 'Files', icon: Folder, hint: 'What this thread made', shortcut: '⌘ P' },
  terminal: { label: 'Terminal', icon: SquareTerminal, hint: 'Commands it ran', shortcut: '⌘ J' },
  agent: { label: 'Agent', icon: SlidersHorizontal, hint: 'Model, instructions, tools' },
}

export type WorkspacePanelProps = {
  conversationId: string
  agentName: string
  hero: { avatar: ReactNode; title: ReactNode; titleText: string; subtitle?: ReactNode }
  /** The agent's avatar at launcher size; read-only, unlike the hero's avatar picker. */
  avatar: ReactNode
  agent: ReactNode
  files: ReactNode
  computer: ReactNode
  previewFileId: string | null
  onPreviewFileChange(fileId: string | null): void
  renderFile(fileId: string, close: () => void): ReactNode
  onClose(): void
}

/** One docked panel for everything beside the thread: each surface opens as a tab, and "+" opens a launcher. */
export function WorkspacePanel(props: WorkspacePanelProps) {
  const { tabs, active, expanded } = usePanelState()
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0]

  // A file opened from the transcript or Files becomes its own tab instead of replacing the panel.
  useEffect(() => {
    if (!props.previewFileId) return
    openTab('file', props.previewFileId)
    props.onPreviewFileChange(null)
  }, [props.previewFileId, props])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (event.altKey && event.code === 'KeyT') openTab('new')
      else if (mod && event.key.toLowerCase() === 'j') openTab('terminal')
      else if (mod && event.key.toLowerCase() === 'p') openTab('files')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <aside data-slot="right-sidebar" aria-label="Thread panel"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-(--sidebar-surface)">
      <div className="flex h-[50px] shrink-0 items-center gap-1 border-b border-(--border) pl-2 pr-1.5">
        <div role="tablist" aria-label="Open panels"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((tab) => (
            <PanelTabButton key={tab.id} tab={tab} active={tab.id === activeTab?.id} compact={tabs.length > 3 && tab.id !== activeTab?.id} agentName={props.agentName} />
          ))}
          <Button variant="ghost" size="icon-xs" type="button" aria-label="New tab" title="New tab  ⌥T"
            onClick={() => openTab('new')} className="ml-0.5 shrink-0 text-(--muted)">
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" size="icon-xs" type="button" aria-label={expanded ? 'Restore panel' : 'Expand panel'}
          onClick={toggleExpanded} className="shrink-0 text-(--muted)">
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button variant="ghost" size="icon-xs" type="button" aria-label="Close panel" onClick={props.onClose}
          className="shrink-0 text-(--muted)">
          <X />
        </Button>
      </div>
      <div role="tabpanel" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {activeTab ? <PanelBody tab={activeTab} {...props} /> : null}
      </div>
    </aside>
  )
}

function PanelTabButton({ tab, active, compact, agentName }: { tab: PanelTab; active: boolean; compact: boolean; agentName: string }) {
  const kind = tab.kind === 'file' ? null : KINDS[tab.kind]
  const Icon = kind?.icon ?? FileText
  const label = tab.kind === 'file' && tab.fileId ? <FileTabLabel fileId={tab.fileId} /> : tab.kind === 'agent' ? agentName : kind?.label
  return (
    <div className={`group/tab relative flex h-7 min-w-0 max-w-[160px] shrink-0 items-center rounded-md ${
      active ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted) hover:bg-(--surface-subtle)/60 hover:text-(--foreground)'
    }`}>
      <Button variant="ghost" size="xs" type="button" role="tab" aria-selected={active} onClick={() => selectTab(tab.id)}
        title={compact && tab.kind !== 'file' ? (tab.kind === 'agent' ? agentName : kind?.label) : undefined}
        className={`h-7 min-w-0 max-w-full justify-start gap-1.5 bg-transparent ${compact ? 'px-2' : active ? 'pl-2 pr-7' : 'px-2.5'} text-[12px] font-normal text-inherit hover:bg-transparent hover:text-inherit`}>
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {compact ? null : <span className="truncate">{label}</span>}
      </Button>
      <Button variant="ghost" size="icon-xs" type="button" aria-label="Close tab" onClick={() => closeTab(tab.id)}
        className={`absolute right-1 size-5 rounded text-(--muted) hover:bg-(--surface-elevated) hover:text-(--foreground) [&_svg]:size-3 ${
          active ? 'opacity-100' : 'hidden'
        }`}>
        <X />
      </Button>
    </div>
  )
}

function FileTabLabel({ fileId }: { fileId: string }) {
  const { useFileSummaries } = useChatFilesHost()
  return <>{useFileSummaries([fileId])?.get(fileId)?.name ?? 'File'}</>
}

function PanelBody({ tab, ...props }: WorkspacePanelProps & { tab: PanelTab }) {
  switch (tab.kind) {
    case 'new': return <Launcher tabId={tab.id} {...props} />
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
    case 'computer': return props.conversationId === PRICING_THREAD
      ? <ComputerPanel agentName={props.agentName} />
      : <div className="flex flex-1 flex-col px-5 pb-6 pt-4">{props.computer}</div>
    case 'progress': return <ProgressPanel conversationId={props.conversationId} agentName={props.agentName} />
    case 'changes': return <ChangesPanel conversationId={props.conversationId} />
    case 'terminal': return <TerminalPanel conversationId={props.conversationId} agentName={props.agentName} />
    case 'file': return tab.fileId ? <div className="flex min-h-0 flex-1 flex-col [&>aside]:border-0">{props.renderFile(tab.fileId, () => closeTab(tab.id))}</div> : null
  }
}

function Launcher({ tabId, conversationId, agentName, avatar }: WorkspacePanelProps & { tabId: string }) {
  const [query, setQuery] = useState('')
  const rows = (['progress', 'changes', 'files', 'terminal', 'agent'] as const)
    .filter((kind) => `${KINDS[kind].label} ${KINDS[kind].hint}`.toLowerCase().includes(query.trim().toLowerCase()))
  const showComputer = 'computer watch take control'.includes(query.trim().toLowerCase())
  const live = conversationId === PRICING_THREAD
  return (
    <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col justify-center px-5 py-10">
      <div className="mb-6 flex flex-col items-center gap-2.5">
        {avatar}
        <span className="text-[15px] font-medium text-(--foreground)">{agentName}</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-(--muted)" />
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files, changes and tools"
          className="h-9 rounded-lg border-(--border) bg-(--surface-subtle) pl-8 pr-12 text-[13px] focus-visible:border-(--muted-light) focus-visible:ring-0" />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-[11px] text-(--muted-light)">⌥ T</kbd>
      </div>
      {showComputer ? (
        <Button variant="ghost" type="button" onClick={() => replaceTab(tabId, 'computer')}
          className="mt-3 flex h-auto w-full flex-col items-stretch gap-2.5 rounded-xl bg-(--surface-subtle)/50 p-2 pb-2.5 text-left font-normal hover:bg-(--surface-subtle)">
          <ComputerThumb live={live} />
          <span className="flex items-center gap-2 px-1 text-[13px] text-(--foreground)">
            <Monitor className="size-4 text-(--muted)" strokeWidth={1.75} />
            Computer
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-(--muted)">
              <span className={`size-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-(--muted-light)'}`} />
              {live ? 'Running' : 'Asleep'}
            </span>
          </span>
        </Button>
      ) : null}
      <div className="mt-2 flex flex-col">
        {rows.map((kind) => {
          const { icon: Icon, label, hint, shortcut } = KINDS[kind]
          return (
            <Button key={kind} variant="ghost" type="button" onClick={() => replaceTab(tabId, kind)}
              className="group/row h-9 justify-start gap-2.5 rounded-lg px-2 text-[13px] font-normal text-(--foreground)">
              <Icon className="size-4 text-(--muted)" strokeWidth={1.75} />
              {kind === 'agent' ? agentName : label}
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

/** A still of the thread's computer, drawn small; the Computer tab shows the live screen. */
function ComputerThumb({ live }: { live: boolean }) {
  return (
    <span className={`relative block aspect-[16/9] w-full overflow-hidden rounded-lg border border-(--border) bg-(--surface-elevated) ${live ? '' : 'opacity-60'}`}>
      <span className="absolute inset-x-[8%] top-[12%] bottom-[10%] rounded-md border border-(--border) bg-(--sidebar-surface)">
        <span className="flex h-[14%] items-center gap-[3px] border-b border-(--border) px-[4%]">
          <span className="size-[5px] rounded-full bg-(--muted-light)/60" />
          <span className="size-[5px] rounded-full bg-(--muted-light)/60" />
          <span className="size-[5px] rounded-full bg-(--muted-light)/60" />
          <span className="ml-[6%] h-[40%] w-[40%] rounded-sm bg-(--surface-subtle)" />
        </span>
        <span className="absolute left-[5%] top-[24%] grid w-[52%] grid-cols-3 gap-[4%]">
          {[0, 1, 2].map((column) => (
            <span key={column} className="flex flex-col gap-[3px] rounded-[3px] border border-(--border) p-[6%]">
              <span className="h-[3px] w-2/3 rounded-full bg-(--muted-light)/50" />
              <span className="h-[3px] w-1/2 rounded-full bg-(--muted-light)/30" />
              <span className="h-[3px] w-3/4 rounded-full bg-(--muted-light)/30" />
              <span className={`mt-[3px] h-[5px] rounded-sm ${column === 1 ? 'bg-(--foreground)/70' : 'bg-(--surface-subtle)'}`} />
            </span>
          ))}
        </span>
        <span className="absolute bottom-[8%] right-[5%] top-[24%] flex w-[34%] flex-col gap-[4px] rounded-[3px] bg-(--surface-subtle) p-[3%]">
          <span className="h-[3px] w-3/4 rounded-full bg-emerald-500/60" />
          <span className="h-[3px] w-1/2 rounded-full bg-(--muted-light)/50" />
          <span className="h-[3px] w-2/3 rounded-full bg-(--muted-light)/50" />
          <span className="h-[3px] w-1/3 rounded-full bg-(--muted-light)/50" />
        </span>
      </span>
    </span>
  )
}

function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h3 className="text-[12px] font-medium text-(--muted)">{children}</h3>
      {meta ? <span className="text-[11px] text-(--muted-light)">{meta}</span> : null}
    </div>
  )
}

function EmptyPanel({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <Icon className="size-5 text-(--muted)" strokeWidth={1.75} />
      <p className="text-[13px] font-medium text-(--foreground)">{title}</p>
      <p className="text-[12px] leading-5 text-(--muted)">{body}</p>
    </div>
  )
}

const PLAN = [
  { state: 'done', text: 'Reproduce the overflow at 375px', meta: '' },
  { state: 'done', text: 'Let the table scroll inside its card below 640px', meta: '' },
  { state: 'done', text: 'Run the pricing table tests', meta: '12 passed' },
  { state: 'done', text: 'Open a pull request', meta: '#482' },
  { state: 'ask', text: 'Collapse the comparison into an accordion below 480px?', meta: 'Needs you' },
] as const

const ACTIVITY = [
  { time: '3:10', text: 'Opened localhost:3000/pricing at 375px', detail: '' },
  { time: '3:12', text: 'Edited src/components/PricingTable.tsx', detail: 'diff' },
  { time: '3:14', text: 'Ran npm test -- pricing-table', detail: 'exit 0' },
  { time: '3:18', text: 'Opened pull request #482', detail: '' },
  { time: '3:18', text: 'Asked you a question', detail: '' },
]

function ProgressPanel({ conversationId, agentName }: { conversationId: string; agentName: string }) {
  if (conversationId !== PRICING_THREAD) {
    return <EmptyPanel icon={ListChecks} title="No plan yet" body={`${agentName} writes its plan here once it starts working.`} />
  }
  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
      <section>
        <SectionTitle meta="4 of 5">Plan</SectionTitle>
        <ol className="flex flex-col">
          {PLAN.map((step) => {
            const Icon = step.state === 'done' ? CircleCheck : step.state === 'ask' ? CircleHelp : CircleDashed
            return (
              <li key={step.text} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
                <Icon strokeWidth={1.75} className={`mt-[1px] size-4 shrink-0 ${step.state === 'ask' ? 'text-amber-400' : 'text-(--muted)'}`} />
                <span className={`flex-1 text-[13px] leading-5 ${step.state === 'done' ? 'text-(--muted)' : 'text-(--foreground)'}`}>{step.text}</span>
                {step.meta ? (
                  <span className={`shrink-0 text-[11px] leading-5 ${step.state === 'ask' ? 'text-amber-400' : 'text-(--muted-light)'}`}>{step.meta}</span>
                ) : null}
              </li>
            )
          })}
        </ol>
      </section>
      <section>
        <SectionTitle meta="Worked for 8m">Activity</SectionTitle>
        <ol className="relative ml-[9px] flex flex-col border-l border-(--border)">
          {ACTIVITY.map((row, index) => (
            <li key={index} className="relative flex items-baseline gap-3 py-1.5 pl-4">
              <span className="absolute -left-[3px] top-[13px] size-[5px] rounded-full bg-(--muted-light)" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-(--foreground)">{row.text}</span>
              {row.detail === 'diff' ? (
                <span className="shrink-0 text-[11px] tabular-nums"><span className="text-emerald-500">+24</span> <span className="text-red-500">−9</span></span>
              ) : row.detail ? <span className="shrink-0 text-[11px] text-(--muted-light)">{row.detail}</span> : null}
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-(--muted-light)">{row.time}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

const DIFF: Array<[' ' | '+' | '-', string]> = [
  [' ', 'export function PricingTable({ plans }: Props) {'],
  [' ', '  return ('],
  ['-', '    <div className="grid grid-cols-4 gap-6">'],
  ['+', '    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">'],
  ['+', '      <div className="grid min-w-[640px] grid-cols-4 gap-6">'],
  [' ', '        {plans.map((plan) => ('],
  ['-', '          <PlanCard key={plan.id} plan={plan} />'],
  ['+', '          <PlanCard key={plan.id} plan={plan} className="snap-start" />'],
  [' ', '        ))}'],
  ['+', '      </div>'],
  [' ', '    </div>'],
  [' ', '  )'],
]

function ChangesPanel({ conversationId }: { conversationId: string }) {
  if (conversationId !== PRICING_THREAD) {
    return <EmptyPanel icon={GitCompare} title="No changes" body="Edits and pull requests from this thread show up here." />
  }
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-4">
      <div className="flex items-start gap-2.5 rounded-xl border border-(--border) p-3">
        <GitPullRequest className="mt-0.5 size-4 shrink-0 text-emerald-500" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-(--foreground)">Fix pricing table overflow on small screens</p>
          <p className="mt-0.5 text-[12px] text-(--muted)">northwind/web #482 · Open · Checks passed</p>
        </div>
        <Button variant="ghost" size="icon-xs" type="button" aria-label="Open on GitHub" className="text-(--muted)">
          <ExternalLink />
        </Button>
      </div>
      <section>
        <SectionTitle meta={<><span className="text-emerald-500">+24</span> <span className="text-red-500">−9</span></>}>1 file changed</SectionTitle>
        <div className="overflow-hidden rounded-xl border border-(--border)">
          <div className="flex items-center gap-2 border-b border-(--border) px-3 py-2 text-[12px]">
            <FileText className="size-3.5 text-(--muted)" strokeWidth={1.75} />
            <span className="truncate text-(--foreground)">src/components/PricingTable.tsx</span>
          </div>
          <pre className="overflow-x-auto py-1.5 font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[11.5px] leading-[19px]">
            {DIFF.map(([sign, line], index) => (
              <div key={index} className={`flex w-max min-w-full pr-3 ${sign === '+' ? 'bg-emerald-500/10' : sign === '-' ? 'bg-red-500/10' : ''}`}>
                <span className={`w-7 shrink-0 select-none text-center ${sign === '+' ? 'text-emerald-500' : sign === '-' ? 'text-red-500' : 'text-(--muted-light)'}`}>{sign}</span>
                <span className="whitespace-pre text-(--foreground)/90">{line}</span>
              </div>
            ))}
          </pre>
        </div>
      </section>
    </div>
  )
}

const TERMINAL = [
  { prompt: true, text: 'npm test -- pricing-table' },
  { prompt: false, text: '> vitest run pricing-table' },
  { prompt: false, text: ' ✓ PricingTable renders every plan (4)' },
  { prompt: false, text: ' ✓ PricingTable scrolls below 640px (5)' },
  { prompt: false, text: ' ✓ PricingTable keeps the selected plan visible (3)' },
  { prompt: false, text: ' Tests  12 passed (12)' },
  { prompt: true, text: 'gh pr create --fill' },
  { prompt: false, text: 'https://github.com/northwind/web/pull/482' },
]

function TerminalPanel({ conversationId, agentName }: { conversationId: string; agentName: string }) {
  if (conversationId !== PRICING_THREAD) {
    return <EmptyPanel icon={SquareTerminal} title="No commands yet" body={`Commands ${agentName} runs on its computer appear here.`} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-(--border) bg-(--surface-subtle)/40">
        <div className="flex items-center gap-2 border-b border-(--border) px-3 py-2 text-[11px] text-(--muted)">
          <SquareTerminal className="size-3.5" strokeWidth={1.75} />
          {agentName.toLowerCase()}@overlay-cloud: ~/web
        </div>
        <pre className="flex-1 overflow-auto p-3 font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[11.5px] leading-[19px] text-(--foreground)/90">
          {TERMINAL.map((line, index) => (
            <div key={index} className={line.prompt && index > 0 ? 'mt-3' : ''}>
              {line.prompt ? <span className="text-emerald-500">$ </span> : null}
              <span className={line.prompt ? '' : line.text.includes('✓') || line.text.includes('passed') ? 'text-(--foreground)/80' : 'text-(--muted)'}>{line.text}</span>
            </div>
          ))}
          <div className="mt-3"><span className="text-emerald-500">$ </span><span className="inline-block h-3.5 w-[7px] translate-y-[2px] animate-pulse bg-(--muted)" /></div>
        </pre>
      </div>
      <p className="px-1 pt-2 text-[11px] text-(--muted-light)">Take control of the computer to type here.</p>
    </div>
  )
}

/** The thread's computer as the agent sees it; in production this is the existing live stream and control flow. */
function ComputerPanel({ agentName }: { agentName: string }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 px-1">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="text-[12px] text-(--foreground)">Overlay Cloud</span>
        <span className="text-[12px] text-(--muted)">· {agentName} is using it</span>
        <Button variant="outline" size="xs" type="button" className="ml-auto text-[12px]">Take control</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)">
        <div className="flex h-8 items-center gap-2 border-b border-(--border) px-3">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-(--muted-light)/50" />
            <span className="size-2 rounded-full bg-(--muted-light)/50" />
            <span className="size-2 rounded-full bg-(--muted-light)/50" />
          </span>
          <span className="mx-auto flex h-5 w-1/2 items-center justify-center rounded bg-(--surface-subtle) text-[10.5px] text-(--muted)">localhost:3000/pricing</span>
        </div>
        <div className="flex aspect-[16/10] min-w-0 items-stretch gap-4 bg-(--sidebar-surface) p-4">
          <div className="flex aspect-[9/17] h-full shrink-0 flex-col gap-2 overflow-hidden rounded-[14px] border border-(--border) bg-(--surface-subtle)/40 p-2.5">
            <span className="mx-auto h-1 w-8 rounded-full bg-(--muted-light)/40" />
            <span className="mt-1 h-2 w-2/3 rounded-full bg-(--foreground)/60" />
            <span className="h-1.5 w-1/2 rounded-full bg-(--muted-light)/40" />
            <div className="mt-1 flex flex-1 gap-1.5 overflow-hidden">
              {['Free', 'Pro', 'Team'].map((plan, index) => (
                <div key={plan} className={`flex w-[78%] min-w-[78%] flex-col gap-1 rounded-md border p-1.5 ${index === 1 ? 'border-(--muted-light)' : 'border-(--border)'}`}>
                  <span className="text-[8px] text-(--foreground)">{plan}</span>
                  <span className="h-1.5 w-1/2 rounded-full bg-(--foreground)/50" />
                  <span className="h-1 w-3/4 rounded-full bg-(--muted-light)/30" />
                  <span className="h-1 w-2/3 rounded-full bg-(--muted-light)/30" />
                  <span className="h-1 w-3/4 rounded-full bg-(--muted-light)/30" />
                  <span className={`mt-auto h-2.5 rounded-sm ${index === 1 ? 'bg-(--foreground)/70' : 'bg-(--surface-subtle)'}`} />
                </div>
              ))}
            </div>
            <span className="text-center text-[8px] text-(--muted)">375 × 812</span>
          </div>
          <div className="flex h-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-md bg-(--surface-subtle)/50 p-2 font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[8.5px] leading-[13px] text-(--muted)">
            <span className="text-(--foreground)/80">Elements  Console  Network</span>
            <span>{'<div class="-mx-4 overflow-x-auto">'}</span>
            <span className="pl-2">{'<div class="grid min-w-[640px]">'}</span>
            <span className="pl-4">&lt;PlanCard /&gt; ×3</span>
            <span className="mt-auto text-emerald-500">No horizontal page overflow</span>
          </div>
        </div>
      </div>
      <p className="px-1 text-[11px] text-(--muted-light)">Live view · {agentName} is checking the fix at phone width</p>
    </div>
  )
}
