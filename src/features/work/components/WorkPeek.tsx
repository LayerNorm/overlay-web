'use client'
import { unstyledInput } from '@overlay/ui/control-reset'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, CalendarDays, Check, CircleDot, CornerDownRight, Flag, LoaderCircle, MessageSquare, Undo2, User, UserCheck } from 'lucide-react'
import Link from 'next/link'
import { AppScreenSidePanel, AppScreenSidePanelActions, AppScreenSidePanelClose, AppScreenSidePanelHeader } from '@overlay/modules-react/shell'
import { Button, Toggle, Input } from '@overlay/ui/primitives'
import { type UpdateWorkItemRequest, type WorkItem, type WorkPerson } from '@overlay/app-core'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { validateWorkDates, validateWorkTitle } from '@/shared/work/status'
import { useEscapeToClose, useScopeFollowsTask, useWorkTask } from '../lib/use-work-task'
import { useLiveWorkThread } from '../lib/use-live-work'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { formatAgo } from '@/shared/work/activity'
import { useOnboardingWorkReady } from '@/components/providers/OnboardingWorkHandoff'
import { eligibleParents } from '../lib/work-state'
import { ContextSection, DoneWhenSection, ObjectiveSection, ActivitySection, Section, WaitingOnSection } from './WorkPeekSections'
import { useWorkData } from './WorkDataProvider'
import { OwnerPicker, ParentPicker, PriorityPicker, ReviewerPicker, StatusPicker } from './WorkPickers'
import { Avatar, StatusIcon, Tag } from './work-ui'
import { WORK_STATUS_LABELS } from '@/shared/work/status'

function PropertyRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex h-[30px] items-center gap-2 text-(--muted)">
        <span className="flex w-3.5 justify-center" aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="flex h-[30px] min-w-0 items-center text-(--foreground) [&>button]:-ml-2">{children}</div>
    </>
  )
}

function DateField({ label, value, disabled, onChange }: { label: string; value: string | null; disabled: boolean; onChange: (value: string | null) => void }) {
  return (
    <Input
      type="date"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
      className={unstyledInput(`h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-(--foreground) outline-none transition-colors [color-scheme:light] hover:bg-(--surface-subtle) focus:border-(--muted-light) disabled:cursor-default disabled:hover:bg-transparent dark:[color-scheme:dark]`)}
    />
  )
}

/** The reviewer's two choices when a task is waiting on them. */
function ReviewCard({ item, disabled, onApprove, onRequestChanges }: { item: WorkItem; disabled: boolean; onApprove: () => void; onRequestChanges: () => void }) {
  return (
    <div className="mb-6 rounded-xl border border-violet-300/70 bg-(--surface-elevated) p-4 dark:border-violet-500/40" data-testid="work-review-card">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-(--foreground)">
        <StatusIcon status="review" />
        Waiting for your review
      </div>
      <p className="mb-3 text-[13.5px] leading-relaxed text-(--muted)">
        “{item.title}” is ready. Approve it to mark it done, or send it back to keep working.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={onApprove}>Approve</Button>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onRequestChanges}>Request changes</Button>
      </div>
    </div>
  )
}

/** The title is the panel header, edited in place; it saves when the field is left. */
function PeekTitle({ item, editable, onSave }: { item: WorkItem; editable: boolean; onSave: (title: string) => void }) {
  // The title being typed; null means "show the saved one".
  const [draft, setDraft] = useState<string | null>(null)
  const title = draft ?? item.title
  return (
    <Input
      value={title}
      aria-label="Title"
      title={item.title}
      disabled={!editable}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = title.trim()
        setDraft(null)
        if (!validateWorkTitle(next) && next !== item.title) onSave(next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); event.currentTarget.blur() }
      }}
      className={unstyledInput(`h-8 min-w-0 flex-1 truncate rounded-lg bg-transparent px-1.5 text-[15px] font-semibold tracking-tight text-(--foreground) outline-none transition-colors hover:bg-(--surface-subtle) focus:bg-(--surface-subtle) disabled:opacity-100 disabled:hover:bg-transparent`)}
    />
  )
}

/** The agent thread doing the task: its title, whether its turn is still going, and a link into it. */
function LinkedThreadRow({ item, assignee }: { item: WorkItem; assignee: WorkPerson | null }) {
  const linked = useLiveWorkThread(item.id, assignee?.type === 'agent' || Boolean(item.assignmentExecution))
  const { activeWorkspaceId } = useWorkspace()
  const buildWorkspaceHref = useWorkspaceHref()
  // "Finished · 3m" is read when the panel opens, like the activity times below it.
  const [now] = useState(() => Date.now())
  if (assignee?.type !== 'agent' && !linked) return null
  let content: ReactNode
  if (linked === undefined) content = <span className="ui-skeleton-line h-3 w-40 rounded-md" aria-label="Loading thread" />
  else if (!linked) content = <span className="text-(--muted-light)">{item.blockedBy.length ? 'Starts when dependencies finish' : 'Starts when the agent picks it up'}</span>
  else if (!linked.visible) content = <span className="text-(--muted)">In the assigner’s thread</span>
  else {
    const view = assignee?.agentVisibility === 'creator' ? 'personal' : 'workspace'
    const href = agentThreadHref(activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents', view) : '/app/agents', linked.agentId, linked.conversationId, view)
    content = (
      <Link href={href} className="-ml-2 flex h-7 min-w-0 max-w-full items-center gap-2 rounded-lg px-2 text-(--foreground) transition-colors hover:bg-(--surface-subtle)" data-testid="work-linked-thread">
        <span className="min-w-0 truncate">{linked.title}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-(--muted)">
          {linked.state === 'working' ? <><LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" aria-hidden />Working</> : null}
          {linked.state === 'finished' ? <><Check size={12} aria-hidden />Finished · {formatAgo(linked.updatedAt, now)}</> : null}
          {linked.state === 'stopped' ? 'Stopped' : null}
        </span>
        <ArrowUpRight size={14} className="shrink-0 text-(--muted-light)" aria-hidden />
      </Link>
    )
  }
  return <PropertyRow icon={<MessageSquare size={13} />} label="Thread">{content}</PropertyRow>
}

/** Status, owner, reviewer, priority, dates, parent, and the blocked flag. */
function PeekProperties({ item, editable, save }: { item: WorkItem; editable: boolean; save: (patch: UpdateWorkItemRequest) => void }) {
  const { items, byId, people, personByPrincipal, viewer } = useWorkData()
  const [dateError, setDateError] = useState<string | null>(null)
  const parent = item.parentId ? byId.get(item.parentId) ?? null : null
  const assignee: WorkPerson | null = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null
  const reviewer = item.reviewerUserId ? people.find((person) => person.userId === item.reviewerUserId) ?? null : null
  const parentOptions = useMemo(() => eligibleParents(item, items).map((other) => ({ id: other.id, title: other.title })), [item, items])
  const saveDates = (startDate: string | null, dueDate: string | null) => {
    const problem = validateWorkDates(startDate, dueDate)
    setDateError(problem)
    if (!problem) save({ startDate, dueDate })
  }
  return (
    <div className="mb-6 grid grid-cols-[92px_minmax(0,1fr)] gap-y-1 text-[13px]" data-testid="work-properties">
      <PropertyRow icon={<CircleDot size={13} />} label="Status">
        <StatusPicker status={item.status} disabled={!editable} onChange={(status) => save({ status })} className="flex h-[30px] items-center gap-2 px-2">
          <StatusIcon status={item.status} />
          {WORK_STATUS_LABELS[item.status]}
          {item.blocked ? <Tag tone="danger">Blocked</Tag> : null}
        </StatusPicker>
      </PropertyRow>
      <PropertyRow icon={<User size={13} />} label="Owner">
        <OwnerPicker
          assignee={assignee}
          people={people}
          myPrincipalId={viewer?.principalId ?? null}
          scope={item.scope}
          disabled={!editable}
          onChange={(assigneePrincipalId) => save({ assigneePrincipalId })}
          className="flex h-[30px] items-center gap-2 px-2"
        >
          <Avatar person={assignee} size={22} />
          <span className={assignee ? '' : 'text-(--muted-light)'}>{assignee?.displayName ?? 'Assign a person or agent'}</span>
        </OwnerPicker>
      </PropertyRow>
      <LinkedThreadRow item={item} assignee={assignee} />
      <PropertyRow icon={<UserCheck size={13} />} label="Reviewer">
        <ReviewerPicker
          reviewer={reviewer}
          people={people}
          myUserId={viewer?.userId ?? null}
          personalOnly={item.scope === 'personal'}
          disabled={!editable}
          onChange={(reviewerUserId) => save({ reviewerUserId })}
        />
      </PropertyRow>
      <PropertyRow icon={<Flag size={13} />} label="Priority">
        <PriorityPicker priority={item.priority} disabled={!editable} onChange={(priority) => save({ priority })} />
      </PropertyRow>
      <PropertyRow icon={<CalendarDays size={13} />} label="Dates">
        <div className="flex items-center gap-1">
          <DateField label="Start date" value={item.startDate} disabled={!editable} onChange={(value) => saveDates(value, item.dueDate)} />
          <span className="text-(--muted-light)">to</span>
          <DateField label="Due date" value={item.dueDate} disabled={!editable} onChange={(value) => saveDates(item.startDate, value)} />
        </div>
      </PropertyRow>
      {dateError ? <><span /><p role="alert" className="pb-1 text-xs text-red-600 dark:text-red-400">{dateError}</p></> : null}
      <PropertyRow icon={<CornerDownRight size={13} />} label="Inside">
        <ParentPicker parentTitle={parent?.title ?? null} options={parentOptions} disabled={!editable} onChange={(parentId) => save({ parentId })} />
      </PropertyRow>
      <PropertyRow icon={<AlertTriangle size={13} />} label="Blocked">
        <div className="flex items-center gap-2">
          <Toggle checked={item.blocked} disabled={!editable} aria-label="Blocked" onCheckedChange={(blocked) => save({ blocked })} className="h-5 w-9 [&>span]:h-3.5 [&>span]:w-3.5 [&>span]:translate-x-[3px] aria-checked:[&>span]:translate-x-[18px]" />
          <span className="text-xs text-(--muted-light)">{item.blocked ? 'Waiting on something' : ''}</span>
        </div>
      </PropertyRow>
    </div>
  )
}

function PanelMessage({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <AppScreenSidePanel title={title} onClose={onClose} closeLabel="Close task" data-testid="work-peek">
      {children}
    </AppScreenSidePanel>
  )
}

/**
 * The task panel: everything about one task. A person edits it in place; each change saves at once. A task that is
 * archived is read-only, with Restore.
 */
export function WorkPeek({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { item, missing } = useWorkTask(taskId)
  const { viewer, canWork, updateTask, moveTask } = useWorkData()
  const scopeMatches = useScopeFollowsTask(item)
  const handoffContent = useOnboardingWorkReady(taskId, scopeMatches && (Boolean(item) || missing))
  useEscapeToClose(onClose)

  if (missing) {
    return <PanelMessage title="Task" onClose={onClose}><div ref={handoffContent} className="px-6 py-10 text-center text-sm text-(--muted)">This task is not available. It may have been deleted, or it belongs to someone else.</div></PanelMessage>
  }
  if (!item) {
    return (
      <PanelMessage title="Task" onClose={onClose}>
        <div className="px-6 py-10" role="status" aria-label="Loading task">
          <div className="ui-skeleton-line mb-4 h-6 w-2/3 rounded-md" />
          <div className="ui-skeleton-line h-3 w-1/2 rounded-md" />
        </div>
      </PanelMessage>
    )
  }
  if (!scopeMatches) {
    return (
      <PanelMessage title="Task" onClose={onClose}>
        <div className="px-6 py-10" role="status" aria-label="Loading task">
          <div className="ui-skeleton-line mb-4 h-6 w-2/3 rounded-md" />
          <div className="ui-skeleton-line h-3 w-1/2 rounded-md" />
        </div>
      </PanelMessage>
    )
  }

  const archived = item.archivedAt !== null
  const editable = !archived && canWork(item)
  const save = (patch: UpdateWorkItemRequest) => void updateTask(item.id, patch)
  // A named reviewer can answer a review even where they cannot edit the task.
  const needsMyReview = !archived && item.status === 'review' && viewer !== null && (item.reviewerUserId ?? item.createdBy) === viewer.userId && (editable || item.reviewerUserId === viewer.userId)
  const scopedItem = { _id: item.id, userId: item.createdBy, scope: item.scope, archivedAt: item.archivedAt ?? undefined, archivedFromScope: item.archivedFromScope ?? undefined }

  return (
    <AppScreenSidePanel
      data-testid="work-peek"
      header={(
        <AppScreenSidePanelHeader className="gap-1 pl-5.5">
          <PeekTitle item={item} editable={editable} onSave={(title) => save({ title })} />
          <AppScreenSidePanelActions className="gap-0.5">
            <ScopeItemActions
              kind="content"
              resource="work"
              item={scopedItem}
              variant="header"
              label={item.title}
              onChanged={(change) => {
                // The live lists drop an archived task and its subtasks by themselves.
                if (change.action === 'archive') onClose()
              }}
            />
            <AppScreenSidePanelClose label="Close task" onClose={onClose} />
          </AppScreenSidePanelActions>
        </AppScreenSidePanelHeader>
      )}
    >
      <div ref={handoffContent} className="px-7 pb-10 pt-2">
        {archived ? (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2 text-[13px] text-(--muted)" data-testid="work-archived-note">
            <Undo2 size={14} aria-hidden />
            Archived. Restore it to edit.
          </div>
        ) : null}
        <PeekProperties item={item} editable={editable} save={save} />
        {needsMyReview ? (
          <ReviewCard item={item} disabled={false} onApprove={() => save({ status: 'done' })} onRequestChanges={() => void moveTask(item.id, { status: 'progress' })} />
        ) : null}
        <Section title="Objective" hint="The outcome, not the steps">
          <ObjectiveSection value={item.description} editable={editable} onSave={(description) => save({ description })} />
        </Section>
        <WaitingOnSection item={item} editable={editable} onChange={(blockedBy) => save({ blockedBy })} />
        <ContextSection items={item.context} editable={editable} onChange={(context) => save({ context })} />
        <DoneWhenSection items={item.doneWhen} editable={editable} onChange={(doneWhen) => save({ doneWhen })} />
        <ActivitySection taskId={item.id} canComment={!archived && canWork(item)} />
      </div>
    </AppScreenSidePanel>
  )
}
