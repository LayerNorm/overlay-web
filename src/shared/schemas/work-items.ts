import { z } from 'zod'
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES } from '../work/work-items'
import { ResourceViewQuery } from './misc'
import { AuthFields, BooleanQueryValue, IdQuery, PaginationQuery, UnknownResponse } from './common'

const WorkItemStatusSchema = z.enum(WORK_ITEM_STATUSES).optional()
const WorkItemPrioritySchema = z.enum(WORK_ITEM_PRIORITIES).optional()

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
  title: z.string(),
  description: z.string().optional(),
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  assigneeUserId: z.string().optional(),
  startDate: z.number().optional(),
  dueDate: z.number().optional(),
  labels: z.array(z.string()).optional(),
  parentItemId: z.string().optional(),
  scope: z.enum(['personal', 'workspace']).optional(),
})

export const UpdateWorkItemRequest = z.object({
  ...AuthFields,
  itemId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  status: WorkItemStatusSchema,
  priority: WorkItemPrioritySchema,
  assigneeUserId: z.string().optional(),
  clearAssignee: z.boolean().optional(),
  startDate: z.number().optional(),
  dueDate: z.number().optional(),
  clearDates: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  parentItemId: z.string().optional(),
  orderKey: z.string().optional(),
  expectedUpdatedAt: z.number().optional(),
  action: z.enum(['archive', 'restore', 'move']).optional(),
  scope: z.enum(['personal', 'workspace']).optional(),
})

export const DeleteWorkItemRequest = z.object({
  ...AuthFields,
  itemId: z.string().min(1).optional(),
})

export const WorkItemResponse = UnknownResponse
