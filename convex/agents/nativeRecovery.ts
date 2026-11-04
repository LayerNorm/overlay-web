
import {v} from 'convex/values'
import {mutation} from '../_generated/server'
import {requireServerSecret} from '../lib/auth'

/** Tombstone for durable workflows created before hosted runtimes were retired. */
export const beginByServer = mutation({
  args: {serverSecret: v.string(), runId: v.string(), coordinatorId: v.string(), coordinatorGeneration: v.number(),
    attemptId: v.string(), generation: v.number(), expectedRevision: v.number(), leaseId: v.string(), providerReference: v.string(),
    observedStoppedAt: v.optional(v.number()), now: v.number()},
  returns: v.boolean(),
  handler: async (_ctx, args) => {
    requireServerSecret(args.serverSecret)
    return false
  },
})
