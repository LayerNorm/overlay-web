import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

const providerValidator = v.union(
  v.literal('codex'),
  v.literal('xai'),
  v.literal('meta'),
  v.literal('kimi'),
  v.literal('kimi-ai'),
  v.literal('devin'),
)

const operationValidator = v.union(
  v.literal('authorization'),
  v.literal('poll'),
  v.literal('refresh'),
  v.literal('discovery'),
)

const stateValidator = v.object({
  _id: v.id('providerSubscriptionStates'),
  _creationTime: v.number(),
  userId: v.string(),
  connectionId: v.id('userProviderConnections'),
  providerId: providerValidator,
  generation: v.number(),
  revision: v.number(),
  phase: v.union(
    v.literal('pending'),
    v.literal('discovering'),
    v.literal('active'),
    v.literal('needs_reconnect'),
    v.literal('disconnected'),
  ),
  credentialRef: v.optional(v.string()),
  pendingStateRef: v.optional(v.string()),
  nextPollAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  leaseToken: v.optional(v.string()),
  leaseUntil: v.optional(v.number()),
  leaseOperation: v.optional(operationValidator),
  cleanupRefs: v.array(v.string()),
  cleanupStatus: v.union(v.literal('clean'), v.literal('pending')),
  createdAt: v.number(),
  updatedAt: v.number(),
})

// Exchanges perform more than one provider request before the immutable vault
// write and fenced Convex commit. Keep enough room for that bounded operation;
// callers still impose a shorter provider-network deadline.
const leaseDurationMs = 60_000

function dedupeRefs(...values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

async function loadConnection(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<'userProviderConnections'>,
  userId: string,
  providerId: string,
) {
  const connection = await ctx.db.get(connectionId)
  if (
    !connection ||
    connection.userId !== userId ||
    connection.authKind !== 'subscription' ||
    connection.subscriptionProvider !== providerId ||
    connection.providerId !== `subscription:${providerId}` ||
    connection.endpoint !== ''
  ) {
    throw new Error('Subscription connection not found')
  }
  return connection
}

async function loadState(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<'userProviderConnections'>,
): Promise<Doc<'providerSubscriptionStates'> | null> {
  return await ctx.db
    .query('providerSubscriptionStates')
    .withIndex('by_connectionId', (q) => q.eq('connectionId', connectionId))
    .unique()
}

function assertLease(
  state: Doc<'providerSubscriptionStates'> | null,
  leaseToken: string,
  generation: number,
  revision: number,
  operation?: Doc<'providerSubscriptionStates'>['leaseOperation'],
  now = Date.now(),
) {
  if (
    !state ||
    state.generation !== generation ||
    state.revision !== revision ||
    state.leaseToken !== leaseToken ||
    !state.leaseUntil ||
    state.leaseUntil <= now ||
    (operation && state.leaseOperation !== operation)
  ) {
    throw new Error('Subscription operation is no longer current')
  }
}

function cleanupStatus(refs: string[]) {
  return refs.length ? 'pending' as const : 'clean' as const
}

export const getByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
  },
  returns: v.union(stateValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) return null
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    return state
  },
})

export const listByUserByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(stateValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('providerSubscriptionStates')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()
  },
})

export const getForDispatchByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    modelId: v.string(),
  },
  returns: v.union(
    v.object({
      providerId: providerValidator,
      credentialRef: v.string(),
      generation: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId || state.phase !== 'active' ||
        !state.credentialRef) return null
    const connection = await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    if (
      connection.status !== 'active' ||
      !connection.enabledModelIds.includes(args.modelId) ||
      !isDiscovered(connection.discoveredModelsJson, args.modelId)
    ) return null
    return {
      providerId: state.providerId,
      credentialRef: state.credentialRef,
      generation: state.generation,
    }
  },
})

export const reserveAuthorization = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    providerId: providerValidator,
    leaseToken: v.string(),
  },
  returns: v.object({
    generation: v.number(),
    revision: v.number(),
    leaseUntil: v.number(),
    cleanupRefs: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const connection = await loadConnection(ctx, args.connectionId, args.userId, args.providerId)
    const now = Date.now()
    const previous = await loadState(ctx, args.connectionId)
    if (previous?.leaseUntil && previous.leaseUntil > now) {
      throw new Error('Subscription connection is busy')
    }
    const generation = (previous?.generation ?? 0) + 1
    const revision = (previous?.revision ?? 0) + 1
    const leaseUntil = now + leaseDurationMs
    const cleanupRefs = dedupeRefs(
      ...(previous?.cleanupRefs ?? []),
      previous?.credentialRef,
      previous?.pendingStateRef,
    )
    const value = {
      userId: args.userId,
      connectionId: args.connectionId,
      providerId: args.providerId,
      generation,
      revision,
      phase: 'pending' as const,
      leaseToken: args.leaseToken,
      leaseUntil,
      leaseOperation: 'authorization' as const,
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (previous) await ctx.db.replace(previous._id, value)
    else await ctx.db.insert('providerSubscriptionStates', value)
    await ctx.db.patch(connection._id, {
      status: 'pending',
      lastError: undefined,
      updatedAt: now,
    })
    return { generation, revision, leaseUntil, cleanupRefs }
  },
})

export const savePendingAuthorization = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
    pendingStateRef: v.string(),
    expiresAt: v.number(),
    pollIntervalMs: v.number(),
  },
  returns: v.object({
    revision: v.number(),
    cleanupRefs: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision, 'authorization')
    const now = Date.now()
    if (args.expiresAt <= now || args.expiresAt > now + 20 * 60_000) {
      throw new Error('Invalid subscription authorization expiry')
    }
    const cleanupRefs = dedupeRefs(...state.cleanupRefs, state.pendingStateRef)
    await ctx.db.patch(state._id, {
      revision: state.revision + 1,
      pendingStateRef: args.pendingStateRef,
      expiresAt: args.expiresAt,
      nextPollAt: now + Math.max(2_000, Math.min(args.pollIntervalMs, 30_000)),
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      updatedAt: now,
    })
    return { revision: state.revision + 1, cleanupRefs }
  },
})

export const acquirePoll = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    leaseToken: v.string(),
  },
  returns: v.object({
    generation: v.optional(v.number()),
    revision: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    pendingStateRef: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId || state.phase !== 'pending' ||
        !state.pendingStateRef || !state.expiresAt) {
      throw new Error('Subscription authorization is unavailable')
    }
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    const now = Date.now()
    if (state.expiresAt <= now) {
      await markNeedsReconnect(ctx, state, now)
      return { error: 'Subscription authorization expired' }
    }
    if (state.nextPollAt && state.nextPollAt > now) throw new Error('Subscription poll is not due')
    if (state.leaseUntil && state.leaseUntil > now) throw new Error('Subscription connection is busy')
    if (state.leaseOperation === 'authorization' && state.leaseUntil && state.leaseUntil <= now) {
      await markNeedsReconnect(ctx, state, now)
      return { error: 'Subscription authorization outcome is uncertain' }
    }
    if (state.leaseOperation === 'poll' && state.leaseUntil && state.leaseUntil <= now) {
      await markNeedsReconnect(ctx, state, now)
      return { error: 'Subscription authorization outcome is uncertain' }
    }
    const revision = state.revision + 1
    const leaseUntil = now + leaseDurationMs
    await ctx.db.patch(state._id, {
      revision,
      leaseToken: args.leaseToken,
      leaseUntil,
      leaseOperation: 'poll',
      updatedAt: now,
    })
    return {
      generation: state.generation,
      revision,
      leaseUntil,
      pendingStateRef: state.pendingStateRef,
      expiresAt: state.expiresAt,
    }
  },
})

export const releasePendingPoll = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
    pollIntervalMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision, 'poll')
    const now = Date.now()
    await ctx.db.patch(state._id, {
      revision: state.revision + 1,
      nextPollAt: now + Math.max(2_000, Math.min(args.pollIntervalMs, 30_000)),
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      updatedAt: now,
    })
    return null
  },
})

export const acquireRefresh = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    leaseToken: v.string(),
  },
  returns: v.object({
    generation: v.optional(v.number()),
    revision: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    credentialRef: v.optional(v.string()),
    providerId: v.optional(providerValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId || state.phase !== 'active' || !state.credentialRef) {
      throw new Error('Subscription credential is unavailable')
    }
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    const now = Date.now()
    if (state.leaseUntil && state.leaseUntil > now) throw new Error('Subscription connection is busy')
    if (state.leaseOperation === 'refresh' && state.leaseUntil && state.leaseUntil <= now) {
      await markNeedsReconnect(ctx, state, now)
      return { error: 'Subscription refresh outcome is uncertain' }
    }
    const revision = state.revision + 1
    const leaseUntil = now + leaseDurationMs
    await ctx.db.patch(state._id, {
      revision,
      leaseToken: args.leaseToken,
      leaseUntil,
      leaseOperation: 'refresh',
      updatedAt: now,
    })
    return {
      generation: state.generation,
      revision,
      leaseUntil,
      credentialRef: state.credentialRef,
      providerId: state.providerId,
    }
  },
})

export const releaseRefresh = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    assertLease(state, args.leaseToken, args.generation, args.revision, 'refresh')
    await ctx.db.patch(state._id, {
      revision: state.revision + 1,
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const commitCredentialForDiscovery = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
    credentialRef: v.string(),
  },
  returns: v.object({
    revision: v.number(),
    cleanupRefs: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision)
    if (state.leaseOperation !== 'poll' && state.leaseOperation !== 'refresh') {
      throw new Error('Subscription operation is no longer current')
    }
    const cleanupRefs = dedupeRefs(
      ...state.cleanupRefs,
      state.pendingStateRef,
      state.credentialRef,
    ).filter((ref) => ref !== args.credentialRef)
    const revision = state.revision + 1
    await ctx.db.patch(state._id, {
      revision,
      phase: 'discovering',
      credentialRef: args.credentialRef,
      pendingStateRef: undefined,
      nextPollAt: undefined,
      expiresAt: undefined,
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      updatedAt: Date.now(),
    })
    return { revision, cleanupRefs }
  },
})

export const acquireDiscovery = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    leaseToken: v.string(),
  },
  returns: v.object({
    generation: v.optional(v.number()),
    revision: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    credentialRef: v.optional(v.string()),
    providerId: v.optional(providerValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId ||
        (state.phase !== 'discovering' && state.phase !== 'active') ||
        !state.credentialRef) {
      throw new Error('Subscription credential is unavailable for discovery')
    }
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    const now = Date.now()
    if (state.leaseUntil && state.leaseUntil > now) throw new Error('Subscription connection is busy')
    if (state.leaseOperation === 'refresh' && state.leaseUntil && state.leaseUntil <= now) {
      await markNeedsReconnect(ctx, state, now)
      return { error: 'Subscription refresh outcome is uncertain' }
    }
    const revision = state.revision + 1
    const leaseUntil = now + leaseDurationMs
    await ctx.db.patch(state._id, {
      revision,
      leaseToken: args.leaseToken,
      leaseUntil,
      leaseOperation: 'discovery',
      updatedAt: now,
    })
    return {
      generation: state.generation,
      revision,
      leaseUntil,
      credentialRef: state.credentialRef,
      providerId: state.providerId,
    }
  },
})

export const releaseDiscovery = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision, 'discovery')
    await ctx.db.patch(state._id, {
      revision: state.revision + 1,
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const commitActive = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
    credentialRef: v.string(),
    discoveredModelsJson: v.string(),
    discoveredModelIds: v.array(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: v.object({
    revision: v.number(),
    enabledModelIds: v.array(v.string()),
    cleanupRefs: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    const connection = await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision, 'discovery')
    const now = Date.now()
    const discovered = new Set(args.discoveredModelIds)
    const retainedSelection = connection.discoveredAt === undefined
      ? args.discoveredModelIds
      : connection.enabledModelIds.filter((modelId) => discovered.has(modelId))
    const cleanupRefs = dedupeRefs(
      ...state.cleanupRefs,
      state.pendingStateRef,
      state.credentialRef,
    ).filter((ref) => ref !== args.credentialRef)
    const revision = state.revision + 1
    await ctx.db.patch(state._id, {
      revision,
      phase: 'active',
      credentialRef: args.credentialRef,
      pendingStateRef: undefined,
      nextPollAt: undefined,
      expiresAt: undefined,
      leaseToken: undefined,
      leaseUntil: undefined,
      leaseOperation: undefined,
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      updatedAt: now,
    })
    await ctx.db.patch(connection._id, {
      status: 'active',
      displayName: args.displayName ?? connection.displayName,
      discoveredModelsJson: args.discoveredModelsJson,
      discoveredAt: now,
      enabledModelIds: retainedSelection,
      lastError: undefined,
      lastTestedAt: now,
      updatedAt: now,
    })
    return { revision, enabledModelIds: retainedSelection, cleanupRefs }
  },
})

export const failClosed = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    generation: v.number(),
    revision: v.number(),
    leaseToken: v.string(),
    error: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId) throw new Error('Subscription connection not found')
    const connection = await loadConnection(ctx, args.connectionId, args.userId, state.providerId)
    assertLease(state, args.leaseToken, args.generation, args.revision)
    await markNeedsReconnect(ctx, state, Date.now())
    await ctx.db.patch(connection._id, {
      status: 'error',
      lastError: args.error.slice(0, 160),
      enabledModelIds: [],
      updatedAt: Date.now(),
    })
    const updated = await loadState(ctx, args.connectionId)
    return updated?.cleanupRefs ?? []
  },
})

export const disconnect = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const connection = await ctx.db.get(args.connectionId)
    if (!connection || connection.userId !== args.userId ||
        connection.authKind !== 'subscription' || connection.endpoint !== '' ||
        !connection.subscriptionProvider ||
        connection.providerId !== `subscription:${connection.subscriptionProvider}`) {
      throw new Error('Subscription connection not found')
    }
    const state = await loadState(ctx, args.connectionId)
    const now = Date.now()
    const cleanupRefs = dedupeRefs(
      ...(state?.cleanupRefs ?? []),
      state?.credentialRef,
      state?.pendingStateRef,
    )
    const generation = (state?.generation ?? 0) + 1
    const revision = (state?.revision ?? 0) + 1
    const value = {
      userId: args.userId,
      connectionId: args.connectionId,
      providerId: connection.subscriptionProvider,
      generation,
      revision,
      phase: 'disconnected' as const,
      // Keep cleanup authority while an already-running vault write may finish.
      leaseUntil: state?.leaseUntil,
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      createdAt: state?.createdAt ?? now,
      updatedAt: now,
    }
    if (state) await ctx.db.replace(state._id, value)
    else await ctx.db.insert('providerSubscriptionStates', value)
    await ctx.db.patch(connection._id, {
      status: 'error',
      enabledModelIds: [],
      discoveredModelsJson: '[]',
      lastError: undefined,
      updatedAt: now,
    })
    return cleanupRefs
  },
})

export const revokeAllByUser = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const states = await ctx.db
      .query('providerSubscriptionStates')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()
    const refs: string[] = []
    const now = Date.now()
    for (const state of states) {
      refs.push(...state.cleanupRefs, ...(state.credentialRef ? [state.credentialRef] : []),
        ...(state.pendingStateRef ? [state.pendingStateRef] : []))
      const connection = await ctx.db.get(state.connectionId)
      if (connection && connection.userId === args.userId) {
        await ctx.db.patch(connection._id, {
          status: 'error',
          enabledModelIds: [],
          discoveredModelsJson: '[]',
          updatedAt: now,
        })
      }
      await ctx.db.patch(state._id, {
        generation: state.generation + 1,
        revision: state.revision + 1,
        phase: 'disconnected',
        credentialRef: undefined,
        pendingStateRef: undefined,
        nextPollAt: undefined,
        expiresAt: undefined,
        leaseToken: undefined,
        leaseOperation: undefined,
        cleanupRefs: dedupeRefs(...state.cleanupRefs, state.credentialRef, state.pendingStateRef),
        cleanupStatus: cleanupStatus(dedupeRefs(...state.cleanupRefs, state.credentialRef, state.pendingStateRef)),
        updatedAt: now,
      })
    }
    return [...new Set(refs)]
  },
})

export const removeCleanupRef = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    credentialRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId ||
        !state.cleanupRefs.includes(args.credentialRef) ||
        state.credentialRef === args.credentialRef ||
        state.pendingStateRef === args.credentialRef) {
      throw new Error('Subscription cleanup is unavailable')
    }
    const cleanupRefs = state.cleanupRefs.filter((ref) => ref !== args.credentialRef)
    await ctx.db.patch(state._id, {
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      updatedAt: Date.now(),
    })
    return null
  },
})

export const retainCleanupRef = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
    credentialRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId ||
        state.credentialRef === args.credentialRef ||
        state.pendingStateRef === args.credentialRef) {
      throw new Error('Subscription cleanup is unavailable')
    }
    if (state.cleanupRefs.includes(args.credentialRef)) return null
    const cleanupRefs = dedupeRefs(...state.cleanupRefs, args.credentialRef)
    await ctx.db.patch(state._id, {
      cleanupRefs,
      cleanupStatus: cleanupStatus(cleanupRefs),
      updatedAt: Date.now(),
    })
    return null
  },
})

export const forgetAllByUser = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const states = await ctx.db
      .query('providerSubscriptionStates')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()
    if (states.some((state) =>
      state.credentialRef || state.pendingStateRef || state.cleanupRefs.length > 0 ||
      (state.leaseUntil !== undefined && state.leaseUntil > Date.now())
    )) {
      throw new Error('Subscription credentials remain during account deletion')
    }
    for (const state of states) await ctx.db.delete(state._id)
    return null
  },
})

export const forgetDisconnectedByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    connectionId: v.id('userProviderConnections'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const state = await loadState(ctx, args.connectionId)
    if (!state || state.userId !== args.userId || state.phase !== 'disconnected' ||
        state.credentialRef || state.pendingStateRef || state.cleanupRefs.length > 0 ||
        (state.leaseUntil !== undefined && state.leaseUntil > Date.now())) {
      throw new Error('Subscription cleanup is still pending')
    }
    await ctx.db.delete(state._id)
    return null
  },
})

function isDiscovered(json: string | undefined, modelId: string): boolean {
  if (!json) return false
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !Array.isArray(parsed.data)) {
      return false
    }
    return parsed.data.some((item) =>
      item && typeof item === 'object' && 'id' in item && item.id === modelId
    )
  } catch {
    return false
  }
}

async function markNeedsReconnect(
  ctx: MutationCtx,
  state: Doc<'providerSubscriptionStates'>,
  now: number,
) {
  const cleanupRefs = dedupeRefs(...state.cleanupRefs, state.credentialRef, state.pendingStateRef)
  await ctx.db.patch(state._id, {
    revision: state.revision + 1,
    phase: 'needs_reconnect',
    credentialRef: undefined,
    pendingStateRef: undefined,
    nextPollAt: undefined,
    expiresAt: undefined,
    leaseToken: undefined,
    leaseUntil: undefined,
    leaseOperation: undefined,
    cleanupRefs,
    cleanupStatus: cleanupStatus(cleanupRefs),
    updatedAt: now,
  })
  const connection = await ctx.db.get(state.connectionId)
  if (connection && connection.userId === state.userId) {
    await ctx.db.patch(connection._id, {
      status: 'error',
      enabledModelIds: [],
      updatedAt: now,
    })
  }
}
