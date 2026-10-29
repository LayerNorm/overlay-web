import type { ResourceScope, ResourceView } from './resource-scope'

/**
 * Work: tasks shown as a list, a board and a timeline. Statuses are fixed; "blocked" is a flag.
 * Calendar dates are plain `YYYY-MM-DD` strings so a due date never shifts with timezone. `rank` orders tasks inside
 * a column (a fractional string; compare with `<`).
 */
export type WorkStatus = 'backlog' | 'todo' | 'progress' | 'review' | 'done'
export type WorkPriority = 1 | 2 | 3
export type WorkContextType = 'file' | 'note' | 'chat' | 'link'
export type WorkEventKind =
  | 'created' | 'status' | 'assignee' | 'reviewer' | 'priority' | 'dates' | 'title'
  | 'blocked' | 'dependencies' | 'scope' | 'archived' | 'restored' | 'comment'

export interface WorkDoneWhen { text: string; checked: boolean }
export interface WorkContextRef { type: WorkContextType; id: string; label: string }

export interface WorkItem {
  id: string
  workspaceId: string
  scope: ResourceScope
  /** The user who created it. */
  createdBy: string
  title: string
  /** GitHub-flavored Markdown. */
  description: string | null
  status: WorkStatus
  blocked: boolean
  priority: WorkPriority
  rank: string
  /** A workspace principal: a person now, an agent later. */
  assigneePrincipalId: string | null
  reviewerUserId: string | null
  startDate: string | null
  dueDate: string | null
  parentId: string | null
  blockedBy: string[]
  doneWhen: WorkDoneWhen[]
  context: WorkContextRef[]
  archivedAt: number | null
  archivedFromScope: ResourceScope | null
  createdAt: number
  updatedAt: number
}

export interface WorkEvent {
  id: string
  workItemId: string
  actorPrincipalId: string
  kind: WorkEventKind
  data: Record<string, unknown> | null
  createdAt: number
}

/** Someone a task can be given to. */
export interface WorkPerson {
  principalId: string
  type: 'human' | 'agent'
  userId: string | null
  displayName: string
  photoUrl?: string
  agentVisibility?: 'workspace' | 'creator'
  avatarColor?: string
  avatarShape?: string
  isDefault?: boolean
}

/** Who is asking and who a task can go to. */
export interface WorkContext {
  principalId: string
  role: 'owner' | 'admin' | 'member'
  canCreateInWorkspace: boolean
  people: WorkPerson[]
}

export interface WorkQuery {
  /** Personal, workspace, or archived. Omitted means everything active the caller can see. */
  view?: ResourceView
}

export interface CreateWorkItemRequest {
  title: string
  scope?: ResourceScope
  description?: string
  status?: WorkStatus
  blocked?: boolean
  priority?: WorkPriority
  assigneePrincipalId?: string
  reviewerUserId?: string
  startDate?: string
  dueDate?: string
  parentId?: string
  blockedBy?: string[]
  doneWhen?: WorkDoneWhen[]
  context?: WorkContextRef[]
}

/** `null` clears a field; leaving it out leaves it as is. */
export interface UpdateWorkItemRequest {
  /** Refuse the entire update if the task changed since it was read. */
  expectedUpdatedAt?: number
  scope?: ResourceScope
  title?: string
  description?: string | null
  status?: WorkStatus
  blocked?: boolean
  priority?: WorkPriority
  assigneePrincipalId?: string | null
  reviewerUserId?: string | null
  startDate?: string | null
  dueDate?: string | null
  parentId?: string | null
  /** The tasks that must finish first. Replaces the list; a loop is refused. */
  blockedBy?: string[]
  doneWhen?: WorkDoneWhen[]
  context?: WorkContextRef[]
}

/** Drop a task into a column between two neighbours; either may be left out for the top or bottom. */
export interface MoveWorkItemRequest {
  status?: WorkStatus
  afterId?: string | null
  beforeId?: string | null
}

export interface AddWorkCommentRequest { body: string }

export interface WorkItemListResponse { items: WorkItem[] }
export interface WorkItemResponse { item: WorkItem }
export interface WorkEventListResponse { events: WorkEvent[] }

/** Dispatched on `window` when tasks changed somewhere else on the page (for example after a restore), so views reload. */
export const WORK_UPDATED_EVENT = 'overlay:work-updated'
