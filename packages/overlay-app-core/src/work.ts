/** Portable human-task contracts for every Overlay client. */
export const WORK_STATUSES = ['backlog', 'todo', 'progress', 'review', 'done'] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]
export type WorkScope = 'personal' | 'workspace'
export type WorkView = WorkScope | 'archived'
export type WorkContext = { type: 'file' | 'note' | 'chat' | 'link'; id: string; label: string }
export type WorkChecklistItem = { text: string; checked: boolean }
export type WorkFields = {
  title: string; description: string; status: WorkStatus; blocked: boolean; priority: 1 | 2 | 3; rank: string
  assigneePrincipalId?: string; reviewerUserId?: string; startDate?: string; dueDate?: string; parentId?: string
  blockedBy?: string[]; doneWhen?: WorkChecklistItem[]; context?: WorkContext[]
}
export type WorkItem = WorkFields & {
  _id: string; _creationTime: number; userId: string; workspaceId: string; scope: WorkScope
  archivedAt?: number; archivedBy?: string; archivedFromScope?: WorkScope; createdAt: number; updatedAt: number
}
export type CreateWork = Pick<WorkFields, 'title'> & Partial<Omit<WorkFields, 'title' | 'rank' | 'blockedBy'>> & { scope?: WorkScope }
export type WorkPatch = Partial<Omit<WorkFields, 'assigneePrincipalId' | 'reviewerUserId' | 'startDate' | 'dueDate' | 'parentId' | 'blockedBy'>> & {
  assigneePrincipalId?: string | null; reviewerUserId?: string | null; startDate?: string | null; dueDate?: string | null; parentId?: string | null
}
export type UpdateWork = { expectedUpdatedAt: number; patch: WorkPatch }
export type WorkAction = { action: 'scope'; to: WorkScope } | { action: 'archived' | 'restored' } | { action: 'comment'; text: string }
export type WorkEvent = {
  _id: string; _creationTime: number; workItemId: string; workspaceId: string; actorPrincipalId: string
  kind: 'created' | 'updated' | 'status' | 'assignee' | 'comment' | 'scope' | 'archived' | 'restored'
  data: { text?: string; field?: string; before?: string; after?: string }; createdAt: number
}

export type WorkPerson = { principalId: string; userId: string; name: string }
