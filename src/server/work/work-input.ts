import type {
  AddWorkCommentRequest,
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  UpdateWorkItemRequest,
  WorkContextRef,
  WorkDoneWhen,
} from '@overlay/app-core'
import { parseResourceScope } from '@/shared/workspaces/resource-scope'
import { WORK_CONTEXT_TYPES, parseWorkPriority, parseWorkStatus } from '@/shared/work/status'

/** A request body the API refuses; carries the plain message to send back. */
export class WorkInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkInputError'
  }
}

type Body = Record<string, unknown>

function isBody(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(body: Body, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new WorkInputError(`${key} must be text.`)
  return value
}

/** A string, `null` to clear, or undefined to leave alone. */
function clearableText(body: Body, key: string): string | null | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new WorkInputError(`${key} must be text or null.`)
  return value
}

function status(body: Body) {
  if (body.status === undefined) return undefined
  const parsed = parseWorkStatus(body.status)
  if (!parsed) throw new WorkInputError('status must be backlog, todo, progress, review or done.')
  return parsed
}

function priority(body: Body) {
  if (body.priority === undefined) return undefined
  const parsed = parseWorkPriority(body.priority)
  if (!parsed) throw new WorkInputError('priority must be 1, 2 or 3.')
  return parsed
}

function doneWhen(body: Body): WorkDoneWhen[] | undefined {
  if (body.doneWhen === undefined) return undefined
  if (!Array.isArray(body.doneWhen)) throw new WorkInputError('doneWhen must be a list.')
  return body.doneWhen.map((item) => {
    if (!isBody(item) || typeof item.text !== 'string' || (item.checked !== undefined && typeof item.checked !== 'boolean')) {
      throw new WorkInputError('Each doneWhen item needs text and an optional checked flag.')
    }
    return { text: item.text, checked: item.checked === true }
  })
}

function blockedBy(body: Body): string[] | undefined {
  if (body.blockedBy === undefined) return undefined
  if (!Array.isArray(body.blockedBy) || body.blockedBy.some((id) => typeof id !== 'string' || !id)) {
    throw new WorkInputError('blockedBy must be a list of task ids.')
  }
  return body.blockedBy as string[]
}

function contextRefs(body: Body): WorkContextRef[] | undefined {
  if (body.context === undefined) return undefined
  if (!Array.isArray(body.context)) throw new WorkInputError('context must be a list.')
  return body.context.map((item) => {
    if (!isBody(item) || typeof item.id !== 'string' || typeof item.label !== 'string'
      || !(WORK_CONTEXT_TYPES as readonly unknown[]).includes(item.type)) {
      throw new WorkInputError('Each context item needs a type (file, note, chat or link), an id and a label.')
    }
    return { type: item.type as WorkContextRef['type'], id: item.id, label: item.label }
  })
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

export function parseCreateWorkItem(body: unknown): CreateWorkItemRequest {
  if (!isBody(body)) throw new WorkInputError('Send a JSON body.')
  const title = text(body, 'title')
  if (title === undefined) throw new WorkInputError('title is required.')
  if (body.scope !== undefined && !parseResourceScope(body.scope)) throw new WorkInputError("scope must be 'personal' or 'workspace'.")
  if (body.blocked !== undefined && typeof body.blocked !== 'boolean') throw new WorkInputError('blocked must be true or false.')
  return defined({
    title,
    scope: parseResourceScope(body.scope),
    description: text(body, 'description'),
    status: status(body),
    blocked: body.blocked as boolean | undefined,
    priority: priority(body),
    assigneePrincipalId: text(body, 'assigneePrincipalId'),
    reviewerUserId: text(body, 'reviewerUserId'),
    startDate: text(body, 'startDate'),
    dueDate: text(body, 'dueDate'),
    parentId: text(body, 'parentId'),
    blockedBy: blockedBy(body),
    doneWhen: doneWhen(body),
    context: contextRefs(body),
  })
}

export function parseUpdateWorkItem(body: unknown): UpdateWorkItemRequest {
  if (!isBody(body)) throw new WorkInputError('Send a JSON body.')
  if (body.blocked !== undefined && typeof body.blocked !== 'boolean') throw new WorkInputError('blocked must be true or false.')
  return defined({
    title: text(body, 'title'),
    description: clearableText(body, 'description'),
    status: status(body),
    blocked: body.blocked as boolean | undefined,
    priority: priority(body),
    assigneePrincipalId: clearableText(body, 'assigneePrincipalId'),
    reviewerUserId: clearableText(body, 'reviewerUserId'),
    startDate: clearableText(body, 'startDate'),
    dueDate: clearableText(body, 'dueDate'),
    parentId: clearableText(body, 'parentId'),
    blockedBy: blockedBy(body),
    doneWhen: doneWhen(body),
    context: contextRefs(body),
  })
}

export function parseMoveWorkItem(body: unknown): MoveWorkItemRequest {
  if (!isBody(body)) throw new WorkInputError('Send a JSON body.')
  return defined({
    status: status(body),
    afterId: clearableText(body, 'afterId'),
    beforeId: clearableText(body, 'beforeId'),
  })
}

export function parseAddWorkComment(body: unknown): AddWorkCommentRequest {
  if (!isBody(body)) throw new WorkInputError('Send a JSON body.')
  const comment = text(body, 'body')
  if (comment === undefined) throw new WorkInputError('body is required.')
  return { body: comment }
}
