import type { CreateWorkItemRequest, WorkItem, WorkPerson } from '@overlay/app-core'
import { validateWorkDates, validateWorkTitle, WORK_LIMITS } from '../../src/shared/work/status'

export { filterWork, groupByStatus } from '../../src/shared/work/query'
export type { WorkFilter } from '../../src/shared/work/query'
export { WORK_STATUS_LABELS, WORK_STATUSES } from '../../src/shared/work/status'
export { formatWorkDate, toWorkDate, addDays } from '../../src/shared/work/dates'
export {
  actorName,
  describeEvent,
  commentBody,
  formatAgo,
  indexPeople,
} from '../../src/shared/work/activity'
export { canWorkOnItem } from '../../src/shared/work/permissions'

export function availableWorkPeople(
  people: readonly WorkPerson[],
  scope: 'personal' | 'workspace',
  principalId: string,
) {
  return people.filter((person) =>
    person.type === 'human'
      ? scope !== 'personal' || person.principalId === principalId
      : scope !== 'workspace' || person.agentVisibility !== 'creator',
  )
}

export function workRequest(
  text: string,
  input: Omit<CreateWorkItemRequest, 'title'>,
): CreateWorkItemRequest {
  const [first, ...lines] = text.replace(/\r\n?/g, '\n').split('\n')
  const title = first.trim()
  const description = lines.join('\n').trim()
  const error = validateWorkTitle(title) || validateWorkDates(input.startDate, input.dueDate)
  if (error) throw new Error(error)
  if (description.length > WORK_LIMITS.description)
    throw new Error(`Descriptions can be up to ${WORK_LIMITS.description} characters.`)
  return { ...input, title, ...(description ? { description } : {}) }
}

export function dependencyChoices(items: readonly WorkItem[], currentId?: string) {
  return items.filter((item) => item.archivedAt === null && item.id !== currentId)
}
