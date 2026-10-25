import 'server-only'

import type { WorkContext, WorkEvent, WorkItem, WorkPerson, WorkContextRef, WorkDoneWhen } from '@overlay/app-core'
import { WORK_CONTEXT_TYPES, WORK_DATE_PATTERN, WORK_STATUSES, isWorkDate } from '@/shared/work/status'
import { roomListScope } from './room-scope'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

const WORK_PATH = '/api/v1/work'
const PRIORITY_NUMBER = { low: 1, medium: 2, high: 3 } as const
const PRIORITY_LABEL = { 1: 'low', 2: 'medium', 3: 'high' } as const
type PriorityName = keyof typeof PRIORITY_NUMBER
type Failure = { success: false; error: string; conflict?: true; currentRevision?: string }
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; conflict?: true }
type TaskContext = Pick<WorkContext, 'principalId' | 'people'>

function attributionBody(options: OverlayToolsOptions): Record<string, string> {
  return options.agentPrincipalId ? { actingAgentPrincipalId: options.agentPrincipalId } : {}
}

function failure(error: unknown, fallback: string): Failure {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch((_error) => null) as { error?: string } | null
  return body?.error ?? fallback
}

async function getJson<T>(options: OverlayToolsOptions, path: string): Promise<ApiResult<T>> {
  const response = await callInternalApiGet(path, options.accessToken, options.baseUrl, options.forwardCookie, options.serverSecret, options.userId, options.workspaceId)
  if (!response.ok) return { ok: false, error: await responseError(response, 'Work request failed') }
  return { ok: true, data: await response.json() as T }
}

async function sendJson<T>(
  options: OverlayToolsOptions,
  path: string,
  body: Record<string, unknown>,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<ApiResult<T>> {
  const response = await callInternalApi(path, {
    ...toolAuthBody(options),
    ...attributionBody(options),
    ...body,
  }, options.accessToken, options.baseUrl, { method, forwardCookie: options.forwardCookie })
  if (!response.ok) {
    const error = await response.json().catch((_error) => null) as { error?: string; code?: string } | null
    return { ok: false, error: error?.error ?? 'Work request failed', ...(response.status === 409 && error?.code === 'work_conflict' ? { conflict: true as const } : {}) }
  }
  return { ok: true, data: await response.json() as T }
}

async function taskContext(options: OverlayToolsOptions): Promise<ApiResult<TaskContext>> {
  const result = await getJson<WorkContext>(options, `${WORK_PATH}/context`)
  return result.ok ? { ok: true, data: result.data } : result
}

function revisionOf(item: Pick<WorkItem, 'updatedAt'>): string {
  return String(item.updatedAt)
}

function optionsForPeople(people: readonly WorkPerson[]): string {
  const options = people.map((person) => `${person.displayName} (${person.principalId})`)
  return ['me', ...options].join(', ') || 'none'
}

class NameResolutionError extends Error {}

function resolvePerson(value: string | null | undefined, context: TaskContext, field: 'assignee' | 'reviewer'): WorkPerson | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const people = field === 'reviewer' ? context.people.filter((person) => person.type === 'human') : context.people
  const normalized = value.trim()
  if (normalized.toLowerCase() === 'me') {
    const own = people.find((person) => person.principalId === context.principalId)
    if (own) return own
  }
  const byId = people.find((person) => person.principalId === normalized)
  if (byId) return byId
  const matches = people.filter((person) => person.displayName.toLowerCase() === normalized.toLowerCase())
  if (matches.length === 1) return matches[0]
  const available = optionsForPeople(people)
  if (matches.length > 1) throw new NameResolutionError(`Ambiguous ${field} "${normalized}". Options: ${available}.`)
  throw new NameResolutionError(`Unknown ${field} "${normalized}". Options: ${available}.`)
}

function compactTask(item: WorkItem, people: readonly WorkPerson[]) {
  const assignee = people.find((person) => person.principalId === item.assigneePrincipalId)
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: PRIORITY_LABEL[item.priority],
    assignee: assignee?.displayName ?? null,
    dueDate: item.dueDate,
    scope: item.scope,
    revision: revisionOf(item),
  }
}

function fullTask(item: WorkItem, people: readonly WorkPerson[]) {
  return {
    ...item,
    priority: PRIORITY_LABEL[item.priority],
    assigneeName: people.find((person) => person.principalId === item.assigneePrincipalId)?.displayName ?? null,
    reviewerName: people.find((person) => person.userId === item.reviewerUserId)?.displayName ?? null,
    revision: revisionOf(item),
  }
}

async function fetchTask(options: OverlayToolsOptions, taskId: string): Promise<ApiResult<WorkItem>> {
  const result = await getJson<{ item: WorkItem }>(options, `${WORK_PATH}/${encodeURIComponent(taskId.trim())}`)
  return result.ok ? { ok: true, data: result.data.item } : result
}

export async function executeListTasks(
  options: OverlayToolsOptions,
  input: {
    scope?: 'personal' | 'workspace'
    status?: string | string[]
    assignee?: string
    query?: string
    includeDone?: boolean
    archived?: boolean
    limit?: number
  },
) {
  try {
    const scope = roomListScope(options, input.scope)
    const params = new URLSearchParams()
    if (input.archived) params.set('view', 'archived')
    else if (scope) params.set('view', scope)
    const [itemsResult, contextResult] = await Promise.all([
      getJson<{ items: WorkItem[] }>(options, `${WORK_PATH}${params.size ? `?${params}` : ''}`),
      taskContext(options),
    ])
    if (!itemsResult.ok) return { success: false, error: itemsResult.error }
    if (!contextResult.ok) return { success: false, error: contextResult.error }
    const statuses = input.status === undefined ? undefined : new Set(Array.isArray(input.status) ? input.status : [input.status])
    let assigneePrincipalId: string | undefined
    let agentPrincipalIds: Set<string> | undefined
    if (input.assignee?.toLowerCase() === 'agents') {
      agentPrincipalIds = new Set(contextResult.data.people.filter((person) => person.type === 'agent').map((person) => person.principalId))
    } else if (input.assignee !== undefined) {
      const person = resolvePerson(input.assignee, contextResult.data, 'assignee')
      if (person) assigneePrincipalId = person.principalId
    }
    const query = input.query?.trim().toLowerCase()
    const filtered = itemsResult.data.items.filter((item) => {
      if (input.archived && scope && item.scope !== scope) return false
      if (statuses && !statuses.has(item.status)) return false
      if (!input.archived && !input.includeDone && !statuses?.has('done') && item.status === 'done') return false
      if (query && !item.title.toLowerCase().includes(query)) return false
      if (agentPrincipalIds && (!item.assigneePrincipalId || !agentPrincipalIds.has(item.assigneePrincipalId))) return false
      if (assigneePrincipalId && item.assigneePrincipalId !== assigneePrincipalId) return false
      return true
    })
    const limit = Math.min(200, Math.max(1, input.limit ?? 50))
    return { success: true, tasks: filtered.slice(0, limit).map((item) => compactTask(item, contextResult.data.people)), count: Math.min(filtered.length, limit), truncated: filtered.length > limit }
  } catch (error) {
    return failure(error, 'Failed to list tasks')
  }
}

export async function executeGetTask(options: OverlayToolsOptions, input: { taskId: string }) {
  try {
    const [itemResult, contextResult] = await Promise.all([fetchTask(options, input.taskId), taskContext(options)])
    if (!itemResult.ok) return { success: false, error: itemResult.error }
    if (!contextResult.ok) return { success: false, error: contextResult.error }
    const eventsResult = await getJson<{ events: WorkEvent[] }>(options, `${WORK_PATH}/${encodeURIComponent(input.taskId.trim())}/events`)
    if (!eventsResult.ok) return { success: false, error: eventsResult.error }
    return {
      success: true,
      task: {
        ...fullTask(itemResult.data, contextResult.data.people),
        activity: eventsResult.data.events.slice(-20),
      },
    }
  } catch (error) {
    return failure(error, 'Failed to get task')
  }
}

function apiFields(input: {
  title?: string
  description?: string | null
  status?: string
  blocked?: boolean
  priority?: PriorityName
  assignee?: string | null
  reviewer?: string | null
  startDate?: string | null
  dueDate?: string | null
  parentId?: string | null
  blockedBy?: string[]
  doneWhen?: WorkDoneWhen[]
  context?: WorkContextRef[]
}, people?: TaskContext): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of ['title', 'description', 'blocked', 'startDate', 'dueDate', 'parentId', 'blockedBy', 'doneWhen', 'context'] as const) {
    if (input[key] !== undefined) fields[key] = input[key]
  }
  if (input.status !== undefined) fields.status = input.status
  if (input.priority !== undefined) fields.priority = PRIORITY_NUMBER[input.priority]
  if (input.assignee !== undefined && people) {
    const person = resolvePerson(input.assignee, people, 'assignee')
    fields.assigneePrincipalId = person?.principalId ?? null
  }
  if (input.reviewer !== undefined && people) {
    const person = resolvePerson(input.reviewer, people, 'reviewer')
    fields.reviewerUserId = person?.userId ?? null
  }
  return fields
}

function dateValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  if (!isWorkDate(value)) throw new NameResolutionError('Dates must use a valid YYYY-MM-DD value.')
  return value
}

export async function executeCreateTask(options: OverlayToolsOptions, input: {
  title: string
  scope?: 'personal' | 'workspace'
  description?: string
  status?: string
  priority?: PriorityName
  assignee?: string
  reviewer?: string
  startDate?: string | null
  dueDate?: string | null
  parentId?: string
  blockedBy?: string[]
  doneWhen?: WorkDoneWhen[]
  context?: WorkContextRef[]
  blocked?: boolean
}) {
  try {
    const contextResult = await taskContext(options)
    if (!contextResult.ok) return { success: false, error: contextResult.error }
    const fields = apiFields({ ...input, startDate: dateValue(input.startDate), dueDate: dateValue(input.dueDate) }, contextResult.data)
    delete fields.status
    for (const key of ['startDate', 'dueDate'] as const) if (fields[key] === null) delete fields[key]
    const response = await sendJson<{ item: WorkItem }>(options, WORK_PATH, {
      ...fields,
      title: input.title,
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.status ? { status: input.status } : {}),
    })
    if (!response.ok) return { success: false, error: response.error }
    return { success: true, task: fullTask(response.data.item, contextResult.data.people) }
  } catch (error) {
    return failure(error, 'Failed to create task')
  }
}

export async function executeUpdateTask(options: OverlayToolsOptions, input: {
  taskId: string
  revision?: string
  scope?: 'personal' | 'workspace'
  title?: string
  description?: string | null
  status?: string
  blocked?: boolean
  priority?: PriorityName
  assignee?: string | null
  reviewer?: string | null
  startDate?: string | null
  dueDate?: string | null
  parentId?: string | null
  blockedBy?: string[]
  doneWhen?: WorkDoneWhen[]
  context?: WorkContextRef[]
}) {
  try {
    let expectedUpdatedAt: number | undefined
    if (input.revision !== undefined) {
      expectedUpdatedAt = Number(input.revision)
      if (!input.revision.trim() || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { success: false, error: 'Use the revision returned by get_task.' }
      }
    }
    const contextResult = await taskContext(options)
    if (!contextResult.ok) return { success: false, error: contextResult.error }
    const fields = apiFields({
      ...input,
      startDate: dateValue(input.startDate),
      dueDate: dateValue(input.dueDate),
    }, contextResult.data)
    if (input.scope !== undefined) fields.scope = input.scope
    if (expectedUpdatedAt !== undefined) fields.expectedUpdatedAt = expectedUpdatedAt
    const result = Object.keys(fields).length > 0
      ? await sendJson<{ item: WorkItem }>(options, `${WORK_PATH}/${encodeURIComponent(input.taskId.trim())}`, fields, 'PATCH')
      : await getJson<{ item: WorkItem }>(options, `${WORK_PATH}/${encodeURIComponent(input.taskId.trim())}`)
    if (!result.ok) {
      if (result.conflict) {
        const current = await fetchTask(options, input.taskId)
        return { success: false, conflict: true, ...(current.ok ? { currentRevision: revisionOf(current.data) } : {}) }
      }
      return { success: false, error: result.error }
    }
    return { success: true, task: fullTask(result.data.item, contextResult.data.people) }
  } catch (error) {
    return failure(error, 'Failed to update task')
  }
}

export async function executeCommentOnTask(options: OverlayToolsOptions, input: { taskId: string; body: string }) {
  try {
    const result = await sendJson<{ success: boolean }>(options, `${WORK_PATH}/${encodeURIComponent(input.taskId.trim())}/events`, { body: input.body })
    return result.ok ? { success: true, taskId: input.taskId.trim() } : { success: false, error: result.error }
  } catch (error) {
    return failure(error, 'Failed to comment on task')
  }
}

async function executeTaskScopeAction(options: OverlayToolsOptions, taskId: string, action: 'archive' | 'restore') {
  try {
    const result = await sendJson<{ success: boolean }>(options, '/api/v1/scope', { resource: 'work', id: taskId.trim(), action })
    return result.ok ? { success: true, taskId: taskId.trim() } : { success: false, error: result.error }
  } catch (error) {
    return failure(error, `Failed to ${action} task`)
  }
}

export function executeArchiveTask(options: OverlayToolsOptions, input: { taskId: string }) {
  return executeTaskScopeAction(options, input.taskId, 'archive')
}

export function executeRestoreTask(options: OverlayToolsOptions, input: { taskId: string }) {
  return executeTaskScopeAction(options, input.taskId, 'restore')
}

export const TASK_STATUS_VALUES = WORK_STATUSES
export const TASK_CONTEXT_TYPES = WORK_CONTEXT_TYPES
export const TASK_DATE_PATTERN = WORK_DATE_PATTERN
