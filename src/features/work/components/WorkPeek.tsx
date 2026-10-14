'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CalendarDays, CircleDot, CornerDownRight, Flag, Undo2, User, UserCheck } from 'lucide-react'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import { Button, Toggle } from '@overlay/ui/primitives'
import { WORK_UPDATED_EVENT, type WorkItem, type WorkPerson } from '@overlay/app-core'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { checkParent, descendantsOf } from '@/shared/work/graph'
import { validateWorkDates, validateWorkTitle } from '@/shared/work/status'
import { withPanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkRoute } from '../lib/use-work-route'
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

/**
 * The task panel: everything about one task. A person edits it in place; each change saves at once. A task that is
 * archived is read-only, with Restore.
 */
export function WorkPeek({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/work'
  const params = useSearchParams()
  const { scope, solo } = useWorkRoute()
  const { items, byId, state, people, personByPrincipal, viewer, canWork, updateTask, moveTask, refresh, dropLocal } = useWorkData()
  const [fetched, setFetched] = useState<WorkItem | null | undefined>(undefined)
  const listed = byId.get(taskId)

  // A link can name a task that is not in the list on screen (another scope, or archived): read it directly.
  useEffect(() => {
    if (listed || state !== 'ready') return
    let cancelled = false
    overlayAppClient.work.get(taskId)
      .then(({ item }) => { if (!cancelled) setFetched(item) })
      .catch(() => { if (!cancelled) setFetched(null) })
    return () => { cancelled = true }
  }, [listed, state, taskId])

  const item = listed ?? (fetched ?? undefined)

  // A task opens in the scope it lives in, so the list behind the panel agrees with it.
  useEffect(() => {
    if (!item || item.archivedAt !== null || solo || item.scope === scope) return
    const next = withPanelScope(new URLSearchParams(params?.toString() ?? ''), item.scope)
    if (item.scope === 'personal') next.set('scope', 'personal')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [item, params, pathname, router, scope, solo])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      // A picker that is open takes Escape first.
      if (document.querySelector('[data-work-menu]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const parent = item?.parentId ? byId.get(item.parentId) ?? null : null
  const archived = item?.archivedAt != null
  const editable = Boolean(item) && !archived && canWork(item as WorkItem)
  const reviewerPerson = item?.reviewerUserId ? people.find((person) => person.userId === item.reviewerUserId) ?? null : null
  const assignee: WorkPerson | null = item?.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null

  const parentOptions = useMemo(() => {
    if (!item) return []
    const childrenOf = (id: string) => items.filter((other) => other.parentId === id).map((other) => other.id)
    const parentOf = (id: string) => byId.get(id)?.parentId ?? null
    const below = new Set(descendantsOf(item.id, childrenOf))
    return items
      .filter((other) => other.id !== item.id && other.scope === item.scope && other.archivedAt === null && !below.has(other.id)
        && checkParent({ id: item.id, parentId: other.id, parentOf, childrenOf }).ok)
      .map((other) => ({ id: other.id, title: other.title }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [byId, item, items])

  // The title being typed; null means "show the saved one".
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const title = titleDraft ?? item?.title ?? ''
  const titleField = useRef<HTMLTextAreaElement>(null)
  // The title wraps rather than scrolls: size the field to its text whenever the text changes.
  useLayoutEffect(() => {
    const field = titleField.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [title, taskId, item?.id])
  const [dateError, setDateError] = useState<string | null>(null)

  if (state === 'ready' && fetched === null && !listed) {
    return (
      <AppScreenSidePanel title="Task" onClose={onClose} closeLabel="Close task" data-testid="work-peek">
        <div className="px-6 py-10 text-center text-sm text-(--muted)">This task is not available. It may have been deleted, or it belongs to someone else.</div>
      </AppScreenSidePanel>
    )
  }
  if (!item) {
    return (
      <AppScreenSidePanel title="Task" onClose={onClose} closeLabel="Close task" data-testid="work-peek">
        <div className="px-6 py-10" role="status" aria-label="Loading task">
          <div className="ui-skeleton-line mb-4 h-6 w-2/3 rounded-md" />
          <div className="ui-skeleton-line h-3 w-1/2 rounded-md" />
        </div>
      </AppScreenSidePanel>
    )
  }

  const save = (patch: Parameters<typeof updateTask>[1]) => void updateTask(item.id, patch)
  const saveDates = (startDate: string | null, dueDate: string | null) => {
    const problem = validateWorkDates(startDate, dueDate)
    setDateError(problem)
    if (!problem) save({ startDate, dueDate })
  }
  const needsMyReview = item.status === 'review' && viewer !== null && (item.reviewerUserId ?? item.createdBy) === viewer.userId
  const scopedItem = { _id: item.id, userId: item.createdBy, scope: item.scope, archivedAt: item.archivedAt ?? undefined, archivedFromScope: item.archivedFromScope ?? undefined }

  return (
    <AppScreenSidePanel
      data-testid="work-peek"
      title={<span className="text-(--muted)">{parent ? parent.title : 'Task'}</span>}
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
        <textarea
          ref={titleField}
          value={title}
          rows={1}
          aria-label="Title"
          disabled={!editable}
          maxLength={200}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => {
            const next = title.trim()
            setTitleDraft(null)
            if (!validateWorkTitle(next) && next !== item.title) save({ title: next })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            if (event.key === 'Escape') { event.stopPropagation(); setTitleDraft(null); event.currentTarget.blur() }
          }}
          className="mb-4 block w-full resize-none overflow-hidden bg-transparent font-serif text-2xl leading-tight tracking-tight text-(--foreground) outline-none disabled:opacity-100"
        />

        {archived ? (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface-muted) px-3 py-2 text-[13px] text-(--muted)" data-testid="work-archived-note">
            <Undo2 size={14} aria-hidden />
            Archived. Restore it to edit.
          </div>
        ) : null}

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
              reviewer={reviewerPerson}
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
            <div className="flex items-center gap-1 [&_input]:-ml-0">
              <DateField label="Start date" value={item.startDate} disabled={!editable} onChange={(value) => saveDates(value, item.dueDate)} />
              <span className="text-(--muted-light)">to</span>
              <DateField label="Due date" value={item.dueDate} disabled={!editable} onChange={(value) => saveDates(item.startDate, value)} />
            </div>
          </PropertyRow>
          {dateError ? <><span /><p role="alert" className="pb-1 text-xs text-red-600 dark:text-red-400">{dateError}</p></> : null}
          <PropertyRow icon={<CornerDownRight size={13} />} label="Inside">
            <ParentPicker
              parentTitle={parent?.title ?? null}
              options={parentOptions}
              disabled={!editable}
              onChange={(parentId) => save({ parentId })}
            />
          </PropertyRow>
          <PropertyRow icon={<AlertTriangle size={13} />} label="Blocked">
            <div className="flex items-center gap-2">
              <Toggle checked={item.blocked} disabled={!editable} aria-label="Blocked" onCheckedChange={(blocked) => save({ blocked })} className="h-5 w-9 [&>span]:h-3.5 [&>span]:w-3.5 [&>span]:translate-x-[3px] aria-checked:[&>span]:translate-x-[18px]" />
              <span className="text-xs text-(--muted-light)">{item.blocked ? 'Waiting on something' : ''}</span>
            </div>
          </PropertyRow>
        </div>

        {needsMyReview && editable ? (
          <ReviewCard
            item={item}
            disabled={!editable}
            onApprove={() => save({ status: 'done' })}
            onRequestChanges={() => void moveTask(item.id, { status: 'progress' })}
          />
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
