'use client'
import { X } from 'lucide-react'
import { Toggle } from '@overlay/ui/primitives'
import type { WorkItem, WorkPatch, WorkPerson, WorkEvent } from '@overlay/app-core/work'
import { StatusPicker } from './StatusPicker'
import { OwnerPicker } from './OwnerPicker'
export const workInputClass =
  'w-full min-w-0 rounded-md border border-(--border) bg-transparent px-2 py-1.5 text-sm disabled:opacity-60'
export const workSectionClass = 'mb-3 text-xs font-medium text-(--muted)'
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
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-xs">
      <span className="text-(--muted)">Status</span>
      <StatusPicker value={draft.status ?? item.status} onChange={(status) => change({ status })} />
      <span className="text-(--muted)">Owner</span>
      <OwnerPicker
        value={draft.assigneePrincipalId ?? undefined}
        people={eligible}
        label="Task owner"
        onChange={(assigneePrincipalId) => change({ assigneePrincipalId })}
      />
      <label htmlFor="work-reviewer" className="text-(--muted)">
        Reviewer
      </label>
      <select
        id="work-reviewer"
        value={draft.reviewerUserId ?? ''}
        onChange={(e) => change({ reviewerUserId: e.target.value || null })}
        className={inputClass}
      >
        <option value="">No reviewer</option>
        {draft.reviewerUserId &&
        !eligible.some((person) => person.userId === draft.reviewerUserId) ? (
          <option value={draft.reviewerUserId}>Unavailable reviewer</option>
        ) : null}
        {eligible.map((person) => (
          <option key={person.userId} value={person.userId}>
            {person.name}
          </option>
        ))}
      </select>
      <label htmlFor="work-priority" className="text-(--muted)">
        Priority
      </label>
      <select
        id="work-priority"
        value={draft.priority}
        onChange={(e) =>
          change({ priority: e.target.value === '1' ? 1 : e.target.value === '3' ? 3 : 2 })
        }
        className={inputClass}
      >
        <option value="1">High</option>
        <option value="2">Normal</option>
        <option value="3">Low</option>
      </select>
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
        className={inputClass}
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
        className={inputClass}
      />
      <label htmlFor="work-parent" className="text-(--muted)">
        Objective
      </label>
      <select
        id="work-parent"
        value={draft.parentId ?? ''}
        onChange={(e) => change({ parentId: e.target.value || null })}
        className={inputClass}
      >
        <option value="">No parent objective</option>
        {draft.parentId && !items.some((row) => row._id === draft.parentId) ? (
          <option value={draft.parentId}>Archived or unavailable objective</option>
        ) : null}
        {items
          .filter((row) => row._id !== item._id && !row.parentId && row.scope === item.scope)
          .map((row) => (
            <option key={row._id} value={row._id}>
              {row.title}
            </option>
          ))}
      </select>
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
                change({ blockedBy: draft.blockedBy?.filter((other) => other !== id) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <select
          aria-label="Add dependency"
          value=""
          onChange={(e) => {
            if (e.target.value) change({ blockedBy: [...(draft.blockedBy ?? []), e.target.value] })
          }}
          className={inputClass}
        >
          <option value="">Choose a dependency…</option>
          {items
            .filter(
              (row) =>
                row._id !== item._id &&
                row.scope === item.scope &&
                !draft.blockedBy?.includes(row._id),
            )
            .map((row) => (
              <option key={row._id} value={row._id}>
                {row.title}
              </option>
            ))}
        </select>
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
              onClick={() => change({ doneWhen: draft.doneWhen?.filter((_, i) => i !== index) })}
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
              change({ doneWhen: [...(draft.doneWhen ?? []), { text: '', checked: false }] })
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
