'use client'

import { useEffect, useRef, useState } from 'react'
import type { WorkItem } from '@overlay/app-core'
import { validateWorkTitle } from '@/shared/work/status'
import { useWorkData } from './WorkDataProvider'
import { OwnerPicker, StatusPicker } from './WorkPickers'
import { Avatar, DueLabel, Tag } from './work-ui'

function InlineTitle({ title, done, onCommit, onCancel }: { title: string; done: boolean; onCommit: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      value={value}
      maxLength={200}
      aria-label="Task title"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => (validateWorkTitle(value) || value.trim() === title ? onCancel() : onCommit(value.trim()))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (validateWorkTitle(value) || value.trim() === title) onCancel()
          else onCommit(value.trim())
        } else if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      className={`min-w-0 flex-1 rounded border border-(--muted-light) bg-(--surface-elevated) px-1.5 py-0.5 text-sm outline-none ${done ? 'text-(--muted)' : 'text-(--foreground)'}`}
    />
  )
}

/** One task in the list: status, title, flags, where it sits, when it is due, and who has it. */
export function WorkRow({
  item,
  parentTitle,
  today,
  selected,
  onOpen,
}: {
  item: WorkItem
  parentTitle: string | null
  today: string
  selected: boolean
  onOpen: (id: string) => void
}) {
  const { updateTask, canWork, personByPrincipal, people, viewer } = useWorkData()
  const [renaming, setRenaming] = useState(false)
  const editable = canWork(item)
  const done = item.status === 'done'
  const assignee = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null

  return (
    <div
      role="row"
      data-testid="work-row"
      data-task-id={item.id}
      aria-selected={selected}
      onClick={() => onOpen(item.id)}
      className={`flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6 transition-colors hover:bg-(--surface-muted) ${selected ? 'bg-(--surface-subtle)' : ''}`}
    >
      <StatusPicker status={item.status} disabled={!editable} onChange={(status) => void updateTask(item.id, { status })} />
      {renaming ? (
        <InlineTitle
          title={item.title}
          done={done}
          onCancel={() => setRenaming(false)}
          onCommit={(title) => {
            setRenaming(false)
            void updateTask(item.id, { title })
          }}
        />
      ) : (
        <button
          type="button"
          onDoubleClick={(event) => {
            if (!editable) return
            event.stopPropagation()
            setRenaming(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2' && editable) {
              event.preventDefault()
              setRenaming(true)
            }
          }}
          title={editable ? 'Double-click to rename' : undefined}
          className={`min-w-0 flex-1 truncate text-left text-sm ${done ? 'text-(--muted) line-through decoration-(--muted-light)' : 'text-(--foreground)'}`}
        >
          {item.title}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-3.5 text-[12.5px] text-(--muted)">
        {item.blocked ? <Tag tone="danger">Blocked</Tag> : null}
        {item.status === 'review' && viewer && (item.reviewerUserId ?? item.createdBy) === viewer.userId ? <Tag tone="attention">Ready for review</Tag> : null}
        {parentTitle ? <span className="hidden max-w-36 truncate md:inline" title={parentTitle}>{parentTitle}</span> : null}
        <DueLabel dueDate={item.dueDate} done={done} today={today} className="hidden w-14 text-right sm:inline" />
        <OwnerPicker
          assignee={assignee}
          people={people}
          myPrincipalId={viewer?.principalId ?? null}
          personalOnly={item.scope === 'personal'}
          disabled={!editable}
          onChange={(assigneePrincipalId) => void updateTask(item.id, { assigneePrincipalId })}
          className="grid place-items-center p-0.5"
        >
          <Avatar person={assignee} />
        </OwnerPicker>
      </div>
    </div>
  )
}
