import { v } from 'convex/values'
import { harnessDiagnosticValidator } from './harnessDiagnosticValidator'

export const nativeAgentErrorPart = v.object({
  type: v.literal('data-native-agent-error'),
  data: v.object({
    runId: v.string(), code: v.string(), message: v.string(), retryable: v.boolean(), failedAt: v.number(),
    diagnostic: v.optional(harnessDiagnosticValidator),
  }),
})
