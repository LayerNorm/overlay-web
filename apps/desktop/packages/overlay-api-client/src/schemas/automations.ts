import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, PaginationQuery, UnknownResponse } from './common'

export const AutomationListQuery = PaginationQuery.extend({
  automationId: IdQuery,
  projectId: IdQuery,
  includeDeleted: BooleanQueryValue,
  runs: BooleanQueryValue,
})

export const CreateAutomationRequest = z.object({
  ...AuthFields,
  name: z.string().min(1).max(200).optional(),
  prompt: z.string().optional(),
  schedule: z.unknown().optional(),
  projectId: z.string().optional(),
}).passthrough()

export const UpdateAutomationRequest = CreateAutomationRequest.partial().extend({
  ...AuthFields,
  automationId: z.string().min(1),
})

export const DeleteAutomationRequest = z.object({
  ...AuthFields,
  automationId: z.string().min(1).optional(),
})

export const RunAutomationRequest = z.object({
  ...AuthFields,
  runId: z.string().min(1),
}).passthrough()

export const TestAutomationRequest = z.object({
  ...AuthFields,
  prompt: z.string().optional(),
  automationId: z.string().optional(),
}).passthrough()

export const AutomationResponse = UnknownResponse
