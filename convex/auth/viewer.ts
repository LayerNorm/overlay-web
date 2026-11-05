import { query } from '../_generated/server'
import { v } from 'convex/values'

// Authentication only. Resource authorization belongs in each domain operation.
export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({ userId: v.string() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return identity ? { userId: identity.subject } : null
  },
})
