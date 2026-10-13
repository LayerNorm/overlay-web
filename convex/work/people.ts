import { v } from 'convex/values'
import { query } from '../_generated/server'
import { workAuth } from './validators'
import { authorize, fail } from './rules'

export const list = query({
  args: workAuth,
  returns: v.array(v.object({ principalId: v.string(), userId: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const principals = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .filter((q) => q.and(q.eq(q.field('type'), 'human'), q.eq(q.field('archivedAt'), undefined)))
      .take(1001)
    if (principals.length > 1000)
      fail('INVALID', 'This workspace has too many people for the task directory')
    const people: { principalId: string; userId: string; name: string }[] = []
    for (const principal of principals) {
      if (principal.type !== 'human' || !principal.userId || principal.archivedAt !== undefined)
        continue
      const membership = await ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId),
        )
        .unique()
      if (membership?.status === 'active' && membership.role !== 'guest')
        people.push({
          principalId: principal.principalId,
          userId: principal.userId,
          name: principal.displayName || 'Member',
        })
    }
    return people.sort((a, b) => a.name.localeCompare(b.name))
  },
})
