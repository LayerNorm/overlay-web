'use client'
import { useState } from 'react'
import { Pencil, Flag, Ban } from 'lucide-react'
import { ListRow } from '@overlay/ui/primitives'
import type { WorkItem, WorkPatch } from '@overlay/app-core/work'
import { StatusPicker } from './StatusPicker'
import { OwnerPicker, type WorkPerson } from './OwnerPicker'

export function WorkRow({
  item,
  selected = false,
  people,
  pending,
  editable,
  onUpdate,
  onOpen,
}: {
  item: WorkItem
  selected?: boolean
  people: readonly WorkPerson[]
  pending: boolean
  editable: boolean
  onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<unknown>
  onOpen: (item: WorkItem) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [error, setError] = useState<string | null>(null)
  const update = async (patch: WorkPatch) => {
    try {
      setError(null)
      await onUpdate(item, patch)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save task.')
      return false
    }
  }
  const owners =
    item.scope === 'personal' ? people.filter((person) => person.userId === item.userId) : people
  return (
    <div data-work-id={item._id}>
      <ListRow
        className={`group/row mx-3 flex-col items-stretch gap-1 rounded-md py-2 @lg:flex-row @lg:items-center @lg:gap-3 [&>div:last-child]:flex-wrap [&>div:last-child]:shrink @lg:[&>div:last-child]:shrink-0 ${selected ? 'bg-(--surface-subtle)' : ''}`}
        title={
          renaming ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (await update({ title })) setRenaming(false)
              }}
            >
              <input
                autoFocus
                aria-label={`Rename ${item.title}`}
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(false)
                }}
                disabled={pending}
                className="w-full rounded border border-(--border) bg-(--surface-subtle) px-2 py-1 text-sm outline-hidden"
              />
            </form>
          ) : (
            <button
              onClick={() => onOpen(item)}
              aria-expanded={selected}
              aria-controls={selected ? 'work-task-brief' : undefined}
              className="block max-w-full truncate text-left font-normal hover:underline"
              title={item.title}
            >
              {item.title}
            </button>
          )
        }
        description={
          error ? (
            <span role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : item.blocked ? (
            <span className="inline-flex items-center gap-1">
              <Ban size={11} />
              Blocked
            </span>
          ) : undefined
        }
        trailing={
          <>
            {item.dueDate ? (
              <time dateTime={item.dueDate} className="hidden text-xs text-(--muted) @lg:block">
                {new Intl.DateTimeFormat('en', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(item.dueDate))}
              </time>
            ) : null}
            <Flag
              size={13}
              strokeWidth={item.priority === 1 ? 2.5 : 1.5}
              className={item.priority === 1 ? 'text-(--foreground)' : 'text-(--muted-light)'}
              aria-label={`Priority ${item.priority}`}
            />
            <StatusPicker
              value={item.status}
              label={`Status of ${item.title}`}
              disabled={!editable || pending}
              onChange={(status) => {
                void update({ status })
              }}
            />
            <OwnerPicker
              value={item.assigneePrincipalId}
              people={owners}
              label={`Owner of ${item.title}`}
              disabled={!editable || pending}
              onChange={(assigneePrincipalId) => {
                void update({ assigneePrincipalId })
              }}
            />
            {editable ? (
              <button
                aria-label={`Rename ${item.title}`}
                disabled={pending}
                onClick={() => {
                  setTitle(item.title)
                  setRenaming(true)
                }}
                className="rounded p-1.5 text-(--muted) opacity-100 @lg:opacity-0 focus:opacity-100 group-hover/row:opacity-100"
              >
                <Pencil size={13} />
              </button>
            ) : null}
          </>
        }
      />
    </div>
  )
}
