import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'
import { uniqueWorkspaceAccount } from '../billing/accountModel'
import { workspaceAllowanceSubject } from '../../src/shared/billing/free-allowance'
import { hasZeroPricing } from '../../src/shared/ai/gateway/overlay-free-policy'

/** Explicit recovery, never called by ordinary deployment seeding. */
export const recover = internalMutation({
  args: {
    fixture: v.union(v.literal('personal'), v.literal('paid-workspace'), v.literal('computer-workspace'), v.literal('exhausted-workspace')),
    requestId: v.string(),
    availableCents: v.optional(v.number()),
  },
  returns: v.object({ workspaceId: v.string(), applied: v.boolean() }),
  handler: async (ctx, args) => {
    requirePreviewDeployment()
    const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
    if (!userId?.startsWith('user_')) throw new Error('Configure the sandbox preview login identity')
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId)) throw new Error('QA recovery requires a unique request id')
    const personal = await ctx.db.query('workspaces')
      .withIndex('by_personalOwnerUserId', q => q.eq('personalOwnerUserId', userId)).unique()
    const workspaceId = args.fixture === 'personal' ? personal?.workspaceId
      : args.fixture === 'paid-workspace' ? `preview-qa-team-${userId}`
      : args.fixture === 'exhausted-workspace' ? `preview-exhausted-qa-${userId}` : `preview-computer-qa-${userId}`
    if (!workspaceId) throw new Error('Seed the Preview fixture before recovery')
    const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
    if (!workspace) throw new Error('Seed the Preview fixture before recovery')
    const eventId = `preview-qa-recovery:${args.requestId}`
    const previous = await ctx.db.query('auditEvents').withIndex('by_eventId', q => q.eq('eventId', eventId)).unique()
    if (previous) {
      if (previous.resourceId !== workspaceId || previous.metadataJson !== JSON.stringify(args)) {
        throw new Error('QA recovery request id reused with different arguments')
      }
      return { workspaceId, applied: false }
    }
    if (args.fixture === 'personal' || args.fixture === 'exhausted-workspace') {
      if (args.availableCents !== undefined) throw new Error('Free fixture recovery cannot grant paid credit')
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
      // Both keys cover accounts that started before workspace counting was introduced.
      const subjects = args.fixture === 'personal' ? [userId, workspaceAllowanceSubject(workspaceId)] : [workspaceAllowanceSubject(workspaceId)]
      for (const subject of subjects) {
        const rows = await ctx.db.query('dailyUsage').withIndex('by_userId_date', q =>
          q.eq('userId', subject).gte('date', from)).take(32)
        if (rows.length === 32) throw new Error('Unexpected QA usage history; inspect before resetting')
        for (const row of rows) await ctx.db.patch(row._id, {
          askCount: 0, writeCount: 0, agentCount: 0, transcriptionSeconds: 0,
        })
      }
    } else {
      const cents = args.availableCents
      if (!Number.isSafeInteger(cents) || cents === undefined || cents < 0 || cents > 5_000) {
        throw new Error('Synthetic available credit must be an integer from 0 to 5000 cents')
      }
      const account = await uniqueWorkspaceAccount(ctx, workspaceId)
      if (!account || account.status !== 'active') throw new Error('Active QA fixture account is required')
      const subscription = await ctx.db.query('billingAccountSubscriptions')
        .withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique()
      if (subscription?.provider !== 'preview-fixture' || subscription.planKind !== 'paid'
        || subscription.status !== 'active' || subscription.providerCustomerId || subscription.providerSubscriptionId) {
        throw new Error('Recovery accepts only synthetic active paid fixtures')
      }
      const balance = await ctx.db.query('billingAccountBalances')
        .withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique()
      if (!balance || balance.mode !== 'budgeted') throw new Error('Budgeted QA balance is required')
      // Preserve spend, reservations, purchased funding, and all operation records.
      const includedMicros = Math.max(balance.includedMicros,
        balance.usedMicros + balance.reservedMicros + cents * 10_000
          - balance.institutionalGrantMicros - balance.topUpPurchasedMicros)
      await ctx.db.patch(balance._id, { includedMicros, version: balance.version + 1, updatedAt: Date.now() })
    }
    await ctx.db.insert('auditEvents', {
      eventId, actorType: 'system', action: 'preview.qa.recover', resourceType: 'workspace',
      resourceId: workspaceId, outcome: 'success', metadataJson: JSON.stringify(args), createdAt: Date.now(),
    })
    return { workspaceId, applied: true }
  },
})

/** Recovery permits re-verification; it never manufactures a safe provider receipt. */
export const recoverRoute = internalMutation({
  args: { routeKey: v.string(), expectedReason: v.string(), requestId: v.string() },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    requirePreviewDeployment()
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(args.requestId)
      || !args.routeKey || args.routeKey.length > 300 || !args.expectedReason || args.expectedReason.length > 500) {
      throw new Error('Route recovery requires a request id, route key and expected reason')
    }
    const eventId = `preview-qa-route-recovery:${args.requestId}`
    const metadataJson = JSON.stringify(args)
    const previous = await ctx.db.query('auditEvents').withIndex('by_eventId', q => q.eq('eventId', eventId)).unique()
    if (previous) {
      if (previous.resourceId !== args.routeKey || previous.metadataJson !== metadataJson) {
        throw new Error('Route recovery request id reused with different arguments')
      }
      return { applied: false }
    }
    const route = await ctx.db.query('overlayFreeRoutes').withIndex('by_routeKey', q => q.eq('routeKey', args.routeKey)).unique()
    if (!route || route.quarantineReason !== args.expectedReason) throw new Error('Route quarantine reason changed or is absent')
    if (route.activeLeaseToken !== undefined) throw new Error('Settle the route lease before recovery')
    let pricing: unknown
    try { pricing = JSON.parse(route.pricingJson) } catch { throw new Error('Route pricing is invalid') }
    if (!hasZeroPricing(pricing)) throw new Error('Route pricing must be explicitly zero')
    await ctx.db.patch(route._id, {
      quarantineReason: undefined, quarantineAt: undefined, cooldownUntil: undefined,
      catalogExpiresAt: 0, canaryVerifiedAt: undefined, canaryExpiresAt: undefined, updatedAt: Date.now(),
    })
    await ctx.db.insert('auditEvents', {
      eventId, actorType: 'system', action: 'preview.qa.route.recover', resourceType: 'model-route',
      resourceId: args.routeKey, outcome: 'success', metadataJson, createdAt: Date.now(),
    })
    return { applied: true }
  },
})
