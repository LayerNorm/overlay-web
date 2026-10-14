/**
 * Turns a task's log into sentences: "Sam moved this to In review", "Mercedes assigned this to Research Agent".
 */
import type { WorkEvent, WorkEventKind, WorkPerson } from '@overlay/app-core'
import { formatWorkDateRange } from './dates'
import { WORK_PRIORITY_LABELS, WORK_STATUS_LABELS, parseWorkPriority, parseWorkStatus } from './status'

export type ActivityPeople = {
  byPrincipal: ReadonlyMap<string, Pick<WorkPerson, 'displayName'>>
  byUserId: ReadonlyMap<string, Pick<WorkPerson, 'displayName'>>
  /** The viewer's principal id, so their own actions read "You". */
  viewerPrincipalId: string | null
}

export function indexPeople(people: readonly WorkPerson[]): Pick<ActivityPeople, 'byPrincipal' | 'byUserId'> {
  return {
    byPrincipal: new Map(people.map((person) => [person.principalId, person])),
    byUserId: new Map(people.flatMap((person) => (person.userId ? [[person.userId, person] as const] : []))),
  }
}

export function actorName(event: Pick<WorkEvent, 'actorPrincipalId'>, people: ActivityPeople): string {
  if (people.viewerPrincipalId && event.actorPrincipalId === people.viewerPrincipalId) return 'You'
  return people.byPrincipal.get(event.actorPrincipalId)?.displayName ?? 'Someone'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

type Describer = (data: Record<string, unknown>, people: ActivityPeople) => string | null

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

const quote = (titles: string[]) => titles.map((title) => `“${title}”`).join(', ')

const DESCRIBERS: Record<WorkEventKind, Describer> = {
  created: () => 'created this task',
  status: (data) => {
    const to = parseWorkStatus(data.to)
    return to ? `moved this to ${WORK_STATUS_LABELS[to]}` : 'changed the status'
  },
  assignee: (data, people) => {
    const to = text(data.to)
    if (!to) return 'unassigned this'
    if (to === people.viewerPrincipalId) return 'assigned this to themselves'
    const name = people.byPrincipal.get(to)?.displayName
    return name ? `assigned this to ${name}` : 'changed the owner'
  },
  reviewer: (data, people) => {
    const to = text(data.to)
    if (!to) return 'removed the reviewer'
    const name = people.byUserId.get(to)?.displayName
    return name ? `asked ${name} to review` : 'changed the reviewer'
  },
  priority: (data) => {
    const to = parseWorkPriority(data.to)
    return to ? `set the priority to ${WORK_PRIORITY_LABELS[to]}` : 'changed the priority'
  },
  dates: (data) => {
    const range = formatWorkDateRange(text(data.startDate), text(data.dueDate))
    return range ? `set the dates: ${range}` : 'cleared the dates'
  },
  title: (data) => {
    const from = text(data.from)
    const to = text(data.to)
    return from && to ? `renamed this from “${from}” to “${to}”` : 'renamed this'
  },
  blocked: (data) => (data.to === true ? 'marked this as blocked' : 'cleared the blocked flag'),
  dependencies: (data) => {
    const added = strings(data.added)
    const removed = strings(data.removed)
    if (added.length > 0 && removed.length === 0) return `made this wait on ${quote(added)}`
    if (removed.length > 0 && added.length === 0) return `no longer waits on ${quote(removed)}`
    return 'changed what this waits on'
  },
  scope: (data) => (data.to === 'workspace' ? 'moved this to the Workspace' : 'moved this to Personal'),
  archived: () => 'archived this',
  restored: () => 'restored this',
  comment: () => null,
}

/** What happened, without the actor: "moved this to In review". Null for a comment (it renders as its own text). */
export function describeEvent(event: Pick<WorkEvent, 'kind' | 'data'>, people: ActivityPeople): string | null {
  const describe = DESCRIBERS[event.kind] as Describer | undefined
  return describe ? describe(event.data ?? {}, people) : 'updated this'
}

export function commentBody(event: Pick<WorkEvent, 'kind' | 'data'>): string | null {
  return event.kind === 'comment' ? text(event.data?.body) : null
}

/** "just now", "12m", "3h", "2d", then a date. */
export function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
