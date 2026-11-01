import 'server-only'

import type {
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  ResourceView,
  UpdateWorkItemRequest,
  WorkAssignmentExecution,
  WorkContext,
  WorkEvent,
  WorkItem,
} from '@overlay/app-core'

type Actor = { userId: string; workspaceId: string; actingAgentPrincipalId?: string }

export interface WorkRepository {
  list(args: Actor & { view?: ResourceView }): Promise<WorkItem[]>
  get(args: Actor & { id: string }): Promise<WorkItem | null>
  context(args: Actor): Promise<WorkContext | null>
  create(args: Actor & { input: CreateWorkItemRequest }): Promise<WorkItem>
  update(args: Actor & { id: string; input: UpdateWorkItemRequest }): Promise<WorkItem>
  prepareAssignment(args: Actor & {
    id: string
    assigneePrincipalId: string
    generation: number
    content: string
  }): Promise<{ execution: WorkAssignmentExecution; claimed: boolean } | null>
  completeAssignment(args: Actor & {
    id: string
    assigneePrincipalId: string
    generation: number
    status: 'started' | 'failed'
    error?: string
  }): Promise<boolean>
  move(args: Actor & { id: string; input: MoveWorkItemRequest }): Promise<WorkItem>
  listEvents(args: Actor & { id: string }): Promise<WorkEvent[]>
  addComment(args: Actor & { id: string; body: string }): Promise<void>
  /** Deletes an archived task for good. */
  remove(args: Actor & { id: string }): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_archived' | 'forbidden' }>
}
