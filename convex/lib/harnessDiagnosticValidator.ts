import { v } from 'convex/values'

export const harnessDiagnosticValidator = v.object({
  diagnosticId: v.string(),
  code: v.union(v.literal('TASK_DEADLINE'), v.literal('TASK_SPEND_LIMIT'), v.literal('WORKSPACE_FUNDS'),
    v.literal('PROVIDER_TIMEOUT'), v.literal('PROVIDER_RATE_LIMIT'), v.literal('PROVIDER_UNAVAILABLE'),
    v.literal('TOOL_FAILED'), v.literal('TOOL_OUTCOME_UNKNOWN'), v.literal('MODEL_OUTCOME_UNKNOWN'),
    v.literal('AUTHORIZATION_REVOKED'), v.literal('PERSISTENCE_FAILED'), v.literal('STAGNATION'), v.literal('UNKNOWN')),
  stage: v.union(v.literal('admission'), v.literal('model'), v.literal('tool'),
    v.literal('persistence'), v.literal('delivery')),
  retryability: v.union(v.literal('automatic'), v.literal('user_action'), v.literal('reconcile'), v.literal('none')),
  safeMessage: v.string(),
  nextAction: v.string(),
  occurredAt: v.number(),
})
