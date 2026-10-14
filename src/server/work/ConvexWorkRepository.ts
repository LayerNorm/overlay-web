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
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { WorkRepository } from './WorkRepository'

type WorkItemDoc = Doc<'workItems'>
type WorkEventDoc = Doc<'workItemEvents'>
type ContextResult = {
  principalId: string
  role: WorkContext['role']
  canCreateInWorkspace: boolean
  assignees: Array<{ principalId: string; type: 'human' | 'agent' | 'service'; userId: string | null; displayName: string }>
}

export function mapWorkItemDoc(doc: WorkItemDoc): WorkItem {
  return {
    id: doc._id,
    workspaceId: doc.workspaceId,
    scope: doc.archivedAt !== undefined ? (doc.archivedFromScope ?? doc.scope) : doc.scope,
    createdBy: doc.userId,
    title: doc.title,
    description: doc.description ?? null,
    status: doc.status,
    blocked: doc.blocked,
    priority: doc.priority === 1 || doc.priority === 3 ? doc.priority : 2,
    rank: doc.rank,
    assigneePrincipalId: doc.assigneePrincipalId ?? null,
    reviewerUserId: doc.reviewerUserId ?? null,
    startDate: doc.startDate ?? null,
    dueDate: doc.dueDate ?? null,
    parentId: doc.parentId ?? null,
    blockedBy: doc.blockedBy ?? [],
    doneWhen: doc.doneWhen ?? [],
    context: doc.context ?? [],
    archivedAt: doc.archivedAt ?? null,
    archivedFromScope: doc.archivedFromScope ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export function mapWorkEventDoc(doc: WorkEventDoc): WorkEvent {
  const data = doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data) ? (doc.data as Record<string, unknown>) : null
  return {
    id: doc._id,
    workItemId: doc.workItemId,
    actorPrincipalId: doc.actorPrincipalId,
    kind: doc.kind,
    data,
    createdAt: doc.createdAt,
  }
}

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

  async create(args: { userId: string; workspaceId: string; input: CreateWorkItemRequest }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:create', { ...this.base(args), ...args.input }, { throwOnError: true })
    if (!doc) throw new Error('Failed to create task')
    return mapWorkItemDoc(doc)
  }

  async update(args: { userId: string; workspaceId: string; id: string; input: UpdateWorkItemRequest }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:update', { ...this.base(args), id: args.id, ...args.input }, { throwOnError: true })
    if (!doc) throw new Error('Failed to update task')
    return mapWorkItemDoc(doc)
  }

  async move(args: { userId: string; workspaceId: string; id: string; input: MoveWorkItemRequest }): Promise<WorkItem> {
    const doc = await convex.mutation<WorkItemDoc | null>('work/workItems:move', { ...this.base(args), id: args.id, ...args.input }, { throwOnError: true })
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

  async addComment(args: { userId: string; workspaceId: string; id: string; body: string }): Promise<void> {
    await convex.mutation('work/workItemEvents:addComment', { ...this.base(args), workItemId: args.id, body: args.body }, { throwOnError: true })
  }
}
