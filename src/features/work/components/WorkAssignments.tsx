'use client'
import { unstyledButton } from '@overlay/ui/control-reset'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, ChevronDown, CircleAlert, CircleDot, CornerDownRight, Hash, RotateCcw } from 'lucide-react'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import { Button } from '@overlay/ui/primitives'
import { assignmentThreadHref } from '@/components/layout/sidebar-nav'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import type { AssignmentExecution } from '@/shared/work/assignment-execution'
import { assignmentWorkState, type AssignmentGlyph } from '@/shared/work/assignment-state'
import { useEscapeToClose } from '../lib/use-work-task'
import { Avatar, StatusIcon, Tag } from './work-ui'

/** The task status glyph, or an alert for a run that failed. */
export function AssignmentGlyphIcon({ glyph, size = 16 }: { glyph: AssignmentGlyph; size?: number }) {
  if (glyph === 'failed') return <CircleAlert size={size} strokeWidth={1.6} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />
  return <StatusIcon status={glyph} size={size} />
}

function agentPerson(item: AssignmentExecution) {
  return { displayName: item.agentName, type: 'agent' as const, isDefault: item.agent.isDefault ?? false, avatarColor: item.agent.avatarColor, avatarShape: item.agent.avatarShape }
}

/** Links to the agent thread behind an assignment or its parent. */
export function useAssignmentThreadHref() {
  const workspaceHref = useWorkspaceHref()
  return (target: Parameters<typeof assignmentThreadHref>[0]) =>
    workspaceHref(null, assignmentThreadHref(target), target.scope)
}

/** One agent assignment in the list, drawn like a task row: glyph, title, tag, where it came from, and the agent. */
export function WorkAssignmentRow({ item, selected, onOpen }: { item: AssignmentExecution; selected: boolean; onOpen: (id: string) => void }) {
  const state = assignmentWorkState(item)
  return (
    <div
      role="row"
      data-testid="work-assignment-row"
      data-assignment-id={item.assignmentId}
      aria-selected={selected}
      onClick={() => onOpen(item.assignmentId)}
      className={`flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6 transition-colors hover:bg-(--surface-muted) ${selected ? 'bg-(--surface-subtle)' : ''}`}
    >
      <AssignmentGlyphIcon glyph={state.glyph} />
      <Button variant="ghost" type="button" className={unstyledButton(`min-w-0 flex-1 truncate text-left text-sm leading-5 ${item.status === 'completed' ? 'text-(--muted)' : 'text-(--foreground)'}`)} title={item.title}>{item.title}</Button>
      <div className="flex shrink-0 items-center gap-3.5 text-[12.5px] text-(--muted)">
        {state.tag ? <Tag tone={state.tag.tone}>{state.tag.text}</Tag> : null}
        <span className="hidden max-w-36 truncate md:inline" title={item.parent.title}>{item.parent.title}</span>
        <Avatar person={agentPerson(item)} title={`${item.agentName} (agent)`} />
      </div>
    </div>
  )
}

/** The Agent assignments group under the task groups. Read-only: the rows are agent runs, not tasks. */
export function WorkAssignmentGroup({ items, selectedId, onOpen, canLoadMore, onLoadMore }: {
  items: AssignmentExecution[]
  selectedId: string | null
  onOpen: (id: string) => void
  canLoadMore: boolean
  onLoadMore: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null
  return (
    <section role="rowgroup" aria-label="Agent assignments" data-testid="work-group-assignments">
      <Button variant="ghost"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className={unstyledButton('flex w-full items-center gap-2.5 px-6 pb-1.5 pt-5 text-left text-[13px] font-medium text-(--foreground)')}
      >
        <ChevronDown size={14} className={`text-(--muted-light) transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden />
        <Bot size={16} strokeWidth={1.6} className="text-(--muted)" aria-hidden />
        <span>Agent assignments</span>
        <span className="font-normal text-(--muted-light)">{items.length}</span>
      </Button>
      {collapsed ? null : items.map((item) => (
        <WorkAssignmentRow key={item.assignmentId} item={item} selected={item.assignmentId === selectedId} onOpen={onOpen} />
      ))}
      {!collapsed && canLoadMore ? (
        <div className="px-6 py-3">
          <Button variant="secondary" size="sm" onClick={onLoadMore}>Show more</Button>
        </div>
      ) : null}
    </section>
  )
}

function PropertyRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex h-[30px] items-center gap-2 text-(--muted)">
        <span className="flex w-3.5 justify-center" aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="flex h-[30px] min-w-0 items-center gap-2 text-(--foreground)">{children}</div>
    </>
  )
}

function PeekSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-(--muted-light)">{title}</h3>
      <div className="text-[13.5px] leading-relaxed text-(--foreground)">{children}</div>
    </section>
  )
}

function PanelMessage({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <AppScreenSidePanel title={<span className="text-(--muted)">Agent assignment</span>} onClose={onClose} closeLabel="Close assignment" data-testid="work-assignment-peek">
      {children}
    </AppScreenSidePanel>
  )
}

/**
 * The assignment panel: a read-only record of one agent run. Status, result and reasons come from the agent threads;
 * the links open them.
 */
export function WorkAssignmentPeek({ assignmentId, items, loading, onClose }: {
  assignmentId: string
  items: readonly AssignmentExecution[]
  loading: boolean
  onClose: () => void
}) {
  const threadHref = useAssignmentThreadHref()
  useEscapeToClose(onClose)
  const item = items.find((candidate) => candidate.assignmentId === assignmentId)

  if (!item && loading) {
    return (
      <PanelMessage onClose={onClose}>
        <div className="px-6 py-10" role="status" aria-label="Loading assignment">
          <div className="ui-skeleton-line mb-4 h-6 w-2/3 rounded-md" />
          <div className="ui-skeleton-line h-3 w-1/2 rounded-md" />
        </div>
      </PanelMessage>
    )
  }
  if (!item) {
    return <PanelMessage onClose={onClose}><div className="px-6 py-10 text-center text-sm text-(--muted)">This assignment is not available. It may belong to a thread you cannot see, or it is further down the list.</div></PanelMessage>
  }

  const state = assignmentWorkState(item)
  return (
    <PanelMessage onClose={onClose}>
      <div className="px-7 pb-10 pt-6">
        <h2 className="mb-3 font-serif text-2xl leading-tight tracking-tight text-(--foreground)">{item.title}</h2>
        <div className="mb-6 grid grid-cols-[92px_minmax(0,1fr)] gap-y-1 text-[13px]" data-testid="work-assignment-properties">
          <PropertyRow icon={<CircleDot size={13} />} label="Status">
            <AssignmentGlyphIcon glyph={state.glyph} size={14} />
            {state.label}
            {item.disposition === 'accepted' ? <span className="text-(--muted)">· Accepted by the Chief</span> : null}
          </PropertyRow>
          <PropertyRow icon={<Bot size={13} />} label="Agent">
            <Avatar person={agentPerson(item)} size={18} />
            {item.agentName}
          </PropertyRow>
          <PropertyRow icon={<CornerDownRight size={13} />} label="Assigned from">
            <Link href={threadHref(item.parent)} className="min-w-0 truncate hover:underline" title={item.parent.title}>{item.parent.title}</Link>
          </PropertyRow>
          <PropertyRow icon={<RotateCcw size={13} />} label="Attempt">
            {`Attempt ${item.attemptOrdinal ?? 1}`}
            {(item.attemptOrdinal ?? 1) > 1 ? <span className="text-(--muted)">· revised in the same thread</span> : null}
          </PropertyRow>
          {item.origin ? (
            <PropertyRow icon={<Hash size={13} />} label="Origin">
              Slack · {item.origin.channelName ? `#${item.origin.channelName.replace(/^#/, '')}` : item.origin.channelId}
            </PropertyRow>
          ) : null}
        </div>
        <PeekSection title="Brief"><p className="whitespace-pre-wrap">{item.brief}</p></PeekSection>
        {state.group === 'review' ? (
          <div className="mb-6 rounded-xl border border-violet-300/70 bg-(--surface-elevated) p-4 dark:border-violet-500/40" data-testid="work-assignment-waiting">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-(--foreground)">
              <StatusIcon status="review" />
              Waiting on you
            </div>
            <p className="text-[13.5px] leading-relaxed text-(--muted)">The agent asked a question or needs an approval. Answer in the assignment thread; the Chief resumes once it replies.</p>
          </div>
        ) : null}
        {item.result?.summary && item.status === 'completed' ? <PeekSection title="Result"><p className="whitespace-pre-wrap">{item.result.summary}</p></PeekSection> : null}
        {item.result?.failureReason ? <PeekSection title="Failure"><p className="whitespace-pre-wrap">{item.result.failureReason}</p></PeekSection> : null}
        {item.disposition === 'excluded' && item.dispositionReason ? <PeekSection title="Excluded by the Chief"><p>{item.dispositionReason}</p></PeekSection> : null}
        <div className="mt-7 flex flex-wrap gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href={threadHref(item)}>Open thread<ArrowUpRight size={13} aria-hidden /></Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={threadHref(item.parent)}>Open Chief thread</Link>
          </Button>
        </div>
        <p className="mt-5 text-[12px] leading-relaxed text-(--muted-light)">Read-only record of an agent run. Status, owner and result come from the agent threads; there is nothing to edit here.</p>
      </div>
    </PanelMessage>
  )
}
