'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { FloatingMenu, MenuItem } from '@overlay/ui/primitives'
import type { WorkPerson, WorkStatus } from '@overlay/app-core'
import { WORK_STATUSES, WORK_STATUS_LABELS } from '@/shared/work/status'
import { Avatar, StatusIcon } from './work-ui'

const SECTION_LABEL = 'px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-(--muted-light)'

/** A button that opens a small menu under it. */
function Picker({
  trigger,
  label,
  disabled,
  children,
  className = '',
}: {
  trigger: (open: boolean) => ReactNode
  label: string
  disabled?: boolean
  className?: string
  children: (close: () => void) => ReactNode
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        className={`rounded-md transition-colors enabled:hover:bg-(--surface-subtle) disabled:cursor-default ${className}`}
      >
        {trigger(open)}
      </button>
      <FloatingMenu anchorRef={anchor} open={open} onOpenChange={setOpen} className="min-w-52 max-h-80 overflow-y-auto" role="menu" aria-label={label}>
        {children(() => setOpen(false))}
      </FloatingMenu>
    </>
  )
}

export function StatusPicker({
  status,
  onChange,
  disabled,
  children,
  className = '',
}: {
  status: WorkStatus
  onChange: (status: WorkStatus) => void
  disabled?: boolean
  /** What the button shows; defaults to the status glyph. */
  children?: ReactNode
  className?: string
}) {
  return (
    <Picker
      label={`Status: ${WORK_STATUS_LABELS[status]}`}
      disabled={disabled}
      className={className || 'grid h-6 w-6 place-items-center'}
      trigger={() => children ?? <StatusIcon status={status} />}
    >
      {(close) => (
        <>
          <div className={SECTION_LABEL}>Status</div>
          {WORK_STATUSES.map((option) => (
            <MenuItem
              key={option}
              role="menuitemradio"
              aria-checked={option === status}
              onClick={(event) => {
                event.stopPropagation()
                close()
                if (option !== status) onChange(option)
              }}
              className="text-(--foreground)"
            >
              <StatusIcon status={option} />
              <span className="flex-1">{WORK_STATUS_LABELS[option]}</span>
              {option === status ? <Check size={13} className="text-(--muted)" /> : null}
            </MenuItem>
          ))}
        </>
      )}
    </Picker>
  )
}

export function OwnerPicker({
  assignee,
  people,
  myPrincipalId,
  personalOnly,
  onChange,
  disabled,
  children,
  className = '',
  label = 'Owner',
}: {
  assignee: WorkPerson | null
  people: readonly WorkPerson[]
  myPrincipalId: string | null
  /** A personal task can only be yours. */
  personalOnly?: boolean
  onChange: (principalId: string | null) => void
  disabled?: boolean
  children?: ReactNode
  className?: string
  label?: string
}) {
  const humans = people.filter((person) => person.type === 'human' && (!personalOnly || person.principalId === myPrincipalId))
  const agents = personalOnly ? [] : people.filter((person) => person.type === 'agent')
  return (
    <Picker
      label={`${label}: ${assignee?.displayName ?? 'Unassigned'}`}
      disabled={disabled}
      className={className || 'grid place-items-center'}
      trigger={() => children ?? <Avatar person={assignee} />}
    >
      {(close) => {
        const choose = (principalId: string | null) => (event: React.MouseEvent) => {
          event.stopPropagation()
          close()
          if (principalId !== (assignee?.principalId ?? null)) onChange(principalId)
        }
        return (
          <>
            {humans.length > 0 ? <div className={SECTION_LABEL}>People</div> : null}
            {humans.map((person) => (
              <MenuItem key={person.principalId} role="menuitemradio" aria-checked={person.principalId === assignee?.principalId} onClick={choose(person.principalId)} className="text-(--foreground)">
                <Avatar person={person} />
                <span className="flex-1 truncate">{person.displayName}{person.principalId === myPrincipalId ? ' (you)' : ''}</span>
                {person.principalId === assignee?.principalId ? <Check size={13} className="text-(--muted)" /> : null}
              </MenuItem>
            ))}
            {agents.length > 0 ? <div className={SECTION_LABEL}>Agents</div> : null}
            {agents.map((person) => (
              <MenuItem key={person.principalId} role="menuitemradio" aria-checked={person.principalId === assignee?.principalId} onClick={choose(person.principalId)} className="text-(--foreground)">
                <Avatar person={person} />
                <span className="flex-1 truncate">{person.displayName}</span>
                {person.principalId === assignee?.principalId ? <Check size={13} className="text-(--muted)" /> : null}
              </MenuItem>
            ))}
            <div className="my-1 border-t border-(--border)" />
            <MenuItem role="menuitem" onClick={choose(null)} className="text-(--foreground)">
              <Avatar person={null} />
              <span className="flex-1">Unassigned</span>
              {!assignee ? <Check size={13} className="text-(--muted)" /> : null}
            </MenuItem>
          </>
        )
      }}
    </Picker>
  )
}
