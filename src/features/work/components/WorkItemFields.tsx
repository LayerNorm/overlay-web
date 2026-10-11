'use client'

import { useMemo } from 'react'
import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'
import { ListboxSelect } from '@overlay/ui/primitives'
import { WORK_ITEM_PRIORITY_OPTIONS, WORK_ITEM_STATUS_OPTIONS } from '@/shared/work/work-item-ui'
import type { WorkItemUpdate } from './useWorkItemDrawer'

const fieldLabelClass = 'w-24 shrink-0 text-xs text-[var(--muted-light)]'
const fieldRowClass = 'flex items-center gap-3 px-5 py-2'
const selectButtonClass = 'h-7 w-full justify-start border-0 px-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]'
// Native date pickers follow the app theme, not the OS.
const dateInputClass =
  'h-7 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none [color-scheme:light] [[data-theme=dark]_&]:[color-scheme:dark]'

function toDateInputValue(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toISOString().slice(0, 10)
}

function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(parsed) ? undefined : parsed
}

function DateRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number | undefined
  disabled: boolean
  /** The new day, or undefined when the field was emptied. */
  onCommit: (next: number | undefined) => void
}) {
  return (
    <div className={fieldRowClass}>
      <span className={fieldLabelClass}>{label}</span>
      <input
        key={`${label}-${value ?? 'none'}`}
        type="date"
        defaultValue={toDateInputValue(value)}
        aria-label={label}
        // Commit on blur: patching on each `change` re-renders mid-typing
        // and resets the browser's pending year segment.
        onBlur={(event) => {
          const next = fromDateInputValue(event.target.value)
          if (next !== value) onCommit(next)
        }}
        disabled={disabled}
        className={dateInputClass}
      />
    </div>
  )
}

/** The property rows: status, priority, assignee, start and due. Each change is its own single request. */
export function WorkItemFields({
  item,
  members,
  disabled,
  onPatch,
}: {
  item: WorkItemDoc
  members: Record<string, string>
  disabled: boolean
  onPatch: (body: WorkItemUpdate) => void
}) {
  const memberOptions = useMemo(
    () => [{ value: '', label: 'Unassigned' }, ...Object.entries(members).map(([id, name]) => ({ value: id, label: name }))],
    [members],
  )
  return (
    <div className="border-y border-[var(--border)] py-1">
      <div className={fieldRowClass}>
        <span className={fieldLabelClass}>Status</span>
        <ListboxSelect
          aria-label="Status"
          value={item.status}
          options={WORK_ITEM_STATUS_OPTIONS.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(status: WorkItemStatus) => onPatch({ status })}
          disabled={disabled}
          className="flex-1"
          buttonClassName={selectButtonClass}
          menuClassName="min-w-36"
        />
      </div>
      <div className={fieldRowClass}>
        <span className={fieldLabelClass}>Priority</span>
        <ListboxSelect
          aria-label="Priority"
          value={item.priority}
          options={WORK_ITEM_PRIORITY_OPTIONS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(priority: WorkItemPriority) => onPatch({ priority })}
          disabled={disabled}
          className="flex-1"
          buttonClassName={selectButtonClass}
          menuClassName="min-w-36"
        />
      </div>
      <div className={fieldRowClass}>
        <span className={fieldLabelClass}>Assignee</span>
        <ListboxSelect
          aria-label="Assignee"
          value={item.assigneeUserId ?? ''}
          options={memberOptions}
          onChange={(assigneeUserId: string) => onPatch(assigneeUserId ? { assigneeUserId } : { clearAssignee: true })}
          // A private task can only be yours; share it with the workspace to assign it to someone else.
          disabled={disabled || item.scope !== 'workspace' || memberOptions.length <= 1}
          className="flex-1"
          buttonClassName={selectButtonClass}
          menuClassName="min-w-36"
        />
      </div>
      <DateRow
        label="Start"
        value={item.startDate}
        disabled={disabled}
        onCommit={(startDate) => onPatch(startDate === undefined ? { clearStartDate: true } : { startDate })}
      />
      <DateRow
        label="Due"
        value={item.dueDate}
        disabled={disabled}
        onCommit={(dueDate) => onPatch(dueDate === undefined ? { clearDueDate: true } : { dueDate })}
      />
    </div>
  )
}
