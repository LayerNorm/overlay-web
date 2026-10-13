import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { loadScopeContext, getReadableRow } from '../lib/resourceScope'
import { canCreateInScope } from '../../src/shared/workspaces/resource-scope'
import { isRank } from '../../src/shared/work/rank'

export type WorkActor = { userId: string; workspaceId: string; serverSecret?: string; accessToken?: string }
export function fail(code: string, message: string): never { throw new ConvexError({ code, message }) }
export async function authorize(ctx: QueryCtx, args: WorkActor) {
  if (!validateServerSecret(args.serverSecret)) await requireAccessToken(args.accessToken ?? '', args.userId)
  const scope = await loadScopeContext(ctx, args.workspaceId, args.userId)
  if (!canCreateInScope('content', 'personal', scope.viewer, scope.policy)) fail('FORBIDDEN', 'An active workspace membership is required')
  return scope
}
export async function readable(ctx: QueryCtx, args: WorkActor, id: Id<'workItems'>) {
  const row = await getReadableRow(ctx, { row: await ctx.db.get(id), ...args })
  if (!row) fail('NOT_FOUND', 'Task not found')
  return row
}
export function validateFields(fields: Pick<Doc<'workItems'>, 'title' | 'description' | 'rank' | 'startDate' | 'dueDate' | 'doneWhen' | 'context' | 'blockedBy'>) {
  if (!fields.title.trim() || fields.title.length > 200) fail('INVALID', 'Title must contain 1–200 characters')
  if (fields.description.length > 20_000) fail('INVALID', 'Description is too long')
  if (!isRank(fields.rank)) fail('INVALID', 'Invalid rank')
  for (const day of [fields.startDate, fields.dueDate]) {
    if (day !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) fail('INVALID', 'Invalid calendar date')
  }
  if (fields.startDate && fields.dueDate && fields.startDate > fields.dueDate) fail('INVALID', 'Start date must be before the due date')
  if ((fields.doneWhen?.length ?? 0) > 100 || fields.doneWhen?.some((item) => !item.text.trim() || item.text.length > 1000)) fail('INVALID', 'Invalid checklist')
  if ((fields.context?.length ?? 0) > 50 || fields.context?.some((item) => !item.id.trim() || !item.label.trim() || item.label.length > 200 || item.id.length > 2000)) fail('INVALID', 'Invalid context')
  if ((fields.blockedBy?.length ?? 0) > 50) fail('INVALID', 'Too many dependencies')
  for (const item of fields.context ?? []) {
    if (item.type === 'link') {
      try { if (!['http:', 'https:'].includes(new URL(item.id).protocol)) fail('INVALID', 'Links must use HTTP or HTTPS') } catch { fail('INVALID', 'Invalid link') }
    }
  }
}
export async function validatePeople(ctx: QueryCtx, row: Pick<Doc<'workItems'>, 'assigneePrincipalId' | 'reviewerUserId' | 'scope' | 'workspaceId' | 'userId'>) {
  const validate = async (principal: Doc<'workspacePrincipals'> | null) => {
    if (!principal || principal.workspaceId !== row.workspaceId || principal.archivedAt !== undefined || principal.type !== 'human' || (row.scope === 'personal' && principal.userId !== row.userId)) fail('INVALID', 'Choose an active human who can see this task')
    const member = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', row.workspaceId).eq('principalId', principal.principalId)).unique()
    if (!member || member.status !== 'active' || member.role === 'guest') fail('INVALID', 'Choose an active workspace member')
  }
  if (row.assigneePrincipalId) await validate(await ctx.db.query('workspacePrincipals').withIndex('by_principalId', (q) => q.eq('principalId', row.assigneePrincipalId!)).unique())
  if (row.reviewerUserId) await validate(await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', row.workspaceId).eq('userId', row.reviewerUserId!)).unique())
}
export async function validateParent(ctx: MutationCtx, args: WorkActor, row: Pick<Doc<'workItems'>, 'parentId' | 'scope'>, id?: Id<'workItems'>) {
  if (!row.parentId) return
  if (row.parentId === id) fail('INVALID', 'A task cannot be its own parent')
  const parent = await readable(ctx, args, row.parentId)
  if (parent.archivedAt !== undefined || parent.parentId || parent.scope !== row.scope) fail('INVALID', 'Choose a top-level objective in the same scope')
  if (id && await ctx.db.query('workItems').withIndex('by_parentId', (q) => q.eq('parentId', id)).first()) fail('INVALID', 'An objective with tasks cannot become a task')
}
export async function recordEvent(ctx: MutationCtx, args: WorkActor, workItemId: Id<'workItems'>, kind: Doc<'workItemEvents'>['kind'], data: Doc<'workItemEvents'>['data']) {
  const actor = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', args.workspaceId).eq('userId', args.userId)).unique()
  if (!actor) fail('FORBIDDEN', 'Workspace identity required')
  await ctx.db.insert('workItemEvents', { workItemId, workspaceId: args.workspaceId, actorPrincipalId: actor.principalId, kind, data, createdAt: Date.now() })
}
