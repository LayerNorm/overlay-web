import 'server-only'

import type {
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  ResourceView,
  UpdateWorkItemRequest,
  WorkContext,
  WorkEvent,
  WorkItem,
  WorkAssignmentExecution,
} from '@overlay/app-core'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { WorkRepository } from './WorkRepository'
import { workEventView, workItemView } from '@/shared/work/projection'

type WorkItemDoc = Doc<'workItems'>
type WorkEventDoc = Doc<'workItemEvents'>
type ContextResult = {
  principalId: string
  role: WorkContext['role']
  canCreateInWorkspace: boolean
  assignees: Array<{
    principalId: string
    type: 'human' | 'agent' | 'service'
    userId: string | null
    displayName: string
    photoUrl?: string
    agentVisibility?: 'workspace' | 'creator'
    avatarColor?: string
    avatarShape?: string
    isDefault?: boolean
  }>
}

export const mapWorkItemDoc = (doc: WorkItemDoc): WorkItem => workItemView(doc)
export const mapWorkEventDoc = (doc: WorkEventDoc): WorkEvent => workEventView(doc)

export class ConvexWorkRepository implements WorkRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  private base(args: { userId: string; workspaceId: string }) {
    return { userId: args.userId, workspaceId: args.workspaceId, serverSecret: this.serverSecret }
  }

  async list(args: { userId: string; workspaceId: string; view?: ResourceView }): Promise<WorkItem[]> {
    const rows = await convex.query<WorkItemDoc[]>('work/workItems:list', {
      ...this.base(args),
      ...(args.view ? { view: args.view } : {}),
    }, { throwOnError: true })
    return (rows ?? []).map(mapWorkItemDoc)
  }

  async get(args: { userId: string; workspaceId: string; id: string }): Promise<WorkItem | null> {
    const doc = await convex.query<WorkItemDoc | null>('work/workItems:get', { ...this.base(args), id: args.id }, { throwOnError: true })
    return doc ? mapWorkItemDoc(doc) : null
  }

  async context(args: { userId: string; workspaceId: string }): Promise<WorkContext | null> {
    const result = await convex.query<ContextResult | null>('work/workItems:context', this.base(args), { throwOnError: true })
    if (!result) return null
    return {
      principalId: result.principalId,
      role: result.role,
      canCreateInWorkspace: result.canCreateInWorkspace,
      people: result.assignees.filter((a): a is typeof a & { type: 'human' | 'agent' } => a.type !== 'service'),
    }
  }

  async create(args: { userId: string; workspaceId: string; input: CreateWorkItemRequest; actingAgentPrincipalId?: string }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:create', { ...this.base(args), ...args.input, ...(args.actingAgentPrincipalId ? { actingAgentPrincipalId: args.actingAgentPrincipalId } : {}) }, { throwOnError: true })
    if (!doc) throw new Error('Failed to create task')
    return mapWorkItemDoc(doc)
  }

  async update(args: { userId: string; workspaceId: string; id: string; input: UpdateWorkItemRequest; actingAgentPrincipalId?: string }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:update', { ...this.base(args), id: args.id, ...args.input, ...(args.actingAgentPrincipalId ? { actingAgentPrincipalId: args.actingAgentPrincipalId } : {}) }, { throwOnError: true })
    if (!doc) throw new Error('Failed to update task')
    return mapWorkItemDoc(doc)
  }

  async prepareAssignment(args: {
    userId: string
    workspaceId: string
    id: string
    assigneePrincipalId: string
    generation: number
    content: string
  }): Promise<{ execution: WorkAssignmentExecution; claimed: boolean } | null> {
    return await convex.mutation<{ execution: WorkAssignmentExecution; claimed: boolean } | null>(
      'work/workItems:prepareAssignment',
      { ...this.base(args), id: args.id, assigneePrincipalId: args.assigneePrincipalId, generation: args.generation, content: args.content },
      { throwOnError: true },
    )
  }

  async completeAssignment(args: {
    userId: string
    workspaceId: string
    id: string
    assigneePrincipalId: string
    generation: number
    status: 'started' | 'failed'
    error?: string
  }): Promise<boolean> {
    return await convex.mutation<boolean>(
      'work/workItems:completeAssignment',
      { ...this.base(args), id: args.id, assigneePrincipalId: args.assigneePrincipalId, generation: args.generation, status: args.status, ...(args.error ? { error: args.error } : {}) },
      { throwOnError: true },
    ) ?? false
  }

  async move(args: { userId: string; workspaceId: string; id: string; input: MoveWorkItemRequest; actingAgentPrincipalId?: string }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:move', { ...this.base(args), id: args.id, ...args.input, ...(args.actingAgentPrincipalId ? { actingAgentPrincipalId: args.actingAgentPrincipalId } : {}) }, { throwOnError: true })
    if (!doc) throw new Error('Failed to move task')
    return mapWorkItemDoc(doc)
  }

  async listEvents(args: { userId: string; workspaceId: string; id: string }): Promise<WorkEvent[]> {
    const rows = await convex.query<WorkEventDoc[]>('work/workItemEvents:list', { ...this.base(args), workItemId: args.id }, { throwOnError: true })
    return (rows ?? []).map(mapWorkEventDoc)
  }

  async remove(args: { userId: string; workspaceId: string; id: string }): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_archived' | 'forbidden' }> {
    const outcome = await convex.mutation<{ ok: true } | { ok: false; reason: 'not_found' | 'not_archived' | 'forbidden' }>('work/workItems:remove', { ...this.base(args), id: args.id }, { throwOnError: true })
    if (!outcome) throw new Error('Failed to delete task')
    return outcome
  }

  async addComment(args: { userId: string; workspaceId: string; id: string; body: string; actingAgentPrincipalId?: string }): Promise<void> {
    await convex.mutation('work/workItemEvents:addComment', { ...this.base(args), workItemId: args.id, body: args.body, ...(args.actingAgentPrincipalId ? { actingAgentPrincipalId: args.actingAgentPrincipalId } : {}) }, { throwOnError: true })
  }
}
