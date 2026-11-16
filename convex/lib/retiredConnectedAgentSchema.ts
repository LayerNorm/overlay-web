import { v } from 'convex/values'

/**
 * Validator for remote-run fields still present on existing `conversationAgentRuns` and `conversationMessages`
 * rows until `migrations/purgeConnectedAgents:purgeRemoteRuns` has deleted them. Delete this file, and those fields,
 * in the follow-up once production reports no remote runs.
 */
const remoteApprovalValidator = v.object({ requestKey: v.string(), expiresAt: v.number(), kind: v.optional(v.union(v.literal('permission'), v.literal('elicitation'))), decision: v.optional(v.string()), delivered: v.optional(v.boolean()) })

export const remoteLifecycleValidator = v.object({
  version: v.literal(2), revision: v.number(), phase: v.union(
    v.literal('queued'), v.literal('waking'), v.literal('starting'), v.literal('running'),
    v.literal('waiting_for_approval'), v.literal('waiting_for_input'), v.literal('recovering'), v.literal('finalizing'),
    v.literal('needs_attention'), v.literal('cancelling'), v.literal('completed'), v.literal('cancelled'), v.literal('failed')),
  currentAttemptId: v.string(), executionGeneration: v.number(), coordinatorGeneration: v.number(),
  coordinatorId: v.optional(v.string()), hardDeadlineAt: v.number(), claimDeadlineAt: v.number(),
  lastHealthAt: v.optional(v.number()), lastProgressAt: v.optional(v.number()), lastPreparationAt: v.optional(v.number()),
  finalizationDeadlineAt: v.optional(v.number()),
  approval: v.optional(remoteApprovalValidator), approvals: v.optional(v.array(remoteApprovalValidator)),
  providerStop: v.optional(v.object({provider: v.literal('box'), environmentId: v.string(), leaseId: v.string(),
    providerReference: v.string(), attemptId: v.string(), executionGeneration: v.number(), observedAt: v.number(), recordedAtRevision: v.number()})),
  cause: v.optional(v.string()), cancelRequestedAt: v.optional(v.number()), recoveryOutcome: v.optional(v.union(v.literal('attached_live'), v.literal('restored'), v.literal('requires_new_attempt'), v.literal('unavailable'))),
})
