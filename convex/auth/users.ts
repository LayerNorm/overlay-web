import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { Id, TableNames } from '../_generated/dataModel'
import { requireAccessToken, requireServerSecret } from '../lib/auth'
import { logAuthDebug, summarizeJwtForLog } from '../lib/authDebug'

// Sync user profile from auth system (called after login). The row holds the person's profile, onboarding state and
// storage used; an account has no plan (plans belong to workspaces).
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
      lastLoginAt: now,
    })
    logAuthDebug('auth/users:syncUserProfileByServer created subscription', { userId })
    return { success: true, isNewUser: true }
  },
})

// Get the person's profile (for the app bootstrap and the account page).
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
    if (!subscription) return null
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
    deletedRowCount: v.number(),
    email: v.optional(v.string()),
  }),
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)

    if (!userId.trim()) throw new Error('userId is required')

    let deletedRowCount = 0
    const r2Keys: string[] = []
    const storageIds: string[] = []

    // Plans belong to workspaces, so a person has no subscription of their own to cancel; workspace plans are
    // handled with the workspace.
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    const email = subscription?.email

    // Helper: delete every row returned by a query.
    async function deleteIndexed(
      runQuery: () => Promise<Array<{ _id: Id<TableNames> }>>,
    ): Promise<void> {
      const rows = await runQuery()
      await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
      deletedRowCount += rows.length
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
        .query('agentProviderAccounts')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
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
        .query('budgetReservations')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('usageOperations')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect(),
    )
    await deleteIndexed(() =>
      ctx.db
        .query('administrativePrincipals')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    const actorAuditRows = await ctx.db
      .query('auditEvents')
      .withIndex('by_actorUserId_createdAt', (q) => q.eq('actorUserId', userId))
      .collect()
    await Promise.all(actorAuditRows.map((row) => ctx.db.patch(row._id, { actorUserId: undefined })))
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
        .query('mcpToolExecutions')
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
        .query('conversationAgentRuns')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
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

    // 2. Files: collect R2 keys and Convex storage IDs before deletion so the
    //    API route can purge the underlying blobs after the DB write commits.
    const fileRows = await ctx.db
      .query('files')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
    for (const file of fileRows) {
      if (file.r2Key) r2Keys.push(file.r2Key)
      if (file.storageId) storageIds.push(file.storageId)
    }
    await Promise.all(fileRows.map((file) => ctx.db.delete(file._id)))
    deletedRowCount += fileRows.length

    // 3. Large user-scoped tables. These must use indexes; full scans can exceed
    //    Convex's per-function read limit on production-sized deployments.
    await deleteIndexed(() =>
      ctx.db
        .query('knowledgeChunkEmbeddings')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    )
    // 4. The person's own row last. After this, the user has no rows left in Convex.
    if (subscription) {
      await ctx.db.delete(subscription._id)
      deletedRowCount += 1
    }

    return {
      r2Keys,
      storageIds,
      deletedRowCount,
      email,
    }
  },
})
