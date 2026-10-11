export type WorkItemStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
export type WorkItemPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
export type WorkItemScope = 'personal' | 'workspace'
export type WorkItemView = 'personal' | 'workspace' | 'archived'

export interface WorkItemDoc {
  _id: string
  userId: string
  reporterUserId: string
  workspaceId?: string
  scope?: WorkItemScope
  archivedAt?: number
  archivedBy?: string
  archivedFromScope?: WorkItemScope
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

export interface WorkItemDetailDoc {
  item: WorkItemDoc
  children: WorkItemDoc[]
}

export interface WorkItemQuery {
  itemId?: string
  view?: WorkItemView
  status?: WorkItemStatus
  assigneeUserId?: string
  parentItemId?: string
  includeDeleted?: boolean
  q?: string
}

export interface CreateWorkItemRequest {
  title: string
  description?: string
  status?: WorkItemStatus
  priority?: WorkItemPriority
  assigneeUserId?: string
  startDate?: number
  dueDate?: number
  labels?: string[]
  parentItemId?: string
  scope?: WorkItemScope
}

export interface UpdateWorkItemRequest {
  itemId: string
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
  action?: 'archive' | 'restore' | 'move'
  scope?: WorkItemScope
}

export interface CreateWorkItemResponse {
  workItemId: string
}

export interface UpdateWorkItemResponse {
  success: boolean
}
