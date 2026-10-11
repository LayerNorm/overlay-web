import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ResourceScope } from '@/shared/workspaces/resource-scope'
import {
  WorkItemRevisionConflictError,
  WorkItemServiceError,
  type CreateWorkItemParams,
  type ListWorkItemsParams,
  type UpdateWorkItemParams,
  type WorkItemDetail,
  type WorkItemRecord,
  type WorkItemRepository,
  type WorkItemScopeActionResult,
  type WorkItemStatus,
} from './WorkItemService'

function translateWorkItemError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('WORK_ITEM_REVISION_CONFLICT:')) {
    const current = Number.parseInt(message.slice('WORK_ITEM_REVISION_CONFLICT:'.length), 10)
    throw new WorkItemRevisionConflictError(Number.isFinite(current) ? current : 0)
  }
  if (message.startsWith('WORK_ITEM_PARENT_INVALID')) {
    throw new WorkItemServiceError('Invalid parent work item', 400)
  }
  if (message === 'Unauthorized') {
    throw new WorkItemServiceError('Forbidden', 403)
  }
  throw error
}

async function translate<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    translateWorkItemError(error)
  }
}

/** `lazyConvex` resolves to null when the Convex backend is not configured; surface that as a 503, not a silent miss. */
function required<T>(promise: Promise<T | null>): Promise<T> {
  return translate(promise.then((value) => {
    if (value === null || value === undefined) throw new WorkItemServiceError('Work backend unavailable', 503)
    return value
  }))
}

export class ConvexWorkItemRepository implements WorkItemRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  listWorkItems(params: ListWorkItemsParams): Promise<WorkItemRecord[]> {
    return required(convex.query<WorkItemRecord[]>('work/items:list', {
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.view ? { view: params.view } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.assigneeUserId ? { assigneeUserId: params.assigneeUserId } : {}),
      ...(params.parentItemId ? { parentItemId: params.parentItemId } : {}),
      ...(params.includeDeleted !== undefined ? { includeDeleted: params.includeDeleted } : {}),
    }))
  }

  getWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemDetail | null> {
    return translate(convex.query<WorkItemDetail | null>('work/items:get', {
      itemId: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    }))
  }

  createWorkItem(params: CreateWorkItemParams): Promise<string> {
    return required(convex.mutation<string>('work/items:create', {
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
      title: params.title,
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.assigneeUserId ? { assigneeUserId: params.assigneeUserId } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.labels ? { labels: params.labels } : {}),
      ...(params.parentItemId ? { parentItemId: params.parentItemId } : {}),
    }))
  }

  async updateWorkItem(params: UpdateWorkItemParams): Promise<void> {
    await translate(convex.mutation('work/items:update', {
      itemId: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.assigneeUserId !== undefined ? { assigneeUserId: params.assigneeUserId } : {}),
      ...(params.clearAssignee ? { clearAssignee: params.clearAssignee } : {}),
      ...(params.startDate !== undefined ? { startDate: params.startDate } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.clearDates ? { clearDates: params.clearDates } : {}),
      ...(params.labels ? { labels: params.labels } : {}),
      ...(params.parentItemId ? { parentItemId: params.parentItemId } : {}),
      ...(params.orderKey !== undefined ? { orderKey: params.orderKey } : {}),
      ...(params.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: params.expectedUpdatedAt } : {}),
    }))
  }

  async reorderWorkItem(params: { itemId: string; userId: string; workspaceId?: string; status?: WorkItemStatus; orderKey: string }): Promise<void> {
    await translate(convex.mutation('work/items:reorder', {
      itemId: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.status ? { status: params.status } : {}),
      orderKey: params.orderKey,
    }))
  }

  setWorkItemScope(params: { itemId: string; userId: string; workspaceId?: string; to: ResourceScope }): Promise<WorkItemScopeActionResult> {
    return required(convex.mutation<WorkItemScopeActionResult>('work/items:setScope', {
      id: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      to: params.to,
    }))
  }

  archiveWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult> {
    return required(convex.mutation<WorkItemScopeActionResult>('work/items:archive', {
      id: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    }))
  }

  restoreWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult> {
    return required(convex.mutation<WorkItemScopeActionResult>('work/items:restore', {
      id: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    }))
  }

  async deleteWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<void> {
    await translate(convex.mutation('work/items:remove', {
      itemId: params.itemId,
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    }))
  }

  searchWorkItems(params: { userId: string; workspaceId?: string; text: string; limit?: number }): Promise<WorkItemRecord[]> {
    return required(convex.query<WorkItemRecord[]>('work/items:search', {
      userId: params.userId,
      serverSecret: this.serverSecret,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      text: params.text,
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    }))
  }
}
