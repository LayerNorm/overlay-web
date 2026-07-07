import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { Id, TableNames } from '../_generated/dataModel'
import { requireAccessToken, requireServerSecret } from '../lib/auth'
import { logAuthDebug, summarizeJwtForLog } from '../lib/authDebug'
import {
  DEFAULT_MARKUP_BASIS_POINTS,
  derivePlanAmountCents,
  derivePlanKind,
} from '../../src/shared/billing/billing-pricing'

// Sync user profile from auth system (called after login).
// For new users, always sets currentPeriodStart/End so the billingPeriodStart
// key in tokenUsage never falls back to "today" and drifts between sessions.
export const syncUserProfile = mutation({
  args: {
    accessToken: v.string(),
    userId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profilePictureUrl: v.optional(v.string()),
  },
  handler: async (ctx, { accessToken, userId, email, firstName, lastName, profilePictureUrl }) => {
    logAuthDebug('auth/users:syncUserProfile start', {
      userId,
      email,
      accessToken: summarizeJwtForLog(accessToken),
    })
    await requireAccessToken(accessToken, userId)
    logAuthDebug('auth/users:syncUserProfile access token verified', { userId })

    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (existing) {
      const patch: Record<string, unknown> = {
        email,
        firstName,
        lastName,
        profilePictureUrl,
        lastLoginAt: Date.now(),
      }

      // Backfill period timestamps for legacy rows that were created without them
      if (!existing.currentPeriodStart || existing.currentPeriodStart === 0) {
        const now = Date.now()
        patch.currentPeriodStart = now
        patch.currentPeriodEnd = now + 30 * 24 * 60 * 60 * 1000
      }
      if (existing.creditsUsed === undefined || existing.creditsUsed === null) {
        patch.creditsUsed = 0
      }
      if (!existing.planKind) {
        patch.planKind = derivePlanKind(existing)
      }
      if (!existing.planVersion) {
        patch.planVersion = existing.tier === 'free' ? 'fixed_v1' : 'variable_v2'
      }
      if (existing.planAmountCents === undefined || existing.planAmountCents === null) {
        patch.planAmountCents = derivePlanAmountCents(existing)
      }
      if (existing.markupBasisPoints === undefined || existing.markupBasisPoints === null) {
        patch.markupBasisPoints = DEFAULT_MARKUP_BASIS_POINTS
      }
      if (existing.autoTopUpEnabled === undefined) {
        patch.autoTopUpEnabled = false
      }

      await ctx.db.patch(existing._id, patch)
      logAuthDebug('auth/users:syncUserProfile updated existing subscription', { userId })
      return { success: true, isNewUser: false }
    } else {
      const now = Date.now()
      await ctx.db.insert('subscriptions', {
        userId,
        email,
        name: firstName && lastName ? `${firstName} ${lastName}` : firstName || email,
        firstName,
        lastName,
        profilePictureUrl,
        tier: 'free',
        planKind: 'free',
        planVersion: 'variable_v2',
        planAmountCents: 0,
        markupBasisPoints: DEFAULT_MARKUP_BASIS_POINTS,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
        creditsUsed: 0,
        autoTopUpEnabled: false,
        lastLoginAt: now,
      })
      logAuthDebug('auth/users:syncUserProfile created subscription', { userId })
      return { success: true, isNewUser: true }
    }
  },
})

export const syncUserProfileByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profilePictureUrl: v.optional(v.string()),
  },
  handler: async (ctx, { serverSecret, userId, email, firstName, lastName, profilePictureUrl }) => {
    requireServerSecret(serverSecret)
    logAuthDebug('auth/users:syncUserProfileByServer start', {
      userId,
      email,
    })

    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (existing) {
      const patch: Record<string, unknown> = {
        email,
        firstName,
        lastName,
        profilePictureUrl,
        lastLoginAt: Date.now(),
      }

      if (!existing.currentPeriodStart || existing.currentPeriodStart === 0) {
        const now = Date.now()
        patch.currentPeriodStart = now
        patch.currentPeriodEnd = now + 30 * 24 * 60 * 60 * 1000
      }
      if (existing.creditsUsed === undefined || existing.creditsUsed === null) {
        patch.creditsUsed = 0
      }
      if (!existing.planKind) {
        patch.planKind = derivePlanKind(existing)
      }
      if (!existing.planVersion) {
        patch.planVersion = existing.tier === 'free' ? 'fixed_v1' : 'variable_v2'
      }
      if (existing.planAmountCents === undefined || existing.planAmountCents === null) {
        patch.planAmountCents = derivePlanAmountCents(existing)
      }
      if (existing.markupBasisPoints === undefined || existing.markupBasisPoints === null) {
        patch.markupBasisPoints = DEFAULT_MARKUP_BASIS_POINTS
      }
      if (existing.autoTopUpEnabled === undefined) {
        patch.autoTopUpEnabled = false
      }

      await ctx.db.patch(existing._id, patch)
      logAuthDebug('auth/users:syncUserProfileByServer updated existing subscription', { userId })
      return { success: true, isNewUser: false }
    }

    const now = Date.now()
    await ctx.db.insert('subscriptions', {
      userId,
      email,
      name: firstName && lastName ? `${firstName} ${lastName}` : firstName || email,
      firstName,
      lastName,
      profilePictureUrl,
      tier: 'free',
      planKind: 'free',
      planVersion: 'variable_v2',
      planAmountCents: 0,
      markupBasisPoints: DEFAULT_MARKUP_BASIS_POINTS,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
      creditsUsed: 0,
      autoTopUpEnabled: false,
      lastLoginAt: now,
    })
    logAuthDebug('auth/users:syncUserProfileByServer created subscription', { userId })
    return { success: true, isNewUser: true }
  },
})

// Get user profile with subscription and usage data (for account page).
// creditsUsed is read from the subscription row directly — no tokenUsage join needed.
export const getUserProfile = query({
  args: { accessToken: v.string(), userId: v.string() },
  handler: async (ctx, { accessToken, userId }) => {
    try {
      await requireAccessToken(accessToken, userId)
    } catch {
      return null
    }

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (!subscription) {
      return null
    }

    const today = new Date().toISOString().split('T')[0]

    const dailyUsage = await ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
      .first()

    // Fetch the audit-log tokenUsage row for raw token counts (display only)
    const billingPeriodStart = subscription.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().split('T')[0]
      : today

    const tokenUsage = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
      )
      .first()

    return {
      profile: {
        userId: subscription.userId,
        email: subscription.email,
        name: subscription.name,
        firstName: subscription.firstName,
        lastName: subscription.lastName,
        profilePictureUrl: subscription.profilePictureUrl,
        lastLoginAt: subscription.lastLoginAt,
      },
      subscription: {
        tier: subscription.tier,
        planKind: derivePlanKind(subscription),
        planAmountCents: derivePlanAmountCents(subscription),
        status: subscription.status,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      usage: {
        // creditsUsed comes from subscription — single source of truth
        creditsUsed: subscription.creditsUsed ?? 0,
        creditsTotal: derivePlanAmountCents(subscription) / 100,
        // Raw token counts from audit log (may lag slightly behind creditsUsed)
        inputTokens: tokenUsage?.inputTokens ?? 0,
        outputTokens: tokenUsage?.outputTokens ?? 0,
        cachedInputTokens: tokenUsage?.cachedInputTokens ?? 0,
      },
      dailyUsage: {
        askCount: dailyUsage?.askCount ?? 0,
        writeCount: dailyUsage?.writeCount ?? 0,
        agentCount: dailyUsage?.agentCount ?? 0,
        transcriptionSeconds: dailyUsage?.transcriptionSeconds ?? 0,
        voiceChatCount: dailyUsage?.voiceChatCount ?? 0,
        noteBrowserCount: dailyUsage?.noteBrowserCount ?? 0,
        browserSearchCount: dailyUsage?.browserSearchCount ?? 0,
      },
    }
  },
})

/** Server-only: read persisted personalized chat starters (see chatStarterDay for daily refresh). */
export const getChatStartersByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!sub) return null
    const prompts = sub.chatStarterPrompts
    const day = sub.chatStarterDay
    if (!Array.isArray(prompts) || prompts.length !== 4 || typeof day !== 'string' || !day.trim()) {
      return null
    }
    return { prompts: prompts.map((p) => String(p)), day: day.trim() }
  },
})

/** Mark that a user has completed (or dismissed) the onboarding tour. */
export const markOnboardingComplete = mutation({
  args: { serverSecret: v.string(), userId: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { serverSecret, userId, email }) => {
    requireServerSecret(serverSecret)
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (sub) {
      await ctx.db.patch(sub._id, { hasSeenOnboarding: true })
      return { ok: true as const }
    }
    // Subscription row is normally created by syncUserProfile; if missing, bootstrap
    // a free-tier row so onboarding completion can persist.
    const safeEmail = email?.trim() || `${userId}@users.overlay.onboarding`
    const now = Date.now()
    await ctx.db.insert('subscriptions', {
      userId,
      email: safeEmail,
      name: safeEmail.split('@')[0] || 'User',
      tier: 'free',
      planKind: 'free',
      planVersion: 'variable_v2',
      planAmountCents: 0,
      markupBasisPoints: DEFAULT_MARKUP_BASIS_POINTS,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
      creditsUsed: 0,
      autoTopUpEnabled: false,
      lastLoginAt: now,
      hasSeenOnboarding: true,
    })
    return { ok: true as const, bootstrappedSubscription: true as const }
  },
})

/** Reset the onboarding flag so the tour replays on the next page load. */
export const resetOnboarding = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!sub) return { ok: false as const }
    await ctx.db.patch(sub._id, { hasSeenOnboarding: false })
    return { ok: true as const }
  },
})

/** Return whether the authenticated user has seen the onboarding tour. */
export const getOnboardingStatus = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!sub) return { hasSeenOnboarding: false }
    return { hasSeenOnboarding: sub.hasSeenOnboarding ?? false }
  },
})

/** Server-only: persist starters after generation (one row per user in subscriptions). */
export const setChatStartersByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    prompts: v.array(v.string()),
    day: v.string(),
  },
  handler: async (ctx, { serverSecret, userId, prompts, day }) => {
    requireServerSecret(serverSecret)
    const trimmed = prompts.map((p) => p.trim()).filter(Boolean)
    if (trimmed.length !== 4) {
      throw new Error('setChatStartersByServer: expected exactly 4 non-empty prompts')
    }
    const sub = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!sub) return { ok: false as const }
    await ctx.db.patch(sub._id, {
      chatStarterPrompts: trimmed,
      chatStarterDay: day.trim(),
    })
    return { ok: true as const }
  },
})

/**
 * Permanently delete every Convex row owned by `userId`, plus return the R2 keys
 * and Convex storage handles that the caller must purge afterwards.
 *
 * App Store guideline 5.1.1(v) requires in-app account deletion, so this is the
 * ground truth for "delete my account" on web, mobile, and desktop. Anything
 * keyed by userId in `convex/schema.ts` MUST be cleared here — adding a new
 * userId-scoped table without updating this mutation is a privacy bug.
 *
 * Server-secret-gated; never expose to the client.
 */
export const deleteUserAccountByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    r2Keys: v.array(v.string()),
    storageIds: v.array(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    deletedRowCount: v.number(),
    email: v.optional(v.string()),
  }),
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)

    if (!userId.trim()) throw new Error('userId is required')

    let deletedRowCount = 0
    const r2Keys: string[] = []
    const storageIds: string[] = []

    // Capture Stripe linkage from the subscription row before we delete it so
    // the API route can cancel the live subscription on Stripe.
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    const stripeSubscriptionId = subscription?.stripeSubscriptionId
    const stripeCustomerId = subscription?.stripeCustomerId
    const email = subscription?.email

    // Helper: delete every row returned by a query.
    async function deleteIndexed(
      runQuery: () => Promise<Array<{ _id: Id<TableNames> }>>,
    ): Promise<void> {
      const rows = await runQuery()
      for (const row of rows) {
        await ctx.db.delete(row._id)
        deletedRowCount += 1
      }
    }

    // 1. Tables with a `by_userId` (or compound) index — single-key lookup.
    await deleteIndexed(() =>
      ctx.db
        .query('userUiSettings')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('budgetTopUps')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('tokenUsage')
        .withIndex('by_userId_period', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('daytonaWorkspaces')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('daytonaUsageLedger')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('toolInvocations')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('dailyUsage')
        .withIndex('by_userId_date', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('apiKeys')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('projects')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('skills')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('automations')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('automationRuns')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('mcpServers')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('conversations')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('conversationMessages')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('notes')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('memories')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('knowledgeChunks')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('outputs')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )

    // 2. Files: collect R2 keys and Convex storage IDs before deletion so the
    //    API route can purge the underlying blobs after the DB write commits.
    const fileRows = await ctx.db
      .query('files')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
    for (const file of fileRows) {
      if (file.r2Key) r2Keys.push(file.r2Key)
      if (file.storageId) storageIds.push(file.storageId)
      await ctx.db.delete(file._id)
      deletedRowCount += 1
    }

    // 3. Large user-scoped tables. These must use indexes; full scans can exceed
    //    Convex's per-function read limit on production-sized deployments.
    await deleteIndexed(() =>
      ctx.db
        .query('knowledgeChunkEmbeddings')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('conversationMessageDeltas')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )

    // 4. Subscription row last so Stripe linkage stays available above. After
    //    this, the user has no rows left in Convex.
    if (subscription) {
      await ctx.db.delete(subscription._id)
      deletedRowCount += 1
    }

    return {
      r2Keys,
      storageIds,
      stripeSubscriptionId,
      stripeCustomerId,
      deletedRowCount,
      email,
    }
  },
})
