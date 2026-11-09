'use client'

import { useState, type ReactNode } from 'react'
import { CalendarDays, Check, GitFork, User } from 'lucide-react'
import { Button, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Input, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'
import type { WorkItem, WorkPerson } from '@overlay/app-core'
import { addDays, toWorkDate } from '@/shared/work/dates'
import { WORK_LIMITS } from '@/shared/work/status'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import type { ComposerDraft } from '../lib/composer-draft'
import { Avatar } from './work-ui'

function ComposerPicker({ label, icon, disabled, children }: { label: string; icon: ReactNode; disabled?: boolean; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={disabled} className="h-8 min-w-0 gap-1.5 rounded-lg px-2 text-xs font-normal text-(--muted)">{icon}<span className="max-w-28 truncate">{label}</span></Button></PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-72 max-w-[calc(100vw-2rem)] p-1">{children(() => setOpen(false))}</PopoverContent>
  </Popover>
}

export function ComposerAssignee({ people, scope, principalId, value, onChange, disabled }: {
  people: readonly WorkPerson[]; scope: PanelScope; principalId: string | null; value: string; onChange(value: string): void; disabled?: boolean
}) {
  const selected = people.find(person => person.principalId === value)
  const available = people.filter(person => person.type === 'human'
    ? scope !== 'personal' || person.principalId === principalId
    : scope !== 'workspace' || person.agentVisibility !== 'creator')
  return <ComposerPicker label={selected?.displayName ?? 'Assignee'} icon={selected ? <Avatar person={selected} size={16} /> : <User size={14} />} disabled={disabled}>
    {close => <Command><CommandInput placeholder="Assign to..." /><CommandList><CommandEmpty>No one found.</CommandEmpty>
      <CommandItem value="Unassigned" onSelect={() => { onChange(''); close() }}>Unassigned{!value ? <Check size={14} className="ml-auto" /> : null}</CommandItem>
      {(['human', 'agent'] as const).map(type => <CommandGroup key={type} heading={type === 'human' ? 'People' : 'Agents'}>
        {available.filter(person => person.type === type).map(person => <CommandItem key={person.principalId} value={`${person.displayName} ${person.principalId}`} onSelect={() => { onChange(person.principalId === value ? '' : person.principalId); close() }}>
          <Avatar person={person} size={18} /><span className="truncate">{person.displayName}</span>{person.principalId === value ? <Check size={14} className="ml-auto" /> : null}
        </CommandItem>)}
      </CommandGroup>)}
    </CommandList></Command>}
  </ComposerPicker>
}

export function ComposerSchedule({ draft, onChange, disabled }: { draft: ComposerDraft; onChange(patch: Partial<ComposerDraft>): void; disabled?: boolean }) {
  const today = toWorkDate(new Date())
  const count = Number(Boolean(draft.startDate)) + Number(Boolean(draft.dueDate))
  return <ComposerPicker label={count ? `Schedule (${count})` : 'Schedule'} icon={<CalendarDays size={14} />} disabled={disabled}>
    {() => <div className="grid gap-4 p-3">{(['startDate', 'dueDate'] as const).map(field => <div key={field}>
      <label className="mb-1.5 block text-xs text-(--muted)" htmlFor={`work-composer-${field}`}>{field === 'startDate' ? 'Start' : 'Due'}</label>
      <div className="mb-2 flex flex-wrap gap-1">{[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([label, days]) => <Button key={label} type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange({ [field]: addDays(today, Number(days)) })}>{label}</Button>)}</div>
      <Input id={`work-composer-${field}`} type="date" value={draft[field]} onChange={event => onChange({ [field]: event.target.value })} />
      {draft[field] ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ [field]: '' })}>Clear</Button> : null}
    </div>)}</div>}
  </ComposerPicker>
}

export function ComposerDependencies({ tasks, value, onChange, disabled }: { tasks: readonly WorkItem[]; value: string[]; onChange(value: string[]): void; disabled?: boolean }) {
  return <ComposerPicker label={value.length ? `Depends on (${value.length})` : 'Depends on'} icon={<GitFork size={14} />} disabled={disabled}>
    {() => <Command><CommandInput placeholder="Find a task..." /><CommandList><CommandEmpty>No tasks found.</CommandEmpty>
      {tasks.filter(task => task.archivedAt === null).map(task => <CommandItem key={task.id} value={`${task.title} ${task.id}`} disabled={!value.includes(task.id) && value.length >= WORK_LIMITS.blockedBy} onSelect={() => onChange(value.includes(task.id) ? value.filter(id => id !== task.id) : [...value, task.id])}>
        <span className="truncate">{task.title}</span>{value.includes(task.id) ? <Check size={14} className="ml-auto shrink-0" /> : null}
      </CommandItem>)}
    </CommandList></Command>}
  </ComposerPicker>
}
