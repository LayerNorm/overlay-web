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

type Actor = { userId: string; workspaceId: string; actingAgentPrincipalId?: string }

export interface WorkRepository {
  list(args: Actor & { view?: ResourceView }): Promise<WorkItem[]>
  get(args: Actor & { id: string }): Promise<WorkItem | null>
  context(args: Actor): Promise<WorkContext | null>
  create(args: Actor & { input: CreateWorkItemRequest }): Promise<WorkItem>
  update(args: Actor & { id: string; input: UpdateWorkItemRequest }): Promise<WorkItem>
  move(args: Actor & { id: string; input: MoveWorkItemRequest }): Promise<WorkItem>
  listEvents(args: Actor & { id: string }): Promise<WorkEvent[]>
  addComment(args: Actor & { id: string; body: string }): Promise<void>
  /** Deletes an archived task for good. */
  remove(args: Actor & { id: string }): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_archived' | 'forbidden' }>
}
