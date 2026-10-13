import { v } from 'convex/values'

export const workScope = v.union(v.literal('personal'), v.literal('workspace'))
export const workStatus = v.union(
  v.literal('backlog'),
  v.literal('todo'),
  v.literal('progress'),
  v.literal('review'),
  v.literal('done'),
)
export const contextRef = v.object({
  type: v.union(v.literal('file'), v.literal('note'), v.literal('chat'), v.literal('link')),
  id: v.string(),
  label: v.string(),
})
export const workFields = {
  title: v.string(),
  description: v.string(),
  status: workStatus,
  blocked: v.boolean(),
  priority: v.union(v.literal(1), v.literal(2), v.literal(3)),
  rank: v.string(),
  assigneePrincipalId: v.optional(v.string()),
  reviewerUserId: v.optional(v.string()),
  startDate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  parentId: v.optional(v.id('workItems')),
  blockedBy: v.optional(v.array(v.id('workItems'))),
  doneWhen: v.optional(v.array(v.object({ text: v.string(), checked: v.boolean() }))),
  context: v.optional(v.array(contextRef)),
}
export const workRecord = {
  ...workFields,
  userId: v.string(),
  workspaceId: v.string(),
  scope: workScope,
  archivedAt: v.optional(v.number()),
  archivedBy: v.optional(v.string()),
  archivedFromScope: v.optional(workScope),
  createdAt: v.number(),
  updatedAt: v.number(),
}
export const workDoc = v.object({
  ...workRecord,
  _id: v.id('workItems'),
  _creationTime: v.number(),
})
export const eventKind = v.union(
  v.literal('created'),
  v.literal('updated'),
  v.literal('status'),
  v.literal('assignee'),
  v.literal('comment'),
  v.literal('scope'),
  v.literal('archived'),
  v.literal('restored'),
)
export const eventData = v.object({
  text: v.optional(v.string()),
  field: v.optional(v.string()),
  before: v.optional(v.string()),
  after: v.optional(v.string()),
})
export const eventRecord = {
  workItemId: v.id('workItems'),
  workspaceId: v.string(),
  actorPrincipalId: v.string(),
  kind: eventKind,
  data: eventData,
  createdAt: v.number(),
}
export const eventDoc = v.object({
  ...eventRecord,
  _id: v.id('workItemEvents'),
  _creationTime: v.number(),
})
export const workAuth = {
  userId: v.string(),
  workspaceId: v.string(),
  serverSecret: v.optional(v.string()),
  accessToken: v.optional(v.string()),
}
