import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const MAX_ONBOARDING_SESSION_BYTES = 64_000
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type StoredOnboardingSession = {
  version: 1
  userId: string
  runId: string
  revision: number
  outbox: unknown[]
}

function readStoredSession(value: string | undefined, userId?: string): StoredOnboardingSession | null {
  if (!value || new TextEncoder().encode(value).length > MAX_ONBOARDING_SESSION_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const state = parsed as { version?: unknown; userId?: unknown; session?: unknown; outbox?: unknown }
    if (
      state.version !== 1
      || typeof state.userId !== 'string'
      || (userId !== undefined && state.userId !== userId)
      || !Array.isArray(state.outbox)
      || typeof state.session !== 'object'
      || state.session === null
      || Array.isArray(state.session)
    ) return null
    const stateKeys = ['version', 'userId', 'session', 'outbox']
    if (Object.keys(state).length !== stateKeys.length || Object.keys(state).some((key) => !stateKeys.includes(key))) return null
    const session = state.session as { version?: unknown; runId?: unknown; revision?: unknown }
    if (session.version !== 1 || typeof session.runId !== 'string' || !RUN_ID_PATTERN.test(session.runId)
      || !Number.isInteger(session.revision) || (session.revision as number) < 1) return null
    return { version: 1, userId: state.userId, runId: session.runId, revision: session.revision as number, outbox: state.outbox }
  } catch {
    return null
  }
}

export const getByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!subscription) return null
    return {
      hasSeenOnboarding: subscription.hasSeenOnboarding ?? false,
      onboardingSession: subscription.onboardingSession,
    }
  },
})

export const compareAndSetByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    expectedRevision: v.number(),
    expectedRunId: v.optional(v.string()),
    onboardingSession: v.optional(v.string()),
    hasSeenOnboarding: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.expectedRevision < 0 || !Number.isInteger(args.expectedRevision)) {
      throw new Error('Invalid onboarding revision')
    }
    if (args.onboardingSession && new TextEncoder().encode(args.onboardingSession).length > MAX_ONBOARDING_SESSION_BYTES) {
      throw new Error('Onboarding session is too large')
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()
    if (!subscription) return { ok: false as const, reason: 'subscription_not_found' as const }
    if (args.onboardingSession !== undefined) {
      const next = readStoredSession(args.onboardingSession, args.userId)
      if (!next || next.revision !== args.expectedRevision + 1) {
        return { ok: false as const, reason: 'invalid_state' as const, currentRevision: 0 }
      }
    }
    const current = subscription.onboardingSession
    const parsed = current ? readStoredSession(current, args.userId) : null
    const currentRevision = parsed?.revision ?? 0
    const currentRunId = parsed?.runId
    if (current && !parsed) {
      return { ok: false as const, reason: 'invalid_state' as const, currentRevision }
    }
    if (currentRevision !== args.expectedRevision || currentRunId !== args.expectedRunId) {
      return { ok: false as const, reason: 'stale_revision' as const, currentRevision, currentRunId }
    }
    await ctx.db.patch(subscription._id, {
      hasSeenOnboarding: args.hasSeenOnboarding,
      onboardingSession: args.onboardingSession,
    })
    return { ok: true as const, revision: args.expectedRevision + 1 }
  },
})

export const clearOutboxByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    expectedRevision: v.number(),
    expectedRunId: v.string(),
    onboardingSession: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (new TextEncoder().encode(args.onboardingSession).length > MAX_ONBOARDING_SESSION_BYTES) {
      throw new Error('Onboarding session is too large')
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()
    if (!subscription) return false
    const current = readStoredSession(subscription.onboardingSession, args.userId)
    const next = readStoredSession(args.onboardingSession, args.userId)
    if (!current || current.runId !== args.expectedRunId || current.revision !== args.expectedRevision
      || !next || next.runId !== args.expectedRunId || next.revision !== args.expectedRevision || next.outbox.length !== 0) return false
    await ctx.db.patch(subscription._id, { onboardingSession: args.onboardingSession })
    return true
  },
})

export const resetByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!subscription) return { ok: false as const }
    await ctx.db.patch(subscription._id, {
      hasSeenOnboarding: false,
      onboardingSession: undefined,
    })
    return { ok: true as const }
  },
})
