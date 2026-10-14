'use client'
import { X } from 'lucide-react'
import { Toggle, ListboxSelect } from '@overlay/ui/primitives'
import type { WorkItem, WorkPatch, WorkPerson, WorkEvent } from '@overlay/app-core/work'
import { StatusPicker, workPickerClass } from './StatusPicker'
import { OwnerPicker } from './OwnerPicker'
export const workInputClass =
  'w-full min-w-0 rounded-md border border-(--border) bg-transparent px-2 py-1.5 text-sm disabled:opacity-60'
export const workSectionClass = 'mb-2 text-xs font-medium text-(--muted)'
const inputClass = workInputClass
const section = workSectionClass
type Fields = {
  item: WorkItem
  draft: WorkPatch
  people: WorkPerson[]
  items: WorkItem[]
  change: (patch: WorkPatch) => void
}
export function WorkProperties({ item, draft, people, items, change }: Fields) {
  const eligible = people.filter(
    (person) => item.scope !== 'personal' || person.userId === item.userId,
  )
  const propertyGrid = 'grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs'
  return (
    <div className="space-y-2">
      <div className={propertyGrid}>
        <span className="text-(--muted)">Status</span>
        <StatusPicker
          portal={false}
          value={draft.status ?? item.status}
          onChange={(status) => change({ status })}
        />
        <span className="text-(--muted)">Owner</span>
        <OwnerPicker
          portal={false}
          value={draft.assigneePrincipalId ?? undefined}
          people={eligible}
          label="Task owner"
          onChange={(assigneePrincipalId) => change({ assigneePrincipalId })}
        />
        <label htmlFor="work-due" className="text-(--muted)">
          Due date
        </label>
        <input
          id="work-due"
          type="date"
          min={draft.startDate ?? undefined}
          value={draft.dueDate ?? ''}
          onChange={(e) => change({ dueDate: e.target.value || null })}
          className="h-8 min-w-0 rounded-md bg-transparent px-2 text-xs hover:bg-(--surface-subtle)"
        />
      </div>
      <details>
        <summary className="cursor-pointer py-1 text-xs text-(--muted) hover:text-(--foreground)">
          More properties
        </summary>
        <div className={`${propertyGrid} mt-2`}>
          <label htmlFor="work-reviewer" className="text-(--muted)">
            Reviewer
          </label>
          <ListboxSelect
            portal={false}
            id="work-reviewer"
            value={draft.reviewerUserId ?? ''}
            onChange={(value) => change({ reviewerUserId: value || null })}
            buttonClassName={workPickerClass}
            options={[
              { value: '', label: 'No reviewer' },
              ...(draft.reviewerUserId &&
              !eligible.some((person) => person.userId === draft.reviewerUserId)
                ? [
                    {
                      value: draft.reviewerUserId,
                      label: 'Unavailable reviewer',
                    },
                  ]
                : []),
              ...eligible.map((person) => ({
                value: person.userId,
                label: person.name,
              })),
            ]}
          />
          <label htmlFor="work-priority" className="text-(--muted)">
            Priority
          </label>
          <ListboxSelect<'1' | '2' | '3'>
            portal={false}
            id="work-priority"
            value={draft.priority === 1 ? '1' : draft.priority === 3 ? '3' : '2'}
            onChange={(value) => change({ priority: value === '1' ? 1 : value === '3' ? 3 : 2 })}
            buttonClassName={workPickerClass}
            options={[
              { value: '1', label: 'High' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Low' },
            ]}
          />
          <span className="text-(--muted)">Blocked</span>
          <Toggle
            aria-label="Task blocked"
            checked={draft.blocked ?? false}
            onCheckedChange={(blocked) => change({ blocked })}
          />
          <label htmlFor="work-start" className="text-(--muted)">
            Start date
          </label>
          <input
            id="work-start"
            type="date"
            value={draft.startDate ?? ''}
            onChange={(e) => change({ startDate: e.target.value || null })}
            className="h-8 min-w-0 rounded-md bg-transparent px-2 text-xs hover:bg-(--surface-subtle)"
          />
          <label htmlFor="work-parent" className="text-(--muted)">
            Parent task
          </label>
          <ListboxSelect
            portal={false}
            id="work-parent"
            value={draft.parentId ?? ''}
            onChange={(value) => change({ parentId: value || null })}
            buttonClassName={workPickerClass}
            options={[
              { value: '', label: 'No parent task' },
              ...(draft.parentId && !items.some((row) => row._id === draft.parentId)
                ? [
                    {
                      value: draft.parentId,
                      label: 'Archived or unavailable objective',
                    },
                  ]
                : []),
              ...items
                .filter((row) => row._id !== item._id && !row.parentId && row.scope === item.scope)
                .map((row) => ({ value: row._id, label: row.title })),
            ]}
          />
        </div>
      </details>
    </div>
  )
}
export function WorkDependencies({
  item,
  draft,
  items,
  change,
}: Pick<Fields, 'item' | 'draft' | 'items' | 'change'>) {
  return (
    <section>
      <h2 className={section}>Depends on</h2>
      <div className="space-y-2">
        {(draft.blockedBy ?? []).map((id) => (
          <div
            key={id}
            className="flex items-center justify-between gap-2 rounded border border-(--border) p-2 text-xs"
          >
            <span>
              {items.find((row) => row._id === id)?.title ?? 'Archived or unavailable task'}
            </span>
            <button
              type="button"
              aria-label={`Remove dependency ${items.find((row) => row._id === id)?.title ?? id}`}
              onClick={() =>
                change({
                  blockedBy: draft.blockedBy?.filter((other) => other !== id),
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <ListboxSelect
          portal={false}
          aria-label="Add dependency"
          value=""
          onChange={(value) => {
            if (value) change({ blockedBy: [...(draft.blockedBy ?? []), value] })
          }}
          buttonClassName={workPickerClass}
          options={[
            { value: '', label: 'Add dependency…' },
            ...items
              .filter(
                (row) =>
                  row._id !== item._id &&
                  row.scope === item.scope &&
                  !draft.blockedBy?.includes(row._id),
              )
              .map((row) => ({ value: row._id, label: row.title })),
          ]}
        />
      </div>
    </section>
  )
}
export function WorkChecklist({
  draft,
  change,
  disabled,
}: {
  draft: WorkPatch
  change: Fields['change']
  disabled: boolean
}) {
  return (
    <section>
      <h2 className={section}>Done when</h2>
      <div className="space-y-2">
        {(draft.doneWhen ?? []).map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <Toggle
              checked={entry.checked}
              aria-label={`Complete checklist item ${index + 1}`}
              onCheckedChange={(checked) =>
                change({
                  doneWhen: draft.doneWhen?.map((row, i) =>
                    i === index ? { ...row, checked } : row,
                  ),
                })
              }
            />
            <input
              aria-label={`Checklist item ${index + 1}`}
              maxLength={1000}
              value={entry.text}
              onChange={(e) =>
                change({
                  doneWhen: draft.doneWhen?.map((row, i) =>
                    i === index ? { ...row, text: e.target.value } : row,
                  ),
                })
              }
              className={inputClass}
            />
            <button
              type="button"
              aria-label={`Remove checklist item ${index + 1}`}
              onClick={() =>
                change({
                  doneWhen: draft.doneWhen?.filter((_, i) => i !== index),
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {!disabled ? (
          <button
            type="button"
            className="text-xs text-(--muted)"
            onClick={() =>
              change({
                doneWhen: [...(draft.doneWhen ?? []), { text: '', checked: false }],
              })
            }
          >
            Add condition
          </button>
        ) : null}
      </div>
    </section>
  )
}
export function WorkActivity({
  events,
  people,
  item,
  comment,
  busy,
  setComment,
  onComment,
}: {
  events: WorkEvent[]
  people: WorkPerson[]
  item: WorkItem
  comment: string
  busy: boolean
  setComment: (text: string) => void
  onComment: () => void
}) {
  return (
    <section>
      <h2 className={section}>Activity</h2>
      <ol className="space-y-3 text-xs">
        {events.map((event) => (
          <li key={event._id} className="border-l border-(--border) pl-3">
            <div className="mb-1 text-(--muted)">
              {people.find((person) => person.principalId === event.actorPrincipalId)?.name ??
                'Member'}{' '}
              · {new Date(event.createdAt).toLocaleString()}
            </div>
            <p className="whitespace-pre-wrap break-words">
              {event.kind === 'comment'
                ? event.data.text
                : event.kind === 'updated'
                  ? `Changed ${event.data.field ?? 'task'}`
                  : event.kind === 'status'
                    ? 'Changed status'
                    : event.kind === 'assignee'
                      ? 'Changed owner'
                      : event.kind === 'scope'
                        ? `Moved to ${event.data.after}`
                        : `${event.kind[0].toUpperCase()}${event.kind.slice(1)} task`}
            </p>
          </li>
        ))}
      </ol>
      {item.archivedAt === undefined ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            onComment()
          }}
        >
          <textarea
            aria-label="Comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={5000}
            disabled={busy}
            placeholder="Add a comment…"
            className={inputClass}
          />
          <button
            disabled={busy || !comment.trim()}
            className="rounded bg-(--surface-subtle) px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Post comment
          </button>
        </form>
      ) : null}
    </section>
  )
}
