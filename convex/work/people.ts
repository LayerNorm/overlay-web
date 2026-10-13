import { v } from 'convex/values'
import { query } from '../_generated/server'
import { workAuth } from './validators'
import { authorize } from './rules'

export const list = query({
  args: workAuth, returns: v.array(v.object({ principalId: v.string(), userId: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const principals = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).take(1000)
    const people: { principalId: string; userId: string; name: string }[] = []
    for (const principal of principals) {
      if (principal.type !== 'human' || !principal.userId || principal.archivedAt !== undefined) continue
      const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)).unique()
      if (membership?.status === 'active' && membership.role !== 'guest') people.push({ principalId: principal.principalId, userId: principal.userId, name: principal.displayName || 'Member' })
    }
    return people.sort((a, b) => a.name.localeCompare(b.name))
  },
})
