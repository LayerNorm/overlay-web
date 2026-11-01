import { v } from 'convex/values'

export const harnessResourceGrantValidator = v.union(
  v.object({ kind: v.literal('model_spend'), newMaxCostMicros: v.number() }),
  v.object({ kind: v.literal('time'), durationMs: v.number() }),
)

export const harnessResourceRequestValidator = v.object({
  token: v.string(),
  runId: v.string(),
  rootRunId: v.string(),
  workflowRunId: v.string(),
  policyRevision: v.number(),
  reason: v.union(v.literal('model_spend'), v.literal('time')),
  currentMaxCostMicros: v.number(),
  usedCostMicros: v.number(),
  reservedCostMicros: v.number(),
  requiredCostMicros: v.number(),
  deadlineAt: v.number(),
  requestedAt: v.number(),
})

export const harnessResourceGrantReceiptValidator = v.object({
  token: v.string(),
  runId: v.string(),
  rootRunId: v.string(),
  workflowRunId: v.string(),
  grant: harnessResourceGrantValidator,
  policyRevisionBefore: v.number(),
  policyRevisionAfter: v.number(),
  grantedAt: v.number(),
  maxCostMicros: v.number(),
  deadlineAt: v.number(),
})

export const agentRunResourceRequestValidator = v.object({
  request: harnessResourceRequestValidator,
  receipt: v.optional(harnessResourceGrantReceiptValidator),
  awaitingReceipt: v.boolean(),
})
