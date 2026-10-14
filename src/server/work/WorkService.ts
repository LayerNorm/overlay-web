import 'server-only'

import type {
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  ResourceView,
  UpdateWorkItemRequest,
  WorkContext,
  WorkEvent,
  WorkItem,
} from '@overlay/app-core'
import { parseWorkErrorReason, workErrorMessage, workErrorStatus } from '@/shared/work/errors'
import type { WorkRepository } from './WorkRepository'

/** A refusal with the HTTP status and plain message to send back. */
export class WorkServiceError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'WorkServiceError'
  }
}

type Actor = { userId: string; workspaceId: string }

/**
 * Tasks. Who may see or change what is decided in Convex (the shared Personal / Workspace rules); this turns its
 * refusals into messages the app can show and keeps the HTTP layer thin.
 */
export class WorkService {
  constructor(private readonly repository: WorkRepository) {}

  /** Runs a repository call and translates Convex's refusals. */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      throw translateWorkError(error)
    }
  }

  list(args: Actor & { view?: ResourceView }): Promise<WorkItem[]> {
    return this.guard(() => this.repository.list(args))
  }

  async get(args: Actor & { id: string }): Promise<WorkItem> {
    const item = await this.guard(() => this.repository.get(args))
    if (!item) throw new WorkServiceError('Task not found.', 404, 'work_not_found')
    return item
  }

  async context(args: Actor): Promise<WorkContext> {
    const context = await this.guard(() => this.repository.context(args))
    if (!context) throw new WorkServiceError('You do not have access to Work in this workspace.', 403, 'work_forbidden')
    return context
  }

  create(args: Actor & { input: CreateWorkItemRequest }): Promise<WorkItem> {
    return this.guard(() => this.repository.create(args))
  }

  update(args: Actor & { id: string; input: UpdateWorkItemRequest }): Promise<WorkItem> {
    return this.guard(() => this.repository.update(args))
  }

  move(args: Actor & { id: string; input: MoveWorkItemRequest }): Promise<WorkItem> {
    return this.guard(() => this.repository.move(args))
  }

  async listEvents(args: Actor & { id: string }): Promise<WorkEvent[]> {
    // Events of a task the caller cannot see come back empty from Convex; say not found instead.
    await this.get(args)
    return this.guard(() => this.repository.listEvents(args))
  }

  addComment(args: Actor & { id: string; body: string }): Promise<void> {
    return this.guard(() => this.repository.addComment(args))
  }

  /** Deletes an archived task for good. An active task has to be archived first. */
  async remove(args: Actor & { id: string }): Promise<void> {
    const outcome = await this.guard(() => this.repository.remove(args))
    if (outcome.ok) return
    if (outcome.reason === 'not_found') throw new WorkServiceError('Task not found.', 404, 'work_not_found')
    if (outcome.reason === 'not_archived') throw new WorkServiceError('Archive the task before deleting it.', 409, 'work_not_archived')
    throw new WorkServiceError('You do not have access to delete this task.', 403, 'work_forbidden')
  }
}

export function translateWorkError(error: unknown): Error {
  if (error instanceof WorkServiceError) return error
  const reason = parseWorkErrorReason(error)
  if (reason) return new WorkServiceError(workErrorMessage(reason), workErrorStatus(reason), `work_${reason}`)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('RESOURCE_SCOPE_FORBIDDEN:workspace_creation_restricted')) {
    return new WorkServiceError('Only owners and admins can create tasks in this workspace.', 403, 'resource_scope_forbidden')
  }
  if (message.includes('RESOURCE_SCOPE_FORBIDDEN:workspace_required')) {
    return new WorkServiceError('Choose a workspace first.', 403, 'resource_scope_forbidden')
  }
  if (message.includes('Unauthorized')) {
    return new WorkServiceError('You do not have access to change this task.', 403, 'work_forbidden')
  }
  return error instanceof Error ? error : new Error('Work request failed')
}
