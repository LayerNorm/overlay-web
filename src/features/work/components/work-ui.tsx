import type { WorkPerson, WorkPriority, WorkStatus } from '@overlay/app-core'
import { Avatar as AvatarRoot, AvatarFallback } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { WORK_PRIORITY_LABELS } from '@/shared/work/status'
import { dueTone, formatWorkDate } from '@/shared/work/dates'
import { initialsOf } from '../lib/work-state'

export const STATUS_TEXT: Record<WorkStatus, string> = {
  backlog: 'text-zinc-400 dark:text-zinc-500',
  todo: 'text-zinc-500 dark:text-zinc-400',
  progress: 'text-amber-600 dark:text-amber-400',
  review: 'text-violet-600 dark:text-violet-400',
  done: 'text-green-600 dark:text-green-400',
}

/** The status as a small glyph: the shape says the state before the colour does. */
export function StatusIcon({ status, size = 16, className = '' }: { status: WorkStatus; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={`shrink-0 ${STATUS_TEXT[status]} ${className}`} aria-hidden>
      {status === 'backlog' ? <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2" /> : null}
      {status === 'todo' ? <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
      {status === 'progress' ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" />
        </>
      ) : null}
      {status === 'review' ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4a4 4 0 0 1 0 8a4 4 0 0 1 0-8Z" fill="currentColor" />
        </>
      ) : null}
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  )
}

/** A person is a round badge with initials; an agent is its creature avatar. Unassigned is a dashed circle. */
export function Avatar({ person, size = 22, title }: { person: Pick<WorkPerson, 'displayName' | 'type' | 'avatarColor' | 'avatarShape'> | null; size?: number; title?: string }) {
  const dimension = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }
  if (!person) {
    return (
      <AvatarRoot
        className="rounded-full border border-dashed border-(--muted-light) text-(--muted-light)"
        style={dimension}
        title={title ?? 'Unassigned'}
        aria-label={title ?? 'Unassigned'}
      >
        <AvatarFallback className="bg-transparent" />
      </AvatarRoot>
    )
  }
  if (person.type === 'agent') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        title={title ?? `${person.displayName} (agent)`}
        aria-label={title ?? person.displayName}
      >
        <AgentCreature
          agent={{ name: person.displayName, avatarColor: person.avatarColor, avatarShape: person.avatarShape }}
          size={size}
        />
      </span>
    )
  }
  return (
    <AvatarRoot
      className="rounded-full border border-(--border) bg-(--surface-subtle) font-semibold text-(--foreground)"
      style={dimension}
      title={title ?? person.displayName}
      aria-label={title ?? person.displayName}
    >
      <AvatarFallback className="bg-transparent font-semibold">{initialsOf(person.displayName)}</AvatarFallback>
    </AvatarRoot>
  )
}

/** Three bars; the more are filled, the higher the priority. */
export function PriorityBars({ priority }: { priority: WorkPriority }) {
  return (
    <span className="inline-flex h-3 items-end gap-[1.5px]" role="img" aria-label={`${WORK_PRIORITY_LABELS[priority]} priority`}>
      {[5, 8, 12].map((height, index) => (
        <i
          key={height}
          className={`w-[3px] rounded-[1px] ${index < priority ? (priority === 3 ? 'bg-(--foreground)' : 'bg-(--muted)') : 'bg-(--border)'}`}
          style={{ height }}
        />
      ))}
    </span>
  )
}

const DUE_TONE: Record<ReturnType<typeof dueTone>, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-600 dark:text-amber-400',
  later: 'text-(--muted-light)',
  none: 'text-(--muted-light)',
}

export function DueLabel({ dueDate, done, today, className = '' }: { dueDate: string | null; done: boolean; today: string; className?: string }) {
  if (!dueDate || done) return null
  return <span className={`${DUE_TONE[dueTone(dueDate, done, today)]} ${className}`}>{formatWorkDate(dueDate, today)}</span>
}

/** A small label such as "Blocked"; `tone` picks the colour. */
export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'danger' | 'attention' }) {
  const tones = {
    neutral: 'bg-(--surface-subtle) text-(--muted)',
    danger: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
    attention: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
  } as const
  return <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] ${tones[tone]}`}>{children}</span>
}
