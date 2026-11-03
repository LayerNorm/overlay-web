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
import { logger } from '@/server/observability/logger'
import { workAssignmentMessage } from '@/shared/work/assignment-message'
import { startWorkspaceAgentTurns } from '@/server/agents/start-agent-turns'
import { requireWorkspaceExecution, WorkspaceExecutionError } from '@/server/billing/WorkspaceExecutionPolicy'
import { parseWorkErrorReason, workErrorMessage, workErrorStatus } from '@/shared/work/errors'
import type { WorkRepository } from './WorkRepository'

/** A refusal with the HTTP status and plain message to send back. */
export class WorkServiceError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'WorkServiceError'
  }
}

type Actor = { userId: string; workspaceId: string; actingAgentPrincipalId?: string }

/**
 * Tasks. Who may see or change what is decided in Convex (the shared Personal / Workspace rules); this turns its
 * refusals into messages the app can show and keeps the HTTP layer thin.
 */
export class WorkService {
  constructor(
    private readonly repository: WorkRepository,
    private readonly dispatchAssignment: typeof startWorkspaceAgentTurns = startWorkspaceAgentTurns,
    private readonly requireExecution: typeof requireWorkspaceExecution = requireWorkspaceExecution,
  ) {}

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

  async create(args: Actor & { input: CreateWorkItemRequest }): Promise<WorkItem> {
    const item = await this.guard(() => this.repository.create(args))
    return args.input.assigneePrincipalId
      ? this.dispatchIfAgentAssigned(args, item, args.input.assigneePrincipalId)
      : item
  }

  async update(args: Actor & { id: string; input: UpdateWorkItemRequest }): Promise<WorkItem> {
    const item = await this.guard(() => this.repository.update(args))
    return args.input.assigneePrincipalId
      ? this.dispatchIfAgentAssigned(args, item, args.input.assigneePrincipalId)
      : item
  }

  private async dispatchIfAgentAssigned(args: Actor, item: WorkItem, assigneePrincipalId: string): Promise<WorkItem> {
    const context = await this.context(args)
    if (!context.people.some((person) => person.principalId === assigneePrincipalId && person.type === 'agent')) {
      if (item.assignmentExecution) {
        throw new WorkServiceError(
          `Task ${item.id} was saved, but its assigned agent is no longer available or visible. Restore its availability or assign another agent.`,
          409,
          'work_agent_unavailable',
        )
      }
      return item
    }
    const generation = item.assignmentExecution?.generation ?? item.updatedAt
    const startedReplay = item.assignmentExecution?.status === 'started'
      && item.assignmentExecution.assigneePrincipalId === assigneePrincipalId
      && Number.isSafeInteger(item.assignmentExecution.generation)
      && item.assignmentExecution.generation === generation
    try {
      await this.requireExecution({
        userId: args.userId,
        workspaceId: args.workspaceId,
        checkBudget: !startedReplay,
      })
    } catch (error) {
      if (error instanceof WorkspaceExecutionError) {
        throw new WorkServiceError(error.message, error.statusCode, error.payload.code)
      }
      throw error
    }
    const prepared = await this.guard(() => this.repository.prepareAssignment({
      ...args,
      id: item.id,
      assigneePrincipalId,
      generation,
      content: workAssignmentMessage(item),
    }))
    if (!prepared) {
      throw new WorkServiceError(`Task ${item.id} was saved, but its assignment changed before the agent could start. No agent was launched.`, 409, 'work_assignment_changed')
    }
    const { execution, claimed } = prepared
    if (execution.assigneePrincipalId !== assigneePrincipalId || execution.generation !== generation) {
      throw new WorkServiceError(`Task ${item.id} was saved, but its assignment changed before the agent could start. No agent was launched.`, 409, 'work_assignment_changed')
    }
    if (!claimed) {
      if (execution.status === 'starting') {
        throw new WorkServiceError(`Task ${item.id} was saved; agent startup is already in progress.`, 409, 'work_assignment_in_progress')
      }
      if (execution.status === 'failed') {
        throw new WorkServiceError(
          execution.error ?? `Task ${item.id} was saved, but the agent start could not be confirmed. Check its agent thread before clearing or reassigning.`,
          502,
          'work_agent_start_failed',
        )
      }
      return item
    }
    if (!execution.conversationId || !execution.messageId || !execution.turnId) {
      throw new WorkServiceError(`Task ${item.id} was saved, but its agent assignment could not be prepared.`, 502, 'work_agent_start_failed')
    }
    try {
      await this.dispatchAssignment({
        actorUserId: args.userId,
        conversationId: execution.conversationId,
        messageId: execution.messageId,
        mentionedPrincipalIds: [assigneePrincipalId],
        initiatorPrincipalId: context.principalId,
        prompt: workAssignmentMessage(item),
        memoryEnabled: true,
        turnId: execution.turnId,
        workspaceId: args.workspaceId,
        strictErrors: true,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 300) : 'Agent startup failed.'
      const failure = `Task ${item.id} was saved, but the agent start could not be confirmed: ${detail} Check its agent thread before clearing or reassigning.`
      await this.repository.completeAssignment({
        ...args,
        id: item.id,
        assigneePrincipalId,
        generation,
        status: 'failed',
        error: failure,
      }).catch((_error) => {
        logger.error('Failed to persist work assignment startup failure', {
          taskId: item.id,
          generation,
        })
      })
      throw new WorkServiceError(failure, 502, 'work_agent_start_failed')
    }

    let completed: boolean
    try {
      completed = await this.repository.completeAssignment({
        ...args,
        id: item.id,
        assigneePrincipalId,
        generation,
        status: 'started',
      })
    } catch (_error) {
      logger.error('Failed to persist work assignment startup confirmation', {
        taskId: item.id,
        generation,
      })
      throw new WorkServiceError(
        `Task ${item.id} was saved and agent startup was requested, but its status could not be confirmed. Do not clear or reassign it; check its agent thread before retrying.`,
        503,
        'work_assignment_unconfirmed',
      )
    }
    if (!completed) {
      throw new WorkServiceError(
        `Task ${item.id} was saved and agent startup was requested, but the assignment changed before confirmation. Check its agent thread before retrying.`,
        409,
        'work_assignment_changed',
      )
    }
    return { ...item, assignmentExecution: { ...execution, status: 'started' } }
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
