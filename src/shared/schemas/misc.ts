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

export const McpOAuthStartRequest = z.object({
  mcpServerId: z.string().min(1),
  /** Same-origin relative path; the route re-validates before using it as a redirect target. */
  returnTo: z.string().optional(),
  scope: z.string().optional(),
  surface: z.enum(['web', 'desktop']).optional(),
}).passthrough()

export const McpOAuthDisconnectRequest = z.object({
  mcpServerId: z.string().min(1),
})

export const TranscribeRequest = FormDataBoundary
export const EmptyJsonRequest = EmptyRequest
export const MiscResponse = UnknownResponse
