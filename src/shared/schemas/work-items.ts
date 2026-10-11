import { z } from 'zod'
import { WORK_ITEM_LIMITS, WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES, isWorkItemOrderKey } from '../work/work-items'
import { ResourceViewQuery } from './misc'
import { AuthFields, BooleanQueryValue, IdQuery, PaginationQuery, UnknownResponse } from './common'

const WorkItemStatusSchema = z.enum(WORK_ITEM_STATUSES).optional()
const WorkItemPrioritySchema = z.enum(WORK_ITEM_PRIORITIES).optional()
const TitleSchema = z.string().max(WORK_ITEM_LIMITS.title, `title is limited to ${WORK_ITEM_LIMITS.title} characters`)
const DescriptionSchema = z.string().max(WORK_ITEM_LIMITS.description, `description is limited to ${WORK_ITEM_LIMITS.description} characters`)
const LabelsSchema = z
  .array(z.string().trim().min(1).max(WORK_ITEM_LIMITS.labelLength))
  .max(WORK_ITEM_LIMITS.labelCount, `at most ${WORK_ITEM_LIMITS.labelCount} labels`)
const OrderKeySchema = z.string().refine(isWorkItemOrderKey, 'orderKey must be a fixed-width numeric key')
const TimestampSchema = z.number().finite().nonnegative()

export const WorkItemListQuery = PaginationQuery.extend({
  itemId: IdQuery,
  q: z.string().optional(),
  search: z.string().optional(),
  view: ResourceViewQuery,
  status: z.enum(WORK_ITEM_STATUSES).optional(),
  assigneeUserId: z.string().optional(),
  parentItemId: z.string().optional(),
  includeDeleted: BooleanQueryValue,
})

export const CreateWorkItemRequest = z.object({
  ...AuthFields,
  title: TitleSchema,
  description: DescriptionSchema.optional(),
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  /** A workspace principal id (a member, or an agent). */
  assigneeUserId: z.string().min(1).optional(),
  startDate: TimestampSchema.optional(),
  dueDate: TimestampSchema.optional(),
  labels: LabelsSchema.optional(),
  parentItemId: z.string().min(1).optional(),
  scope: z.enum(['personal', 'workspace']).optional(),
})

export const UpdateWorkItemRequest = z.object({
  ...AuthFields,
  itemId: z.string().min(1),
  title: TitleSchema.optional(),
  description: DescriptionSchema.optional(),
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  assigneeUserId: z.string().min(1).optional(),
  clearAssignee: z.boolean().optional(),
  startDate: TimestampSchema.optional(),
  dueDate: TimestampSchema.optional(),
  /** Clears both dates; `clearStartDate` / `clearDueDate` clear one. */
  clearDates: z.boolean().optional(),
  clearStartDate: z.boolean().optional(),
  clearDueDate: z.boolean().optional(),
  labels: LabelsSchema.optional(),
  parentItemId: z.string().min(1).optional(),
  /** Turns a subtask back into a top-level item. */
  clearParent: z.boolean().optional(),
  orderKey: OrderKeySchema.optional(),
  expectedUpdatedAt: z.number().optional(),
  action: z.enum(['archive', 'restore', 'move']).optional(),
  scope: z.enum(['personal', 'workspace']).optional(),
})

export const DeleteWorkItemRequest = z.object({
  ...AuthFields,
  itemId: z.string().min(1).optional(),
})

export const WorkItemResponse = UnknownResponse
