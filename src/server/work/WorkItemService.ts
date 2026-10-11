import type {
  ResourceScope,
  ResourceView,
} from '@/shared/workspaces/resource-scope'
import type { WorkItemPriority, WorkItemStatus } from '@/shared/work/work-items'

export type { WorkItemPriority, WorkItemStatus }

/** One `workItems` row as the API returns it. */
export interface WorkItemRecord {
  _id: string
  userId: string
  reporterUserId: string
  workspaceId?: string
  scope?: ResourceScope
  archivedAt?: number
  archivedBy?: string
  archivedFromScope?: ResourceScope
  title: string
  description?: string
  status: WorkItemStatus
  priority: WorkItemPriority
  assigneeUserId?: string
  startDate?: number
  dueDate?: number
  orderKey: string
  parentItemId?: string
  itemNumber: number
  labels?: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface WorkItemDetail {
  item: WorkItemRecord
  children: WorkItemRecord[]
}

export type WorkItemScopeActionResult = { ok: true } | { ok: false; reason: string }

export interface ListWorkItemsParams {
  userId: string
  workspaceId?: string
  view?: ResourceView
  status?: WorkItemStatus
  assigneeUserId?: string
  parentItemId?: string
  includeDeleted?: boolean
}

export interface CreateWorkItemParams {
  userId: string
  workspaceId?: string
  scope?: ResourceScope
  title: string
  description?: string
  status?: WorkItemStatus
  priority?: WorkItemPriority
  assigneeUserId?: string
  startDate?: number
  dueDate?: number
  labels?: string[]
  parentItemId?: string
}

export interface UpdateWorkItemParams {
  itemId: string
  userId: string
  workspaceId?: string
  title?: string
  description?: string
  status?: WorkItemStatus
  priority?: WorkItemPriority
  assigneeUserId?: string
  clearAssignee?: boolean
  startDate?: number
  dueDate?: number
  clearDates?: boolean
  labels?: string[]
  parentItemId?: string
  orderKey?: string
  expectedUpdatedAt?: number
}

export interface WorkItemRepository {
  listWorkItems(params: ListWorkItemsParams): Promise<WorkItemRecord[]>
  getWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemDetail | null>
  createWorkItem(params: CreateWorkItemParams): Promise<string>
  updateWorkItem(params: UpdateWorkItemParams): Promise<void>
  reorderWorkItem(params: { itemId: string; userId: string; workspaceId?: string; status?: WorkItemStatus; orderKey: string }): Promise<void>
  setWorkItemScope(params: { itemId: string; userId: string; workspaceId?: string; to: ResourceScope }): Promise<WorkItemScopeActionResult>
  archiveWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult>
  restoreWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult>
  deleteWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<void>
  searchWorkItems(params: { userId: string; workspaceId?: string; text: string; limit?: number }): Promise<WorkItemRecord[]>
}

export class WorkItemServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'WorkItemServiceError'
  }
}

export class WorkItemRevisionConflictError extends Error {
  constructor(
    public readonly currentUpdatedAt: number,
    public readonly expectedUpdatedAt?: number,
  ) {
    super('The work item was updated elsewhere; refresh and try again')
    this.name = 'WorkItemRevisionConflictError'
  }
}

/**
 * Work item domain service: validates inputs, enforces optimistic-revision checks, and
 * maps repository results to domain errors. Scope/permission decisions live in the
 * Convex layer (`convex/work/items.ts` + resourceScope), mirroring notes and automations.
 */
export class WorkItemService {
  constructor(private readonly workItems: WorkItemRepository) {}

  listWorkItems(params: ListWorkItemsParams): Promise<WorkItemRecord[]> {
    return this.workItems.listWorkItems(params)
  }

  getWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemDetail | null> {
    if (!params.itemId) return Promise.resolve(null)
    return this.workItems.getWorkItem(params)
  }

  async createWorkItem(params: CreateWorkItemParams): Promise<{ workItemId: string }> {
    if (!params.title?.trim()) throw new WorkItemServiceError('A title is required', 400)
    const workItemId = await this.workItems.createWorkItem({ ...params, title: params.title.trim() })
    return { workItemId }
  }

  async updateWorkItem(params: UpdateWorkItemParams): Promise<{ success: true }> {
    if (!params.itemId) throw new WorkItemServiceError('itemId is required', 400)
    if (params.expectedUpdatedAt !== undefined) {
      const detail = await this.workItems.getWorkItem({
        itemId: params.itemId,
        userId: params.userId,
        workspaceId: params.workspaceId,
      })
      if (!detail) throw new WorkItemServiceError('Work item not found', 404)
      if (detail.item.updatedAt !== params.expectedUpdatedAt) {
        throw new WorkItemRevisionConflictError(detail.item.updatedAt, params.expectedUpdatedAt)
      }
    }
    await this.workItems.updateWorkItem(params)
    return { success: true }
  }

  async reorderWorkItem(params: {
    itemId: string
    userId: string
    workspaceId?: string
    status?: WorkItemStatus
    orderKey: string
  }): Promise<{ success: true }> {
    if (!params.itemId || !params.orderKey) throw new WorkItemServiceError('itemId and orderKey are required', 400)
    await this.workItems.reorderWorkItem(params)
    return { success: true }
  }

  async setWorkItemScope(params: { itemId: string; userId: string; workspaceId?: string; to: ResourceScope }): Promise<WorkItemScopeActionResult> {
    return this.workItems.setWorkItemScope(params)
  }

  async archiveWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult> {
    return this.workItems.archiveWorkItem(params)
  }

  async restoreWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<WorkItemScopeActionResult> {
    return this.workItems.restoreWorkItem(params)
  }

  async deleteWorkItem(params: { itemId: string; userId: string; workspaceId?: string }): Promise<{ success: true }> {
    if (!params.itemId) throw new WorkItemServiceError('itemId is required', 400)
    await this.workItems.deleteWorkItem(params)
    return { success: true }
  }

  searchWorkItems(params: { userId: string; workspaceId?: string; text: string; limit?: number }): Promise<WorkItemRecord[]> {
    return this.workItems.searchWorkItems(params)
  }
}
