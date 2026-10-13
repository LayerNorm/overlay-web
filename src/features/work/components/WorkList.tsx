'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { WorkItem, WorkPatch, WorkStatus } from '@overlay/app-core/work'
import { WORK_STATUS_LABELS } from '@/shared/work/status'
import { groupWork } from '../lib/selection'
import { WorkRow } from './WorkRow'
import type { WorkPerson } from './OwnerPicker'

export function WorkList({
  items,
  people,
  pending,
  canEdit,
  onUpdate,
  onOpen,
}: {
  items: readonly WorkItem[]
  people: readonly WorkPerson[]
  pending: ReadonlySet<string>
  canEdit: (item: WorkItem) => boolean
  onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<unknown>
  onOpen: (item: WorkItem) => void
}) {
  const [limits, setLimits] = useState<Partial<Record<WorkStatus, number>>>({})
  const [closed, setClosed] = useState<ReadonlySet<WorkStatus>>(new Set())
  if (!items.length)
    return (
      <div className="px-6 py-16 text-center">
        <h2 className="text-sm font-medium">No tasks here</h2>
        <p className="mt-2 text-sm text-(--muted)">Add a task or change your filters.</p>
      </div>
    )
  return (
    <div className="pb-6">
      {groupWork(items)
        .filter((group) => group.items.length)
        .map((group) => (
          <section key={group.status} className="mt-4">
            <button
              aria-expanded={!closed.has(group.status)}
              onClick={() =>
                setClosed((old) => {
                  const next = new Set(old)
                  if (next.has(group.status)) next.delete(group.status)
                  else next.add(group.status)
                  return next
                })
              }
              className="flex w-full items-center gap-2 px-6 py-2 text-left text-xs font-medium text-(--muted)"
            >
              <ChevronDown size={13} className={closed.has(group.status) ? '-rotate-90' : ''} />
              {WORK_STATUS_LABELS[group.status]}
              <span className="text-(--muted-light)">{group.items.length}</span>
            </button>
            {!closed.has(group.status)
              ? group.items
                  .slice(0, limits[group.status] ?? 100)
                  .map((item) => (
                    <WorkRow
                      key={item._id}
                      item={item}
                      people={people}
                      pending={pending.has(item._id)}
                      editable={canEdit(item)}
                      onUpdate={onUpdate}
                      onOpen={onOpen}
                    />
                  ))
              : null}
            {!closed.has(group.status) && group.items.length > (limits[group.status] ?? 100) ? (
              <button
                className="mx-6 mt-2 text-xs text-(--muted) underline"
                onClick={() =>
                  setLimits((old) => ({ ...old, [group.status]: (old[group.status] ?? 100) + 100 }))
                }
              >
                Show more {WORK_STATUS_LABELS[group.status].toLowerCase()} tasks
              </button>
            ) : null}
          </section>
        ))}
    </div>
  )
}
