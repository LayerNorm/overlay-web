import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * TEMPORARY drain shim (added 2026-11-19, remove once no workflow run started before the Slack removal is still
 * running — a few days at most). Agent runs that were already in flight on the previous web deployment keep running
 * its code, which asks this query on every tool step and when a reply finishes. Without it those runs fail with a
 * Convex "Server Error". Slack turns no longer exist, so every run gets the answer an ordinary run always got: null.
 */
export const getSurfaceTurnExecutionByHarnessRunId = query({
  args: { serverSecret: v.string(), harnessRunId: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    requireServerSecret(args.serverSecret)
    return null
  },
})
