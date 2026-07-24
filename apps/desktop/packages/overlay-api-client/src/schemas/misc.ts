import { z } from 'zod'
import { AuthFields, EmptyQuery, EmptyRequest, FormDataBoundary, PaginationQuery, UnknownResponse } from './common'

export const BootstrapQuery = EmptyQuery
export const SubscriptionQuery = EmptyQuery
export const OnboardingStatusQuery = EmptyQuery

export const OnboardingMutationRequest = z.object({
  ...AuthFields,
}).passthrough()

export const DaytonaRunRequest = z.object({
  ...AuthFields,
  code: z.string().optional(),
  command: z.string().optional(),
}).passthrough()

export const BrowserTaskRequest = z.object({
  ...AuthFields,
  task: z.string().optional(),
}).passthrough()

export const EntityListQuery = PaginationQuery.extend({
  projectId: z.string().optional(),
  skillId: z.string().optional(),
  mcpServerId: z.string().optional(),
})

export const EntityMutationRequest = z.object({
  ...AuthFields,
  name: z.string().optional(),
  projectId: z.string().optional(),
}).passthrough()

export const EntityDeleteRequest = z.object({
  ...AuthFields,
  skillId: z.string().optional(),
  mcpServerId: z.string().optional(),
})

export const McpTestRequest = z.object({
  ...AuthFields,
  mcpServerId: z.string().optional(),
}).passthrough()

export const TranscribeRequest = FormDataBoundary
export const EmptyJsonRequest = EmptyRequest
export const MiscResponse = UnknownResponse
