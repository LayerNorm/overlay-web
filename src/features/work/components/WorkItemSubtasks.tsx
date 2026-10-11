'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { WorkItemDoc } from '@overlay/api-client'
import { workItemKey, workItemStatusDotClass } from '@/shared/work/work-item-ui'

/** The subtask list with its "Add a subtask" row. Only a top-level, live task can have subtasks. */
export function WorkItemSubtasks({
  subtasks,
  canAdd,
  busy,
  onAdd,
}: {
  subtasks: WorkItemDoc[]
  canAdd: boolean
  busy: boolean
  /** Resolves true when the subtask was created, so the box can be cleared. */
  onAdd: (title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const submit = async () => {
    const next = title.trim()
    if (!next || busy) return
    if (await onAdd(next)) setTitle('')
  }
  return (
    <div className="border-t border-[var(--border)] px-5 py-4">
      <div className="mb-2 text-xs text-[var(--muted-light)]">Subtasks</div>
      <div className="flex flex-col gap-0.5">
        {subtasks.map((child) => (
          <div key={child._id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-[var(--muted)]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${workItemStatusDotClass(child.status)}`} />
            <span className="font-mono text-[10px] text-[var(--muted-light)]">{workItemKey(child)}</span>
            <span className="truncate">{child.title}</span>
          </div>
        ))}
        {subtasks.length === 0 ? <div className="px-1.5 py-1 text-xs text-[var(--muted-light)]">No subtasks</div> : null}
      </div>
      {canAdd ? (
        <div className="mt-2 flex items-center gap-2">
          <Plus size={12} className="text-[var(--muted-light)]" />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
            placeholder="Add a subtask"
            maxLength={200}
            disabled={busy}
            className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-light)] disabled:opacity-60"
          />
        </div>
      ) : null}
    </div>
  )
}
