import type { WorkAssignmentExecution, WorkEvent, WorkItem } from '@overlay/app-core'

/** The stored task fields the app reads; Convex `workItems` documents satisfy it. */
export interface WorkItemRow {
  _id: string
  workspaceId: string
  scope?: WorkItem['scope']
  archivedFromScope?: WorkItem['scope']
  userId: string
  title: string
  description?: string
  status: WorkItem['status']
  blocked: boolean
  priority: number
  rank: string
  assigneePrincipalId?: string
  reviewerUserId?: string
  startDate?: string
  dueDate?: string
  parentId?: string
  blockedBy?: string[]
  doneWhen?: WorkItem['doneWhen']
  context?: WorkItem['context']
  archivedAt?: number
  createdAt: number
  updatedAt: number
  assignmentExecution?: Record<string, unknown> & { conversationId?: unknown; messageId?: unknown }
}

/** The stored activity fields the app reads; Convex `workItemEvents` documents satisfy it. */
export interface WorkEventRow {
  _id: string
  workItemId: string
  actorPrincipalId: string
  kind: WorkEvent['kind']
  data?: unknown
  createdAt: number
}

/** A task as every client sees it, from the web routes or the live Convex queries. */
export function workItemView(doc: WorkItemRow): WorkItem {
  return {
    id: doc._id,
    workspaceId: doc.workspaceId,
    scope: (doc.archivedAt !== undefined ? (doc.archivedFromScope ?? doc.scope) : doc.scope) as WorkItem['scope'],
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
    ...(doc.assignmentExecution ? {
      assignmentExecution: {
        ...doc.assignmentExecution,
        ...(doc.assignmentExecution.conversationId ? { conversationId: String(doc.assignmentExecution.conversationId) } : {}),
        ...(doc.assignmentExecution.messageId ? { messageId: String(doc.assignmentExecution.messageId) } : {}),
      } as WorkAssignmentExecution,
    } : {}),
  }
}

export function workEventView(doc: WorkEventRow): WorkEvent {
  const data = doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data) ? (doc.data as Record<string, unknown>) : null
  return { id: doc._id, workItemId: doc.workItemId, actorPrincipalId: doc.actorPrincipalId, kind: doc.kind, data, createdAt: doc.createdAt }
}
