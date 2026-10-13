import { z } from 'zod'
import { WORK_STATUSES, type CreateWork, type UpdateWork, type WorkAction, type WorkItem, type WorkEvent } from '@overlay/app-core/work'
import { isRank } from './rank'

const id = z.string().min(1).max(200)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day, 'Invalid calendar date')
const scope = z.enum(['personal', 'workspace'])
const fields = {
  title: z.string().trim().min(1).max(200), description: z.string().max(20_000), status: z.enum(WORK_STATUSES), blocked: z.boolean(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), rank: z.string().refine(isRank, 'Invalid rank'),
  assigneePrincipalId: id.optional(), reviewerUserId: id.optional(), startDate: date.optional(), dueDate: date.optional(), parentId: id.optional(),
  doneWhen: z.array(z.object({ text: z.string().trim().min(1).max(1000), checked: z.boolean() }).strict()).max(100).optional(),
  context: z.array(z.object({ type: z.enum(['file', 'note', 'chat', 'link']), id: z.string().trim().min(1).max(2000), label: z.string().trim().min(1).max(200) }).strict()).max(50).optional(),
}
export const CreateWorkSchema = z.object({ ...fields, scope: scope.optional() }).omit({ rank: true }).partial().required({ title: true }).strict() satisfies z.ZodType<CreateWork>
export const UpdateWorkSchema = z.object({ expectedUpdatedAt: z.number().finite().nonnegative(), patch: z.object({ ...fields, assigneePrincipalId: id.nullable().optional(), reviewerUserId: id.nullable().optional(), startDate: date.nullable().optional(), dueDate: date.nullable().optional(), parentId: id.nullable().optional() }).partial().strict() }).strict() satisfies z.ZodType<UpdateWork>
export const WorkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('scope'), to: scope }).strict(),
  z.object({ action: z.enum(['archived', 'restored']) }).strict(),
  z.object({ action: z.literal('comment'), text: z.string().trim().min(1).max(5000) }).strict(),
]) satisfies z.ZodType<WorkAction>
export const WorkQuerySchema = z.object({ view: z.enum(['personal', 'workspace', 'archived']).optional() }).strict()
export const WorkItemSchema = z.object({ ...fields, blockedBy: z.array(id).max(50).optional(), _id: id, _creationTime: z.number(), userId: id, workspaceId: id, scope, archivedAt: z.number().optional(), archivedBy: id.optional(), archivedFromScope: scope.optional(), createdAt: z.number(), updatedAt: z.number() }) satisfies z.ZodType<WorkItem>
export const WorkEventSchema = z.object({ _id: id, _creationTime: z.number(), workItemId: id, workspaceId: id, actorPrincipalId: id, kind: z.enum(['created', 'updated', 'status', 'assignee', 'comment', 'scope', 'archived', 'restored']), data: z.object({ text: z.string().optional(), field: z.string().optional(), before: z.string().optional(), after: z.string().optional() }), createdAt: z.number() }) satisfies z.ZodType<WorkEvent>
