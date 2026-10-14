import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/**
 * Break-glass operator grant — run manually with deployment access:
 *
 *   npx convex run admin/breakGlass:grantFirstAdmin '{"userId": "user_..."}'
 *
 * Internal functions can only be invoked by deployment credentials, never by
 * app secrets, so this is the recovery path when no active `admin` principal
 * exists (first operator, accidental mass revoke). It grants `admin` to
 * `userId` and records the audit event in the same transaction.
 */
export const grantFirstAdmin = internalMutation({
  args: {
    grantedBy: v.optional(v.string()),
    reason: v.optional(v.string()),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    const now = Date.now()
    const values = {
      grantedBy: args.grantedBy ?? 'break-glass',
      reason: args.reason ?? 'break-glass operator grant',
      role: 'admin' as const,
      updatedAt: now,
      revokedAt: undefined,
      revokedBy: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, values)
    } else {
      await ctx.db.insert('administrativePrincipals', {
        ...values,
        userId: args.userId,
        createdAt: now,
      })
    }
    await ctx.db.insert('auditEvents', {
      eventId: crypto.randomUUID(),
      actorType: 'system',
      actorUserId: args.grantedBy,
      action: 'administration.principal.break_glass_grant',
      resourceType: 'administrative_principal',
      resourceId: args.userId,
      outcome: 'success',
      metadataJson: JSON.stringify({ role: 'admin' }),
      createdAt: now,
    })
    return { userId: args.userId, role: 'admin' as const }
  },
})
