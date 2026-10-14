'use client'

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarDays, CircleDot, CornerDownRight, Flag, Undo2, User, UserCheck } from 'lucide-react'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import { Button, Toggle } from '@overlay/ui/primitives'
import { WORK_UPDATED_EVENT, type UpdateWorkItemRequest, type WorkItem, type WorkPerson } from '@overlay/app-core'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { validateWorkDates, validateWorkTitle } from '@/shared/work/status'
import { useEscapeToClose, useScopeFollowsTask, useWorkTask } from '../lib/use-work-task'
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
    <input
      type="date"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-(--foreground) outline-none transition-colors [color-scheme:light] hover:bg-(--surface-subtle) focus:border-(--muted-light) disabled:cursor-default disabled:hover:bg-transparent dark:[color-scheme:dark]"
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

/** The title, edited in place: it wraps rather than scrolls, and saves when the field is left. */
function PeekTitle({ item, editable, onSave }: { item: WorkItem; editable: boolean; onSave: (title: string) => void }) {
  // The title being typed; null means "show the saved one".
  const [draft, setDraft] = useState<string | null>(null)
  const title = draft ?? item.title
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!field.current) return
    field.current.style.height = 'auto'
    field.current.style.height = `${field.current.scrollHeight}px`
  }, [title, item.id])
  return (
    <textarea
      ref={field}
      value={title}
      rows={1}
      aria-label="Title"
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
      className="mb-4 block w-full resize-none overflow-hidden bg-transparent font-serif text-2xl leading-tight tracking-tight text-(--foreground) outline-none disabled:opacity-100"
    />
  )
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
          personalOnly={item.scope === 'personal'}
          disabled={!editable}
          onChange={(assigneePrincipalId) => save({ assigneePrincipalId })}
          className="flex h-[30px] items-center gap-2 px-2"
        >
          <Avatar person={assignee} size={22} />
          <span className={assignee ? '' : 'text-(--muted-light)'}>{assignee?.displayName ?? 'Assign a person or agent'}</span>
        </OwnerPicker>
      </PropertyRow>
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
  const { viewer, canWork, updateTask, moveTask, refresh, dropLocal } = useWorkData()
  useScopeFollowsTask(item)
  useEscapeToClose(onClose)

  if (missing) {
    return <PanelMessage title="Task" onClose={onClose}><div className="px-6 py-10 text-center text-sm text-(--muted)">This task is not available. It may have been deleted, or it belongs to someone else.</div></PanelMessage>
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

  const archived = item.archivedAt !== null
  const editable = !archived && canWork(item)
  const save = (patch: UpdateWorkItemRequest) => void updateTask(item.id, patch)
  const needsMyReview = editable && item.status === 'review' && viewer !== null && (item.reviewerUserId ?? item.createdBy) === viewer.userId
  const scopedItem = { _id: item.id, userId: item.createdBy, scope: item.scope, archivedAt: item.archivedAt ?? undefined, archivedFromScope: item.archivedFromScope ?? undefined }

  return (
    <AppScreenSidePanel
      data-testid="work-peek"
      title={<ParentCrumb item={item} />}
      onClose={onClose}
      closeLabel="Close task"
      actions={(
        <ScopeItemActions
          kind="content"
          resource="work"
          item={scopedItem}
          label={item.title}
          onChanged={(change) => {
            if (change.action === 'archive') { dropLocal(item.id); onClose() }
            else window.dispatchEvent(new Event(WORK_UPDATED_EVENT))
            if (change.action === 'restore') void refresh()
          }}
        />
      )}
    >
      <div className="px-7 pb-10 pt-6">
        <PeekTitle item={item} editable={editable} onSave={(title) => save({ title })} />
        {archived ? (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2 text-[13px] text-(--muted)" data-testid="work-archived-note">
            <Undo2 size={14} aria-hidden />
            Archived. Restore it to edit.
          </div>
        ) : null}
        <PeekProperties item={item} editable={editable} save={save} />
        {needsMyReview ? (
          <ReviewCard item={item} disabled={!editable} onApprove={() => save({ status: 'done' })} onRequestChanges={() => void moveTask(item.id, { status: 'progress' })} />
        ) : null}
        <Section title="Objective" hint="The outcome, not the steps">
          <ObjectiveSection value={item.description} editable={editable} onSave={(description) => save({ description })} />
        </Section>
        <WaitingOnSection item={item} editable={editable} onChange={(blockedBy) => save({ blockedBy })} />
        <ContextSection items={item.context} editable={editable} onChange={(context) => save({ context })} />
        <DoneWhenSection items={item.doneWhen} editable={editable} onChange={(doneWhen) => save({ doneWhen })} />
        <ActivitySection taskId={item.id} version={item.updatedAt} canComment={!archived && canWork(item)} />
      </div>
    </AppScreenSidePanel>
  )
}

function ParentCrumb({ item }: { item: WorkItem }) {
  const { byId } = useWorkData()
  const parent = item.parentId ? byId.get(item.parentId) : undefined
  return <span className="text-(--muted)">{parent ? parent.title : 'Task'}</span>
}
