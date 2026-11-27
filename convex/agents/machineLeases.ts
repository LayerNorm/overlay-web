import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { finalizeWorkspaceLedger, workspaceAvailableMicros, workspaceBudgetLowAfterCharge, workspaceRemainingCents } from '../platform/usage'
import { chargeSandboxSpendLimits } from '../lib/sandboxSpendLimits'
import { insertUsageOperation } from '../billing/usageTotals'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

/**
 * Machine leases for cloud Computers (and retained environment leases), their
 * lifecycle claims and metering, plus the connected-environment helpers that
 * "This Mac" still uses. Third-party agent runs were removed; their tables stay
 * unreferenced until production holds no live rows.
 */
const anyObject = v.any()

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
function clean<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}

/** Connected machines count against the workspace's environment limit. */
export const getWorkspacePolicyUsageByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.object({ environments: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const groups = await Promise.all((['pending', 'offline', 'online'] as const).map((status) =>
      ctx.db.query('agentEnvironments')
        .withIndex('by_workspaceId_status', (q) => q.eq('workspaceId', args.workspaceId).eq('status', status))
        .take(101)))
    return { environments: groups.flat().length }
  },
})

export const createSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.optional(v.string()), computerId: v.optional(v.string()),
    runId: v.optional(v.string()), provider: v.string(), providerReference: v.optional(v.string()),
    status: v.string(), reservationId: v.optional(v.string()), reservedUntil: v.number(),
    runtimeStartedAt: v.optional(v.number()), runtimeEndedAt: v.optional(v.number()),
    usage: anyObject, cleanupAttempts: v.number(), cleanupAfter: v.optional(v.number()),
    nextMeterAt: v.optional(v.number()), meterClaimToken: v.optional(v.string()), meterClaimUntil: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if ((args.environmentId === undefined) === (args.computerId === undefined)) throw new Error('SANDBOX_LEASE_ASSOCIATION_INVALID')
    if (args.environmentId !== undefined) {
      const environment = await ctx.db.query('agentEnvironments')
        .withIndex('by_environmentId', (q) => q.eq('environmentId', args.environmentId!)).unique()
      if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') {
        throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
      }
    } else {
      const computer = await ctx.db.query('computers')
        .withIndex('by_entityId', (q) => q.eq('id', args.computerId!)).unique()
      if (!computer || computer.workspaceId !== args.workspaceId) throw new Error('COMPUTER_UNAVAILABLE')
    }
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, leaseId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentSandboxLeases', row)
    return { ...row, id }
  },
})

export const updateSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    status: v.optional(v.string()), providerReference: v.optional(v.string()),
    reservationId: v.optional(v.string()), reservedUntil: v.optional(v.number()),
    runtimeStartedAt: v.optional(v.number()), runtimeEndedAt: v.optional(v.number()),
    usage: v.optional(anyObject), cleanupAttempts: v.optional(v.number()),
    cleanupAfter: v.optional(v.number()), nextMeterAt: v.optional(v.number()),
    meterClaimToken: v.optional(v.string()), meterClaimUntil: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId))
      .unique()
    if (!current || current.workspaceId !== args.workspaceId) return null
    const { serverSecret, workspaceId, leaseId, now, ...updates } = args
    void serverSecret
    void workspaceId
    void leaseId
    await ctx.db.patch(current._id, { ...updates, updatedAt: now })
    return { ...clean(current), ...updates, updatedAt: now, id: current.leaseId }
  },
})

export const getActiveSandboxLeaseByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_workspaceId_environmentId', (q) =>
        q
          .eq('workspaceId', args.workspaceId)
          .eq('environmentId', args.environmentId),
      )
      .take(100)
    const current = rows
      .filter((row) =>
        ['reserved', 'provisioning', 'running'].includes(row.status),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    return current ? { ...clean(current), id: current.leaseId } : null
  },
})

export const getSandboxLeaseByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId))
      .unique()
    if (!row || row.workspaceId !== args.workspaceId) return null
    return { ...clean(row), id: row.leaseId }
  },
})

export const listSandboxLeasesByServer = query({
  args: {
    serverSecret: v.string(), statuses: v.array(v.string()),
    cleanupBefore: v.optional(v.number()), limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.max(1, Math.min(1_000, args.limit ?? 100))
    const groups = await Promise.all(args.statuses.map((status) =>
      ctx.db.query('agentSandboxLeases')
        .withIndex('by_status_nextMeterAt', (q) => q.eq('status', status))
        .take(limit)))
    return groups
      .flat()
      .filter(
        (row) =>
          args.cleanupBefore === undefined ||
          (row.cleanupAfter ?? 0) <= args.cleanupBefore,
      )
      .sort((left, right) => (left.nextMeterAt ?? 0) - (right.nextMeterAt ?? 0) || left.updatedAt - right.updatedAt)
      .slice(0, limit)
      .map((row) => ({ ...clean(row), id: row.leaseId }))
  },
})

export const claimSandboxLeasesByServer = mutation({
  args: {
    serverSecret: v.string(), statuses: v.array(v.string()), now: v.number(),
    limit: v.number(), claimToken: v.string(), claimUntil: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.max(1, Math.min(20, args.limit))
    const groups = await Promise.all(args.statuses.map((status) =>
      ctx.db.query('agentSandboxLeases')
        .withIndex('by_status_nextMeterAt', (q) => q.eq('status', status))
        .take(limit)))
    const candidates = groups.flat()
      .sort((left, right) => (left.nextMeterAt ?? 0) - (right.nextMeterAt ?? 0) || left.updatedAt - right.updatedAt)
    const eligible = []
    let deferred = false
    for (const row of candidates) {
      const nextDue = Math.max(row.nextMeterAt ?? 0, row.cleanupAfter ?? 0, row.meterClaimUntil ?? 0)
      if (nextDue > args.now) {
        if ((row.nextMeterAt ?? 0) < nextDue) {
          await ctx.db.patch(row._id, { nextMeterAt: nextDue, updatedAt: args.now })
          deferred = true
        }
        continue
      }
      eligible.push(row)
    }
    const seen = new Set<string>()
    const claimed = eligible.filter((row) => {
      if (seen.has(row.leaseId) || seen.size >= limit) return false
      seen.add(row.leaseId)
      return true
    })
    for (const row of claimed) {
      await ctx.db.patch(row._id, {
        nextMeterAt: args.now + 2 * 60_000,
        meterClaimToken: args.claimToken,
        meterClaimUntil: args.claimUntil,
        updatedAt: args.now,
      })
    }
    return { leases: claimed.map((row) => ({
      ...clean(row), id: row.leaseId, nextMeterAt: args.now + 2 * 60_000,
      meterClaimToken: args.claimToken, meterClaimUntil: args.claimUntil,
    })), deferred }
  },
})

export const finishSandboxLeaseClaimByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    claimToken: v.string(), now: v.number(), nextMeterAt: v.number(),
    cleanupAfter: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.meterClaimToken !== args.claimToken
      || ['released', 'deleted'].includes(row.status)) return false
    const lifecycle = computerLifecycleUsage((row.usage ?? {}) as Record<string, unknown>)
    const maintenance = lifecycle.maintenance as { kind?: string; expiresAt?: number } | null | undefined
    const urgentComputerCleanup = row.computerId !== undefined
      && ['stop', 'idle', 'delete'].includes(maintenance?.kind ?? '')
    await ctx.db.patch(row._id, {
      nextMeterAt: urgentComputerCleanup ? Math.min(args.nextMeterAt, args.now) : args.nextMeterAt,
      meterClaimToken: null,
      meterClaimUntil: null,
      ...(args.cleanupAfter === undefined ? {} : { cleanupAfter: args.cleanupAfter }),
      updatedAt: args.now,
    })
    return true
  },
})

export const patchSandboxLeaseUsageByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    patch: anyObject, now: v.number(),
    // Schedule the idle check for this long from now. A new token replaces any earlier one, so an earlier
    // timer finds its token stale and does nothing: patching with `idleToken: null` cancels without deleting.
    idleCheckInMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId))
      .unique()
    if (!current || current.workspaceId !== args.workspaceId) return null
    const usage: Record<string, unknown> = { ...((current.usage ?? {}) as Record<string, unknown>), ...args.patch }
    if (args.idleCheckInMs !== undefined) {
      const delay = Math.max(1_000, Math.floor(args.idleCheckInMs))
      const token = `${args.now.toString(36)}${Math.random().toString(36).slice(2, 10)}`
      usage.idleToken = token
      usage.idleCheckAt = args.now + delay
      await ctx.scheduler.runAfter(delay, internal.agents.idleStop.runIdleCheck, {
        workspaceId: args.workspaceId, leaseId: args.leaseId, token,
      })
    }
    await ctx.db.patch(current._id, { usage, updatedAt: args.now })
    return { ...clean(current), usage, updatedAt: args.now, id: current.leaseId }
  },
})

function computerLifecycleUsage(usage: Record<string, unknown>) {
  const value = usage.computerLifecycle
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export const transitionComputerLifecycleByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), computerId: v.string(), leaseId: v.string(),
    token: v.string(), transition: v.union(v.literal('wake_armed'), v.literal('session_armed'), v.literal('ready'), v.literal('paused'), v.literal('deleted'), v.literal('failed'), v.literal('cancelled')),
    expectedProviderReference: v.union(v.string(), v.null()), now: v.number(),
    reservedUntil: v.optional(v.number()), cleanupAfter: v.optional(v.union(v.number(), v.null())),
    cleanupAttempts: v.optional(v.number()),
    activityToken: v.optional(v.string()), activityUserId: v.optional(v.string()),
    activityExpiresAt: v.optional(v.number()),
    allocationRetryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', q => q.eq('leaseId', args.leaseId)).unique()
    const computer = await ctx.db.query('computers').withIndex('by_entityId', q => q.eq('id', args.computerId)).unique()
    if (!lease || !computer || lease.workspaceId !== args.workspaceId || computer.workspaceId !== args.workspaceId
      || lease.computerId !== args.computerId || args.leaseId !== `computer:${args.computerId}`
      || (lease.providerReference ?? null) !== args.expectedProviderReference
      || (computer.providerRef ?? null) !== args.expectedProviderReference) return false
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const maintenance = lifecycle.maintenance as { token?: string; kind?: string; expiresAt?: number } | null | undefined
    if (maintenance?.token !== args.token) return false
    if (['released', 'deleted'].includes(lease.status)) return false
    if (args.transition === 'wake_armed') {
      if (maintenance.kind !== 'wake') return false
      if (!['paused', 'running', 'reserved', 'provisioning'].includes(lease.status)) return false
      await ctx.db.patch(lease._id, {
        status: 'reserved', reservedUntil: args.reservedUntil ?? args.now + 2 * 60 * 60_000,
        runtimeStartedAt: args.now, runtimeEndedAt: null, cleanupAfter: null, nextMeterAt: args.now + 60_000,
        usage: { ...usage, lastProviderEvidence: null, stoppedEvidenceInvalidatedAt: args.now },
        updatedAt: args.now,
      })
      return true
    }
    if (args.transition === 'session_armed') {
      if (maintenance.kind !== 'provision' || !['reserved', 'provisioning', 'cleanup_failed'].includes(lease.status)) return false
      await ctx.db.patch(lease._id, {
        status: 'provisioning', runtimeStartedAt: args.now, runtimeEndedAt: null,
        reservedUntil: args.reservedUntil ?? args.now + 2 * 60 * 60_000,
        cleanupAfter: null, nextMeterAt: args.now + 60_000,
        meterClaimToken: null, meterClaimUntil: null, updatedAt: args.now,
      })
      return true
    }
    if (args.transition === 'ready') {
      if (!['reserved', 'provisioning', 'paused', 'running', 'cleanup_failed'].includes(lease.status)) return false
      if (!['provision', 'wake'].includes(maintenance.kind ?? '')) return false
      const activityArgsPresent = args.activityToken !== undefined
        || args.activityUserId !== undefined || args.activityExpiresAt !== undefined
      if (activityArgsPresent && (!args.activityToken || !args.activityUserId
        || args.activityExpiresAt === undefined || args.activityExpiresAt <= args.now)) return false
      const tokens = (lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
        ? lifecycle.activityTokens as Record<string, { expiresAt?: number }>
        : {})
      const activeTokens = Object.fromEntries(Object.entries(tokens)
        .filter(([, value]) => (value.expiresAt ?? 0) > args.now))
      if (args.activityToken && Object.keys(activeTokens).length >= 64) return false
      const activityTokens = args.activityToken && args.activityUserId && args.activityExpiresAt !== undefined
        ? { ...activeTokens, [args.activityToken]: { userId: args.activityUserId, expiresAt: args.activityExpiresAt } }
        : activeTokens
      await ctx.db.patch(lease._id, {
        status: 'running', runtimeStartedAt: args.now,
        runtimeEndedAt: null, reservedUntil: args.reservedUntil ?? lease.reservedUntil,
        cleanupAfter: null, cleanupAttempts: 0, nextMeterAt: args.now + 60_000,
        meterClaimToken: null, meterClaimUntil: null,
        usage: { ...usage, computerLifecycle: { ...lifecycle, maintenance: null, activityTokens } },
        updatedAt: args.now,
      })
      await ctx.db.patch(computer._id, { status: 'ready', lastActiveAt: args.now, updatedAt: args.now })
      return true
    }
    if (args.transition === 'cancelled') {
      if (!['reserved', 'provisioning', 'paused', 'running', 'cleanup_failed'].includes(lease.status)) return false
      if (!['provision', 'wake'].includes(maintenance.kind ?? '')) return false
      await ctx.db.patch(lease._id, {
        usage: {
          ...usage,
          ...(args.allocationRetryable === undefined ? {} : { allocationRetryable: args.allocationRetryable }),
          computerLifecycle: { ...lifecycle, maintenance: null },
        },
        updatedAt: args.now,
      })
      return true
    }
    if (args.transition === 'failed') {
      if (!['reserved', 'provisioning', 'running', 'stopping', 'cleanup_failed', 'paused'].includes(lease.status)) return false
      const retryAt = args.cleanupAfter ?? args.now + 60_000
      const maintenanceUntil = (maintenance as { expiresAt?: number } | null)?.expiresAt ?? 0
      await ctx.db.patch(lease._id, {
        status: 'cleanup_failed', cleanupAfter: retryAt,
        cleanupAttempts: args.cleanupAttempts ?? lease.cleanupAttempts + 1,
        nextMeterAt: Math.max(retryAt, maintenanceUntil), updatedAt: args.now,
      })
      return true
    }
    if (args.transition === 'deleted' && maintenance.kind !== 'delete') return false
    if (args.transition === 'paused' && !['stop', 'idle', 'delete'].includes(maintenance.kind ?? '')) return false
    if (!['running', 'stopping', 'cleanup_failed', 'paused', 'reserved', 'provisioning'].includes(lease.status)) return false
    await ctx.db.patch(lease._id, {
      status: args.transition === 'deleted' ? 'released' : 'paused',
      reservedUntil: args.now, runtimeEndedAt: args.now, cleanupAfter: null,
      cleanupAttempts: 0, nextMeterAt: null,
      meterClaimToken: null, meterClaimUntil: null,
      usage: { ...usage, computerLifecycle: { ...lifecycle, maintenance: null, adoptionPending: false } },
      updatedAt: args.now,
    })
    if (args.transition === 'deleted') await ctx.db.delete(computer._id)
    else await ctx.db.patch(computer._id, {
      status: 'stopped',
      controlledByUserId: undefined,
      controlTakenAt: undefined,
      updatedAt: args.now,
    })
    return true
  },
})

export const claimComputerMaintenanceByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    kind: v.union(v.literal('provision'), v.literal('wake'), v.literal('stop'), v.literal('delete'), v.literal('idle')),
    token: v.string(), now: v.number(), expiresAt: v.number(), force: v.optional(v.boolean()),
    idleBefore: v.optional(v.number()), reconcileToken: v.optional(v.string()),
    recoveryProtocol: v.optional(v.literal('computer-recovery-v1')),
    expectedProviderReference: v.optional(v.union(v.string(), v.null())),
    actorUserId: v.optional(v.string()),
    ownerType: v.optional(v.union(v.literal('agent'), v.literal('user'))), ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId || ['released', 'deleted'].includes(lease.status)) return null
    const computer = await ctx.db.query('computers')
      .withIndex('by_entityId', (q) => q.eq('id', lease.computerId!)).unique()
    if (!computer || args.leaseId !== `computer:${computer.id}` || computer.workspaceId !== args.workspaceId
      || (args.expectedProviderReference !== undefined
        && ((computer.providerRef ?? null) !== args.expectedProviderReference
          || (lease.providerReference ?? null) !== args.expectedProviderReference))) return null
    const allowed = args.kind === 'provision' ? ['reserved', 'provisioning', 'cleanup_failed']
      : args.kind === 'wake' ? ['paused', 'reserved', 'provisioning', 'running']
        : ['reserved', 'provisioning', 'running', 'paused', 'stopping', 'cleanup_failed']
    if (!allowed.includes(lease.status)) return null
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const current = lifecycle.maintenance as { token?: string; kind?: string; expiresAt?: number } | undefined
    if (args.recoveryProtocol && (args.kind !== 'stop' || args.force || !args.reconcileToken)) return null
    if (args.reconcileToken && current?.token !== args.token && (current?.token !== args.reconcileToken
      || (current.expiresAt ?? Number.MAX_SAFE_INTEGER) > args.now)) return null
    if (args.reconcileToken && args.kind === 'stop' && !args.force) {
      const activity = lifecycle.activityTokens as Record<string, { expiresAt?: number }> | undefined
      if (Object.values(activity ?? {}).some(value => (value.expiresAt ?? 0) > args.now)) return null
    }
    const activeIntent = Boolean(current?.token && current.token !== args.token
      && (current.expiresAt ?? Number.MAX_SAFE_INTEGER) > args.now)
    const mayPreempt = args.force === true && ['stop', 'delete'].includes(args.kind)
      && current?.kind !== 'delete'
    if (activeIntent && !mayPreempt) return null
    if (current?.token && current.token !== args.token && !activeIntent && current.token !== args.reconcileToken) return null
    if (current?.kind === 'delete' && args.kind !== 'delete') return null
    if (args.kind === 'idle') {
      const lastActiveAt = computer.lastActiveAt ?? computer.updatedAt ?? computer.createdAt
      if (lease.status !== 'running' || computer.status !== 'ready' || lastActiveAt > (args.idleBefore ?? 0)
        || !args.ownerType || !args.ownerId) return null
      const ownerId = args.ownerId
      const activity = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
        ? lifecycle.activityTokens as Record<string, { expiresAt?: number }>
        : {}
      if (Object.values(activity).some((value) => (value.expiresAt ?? 0) > args.now)) return null
      const runs = args.ownerType === 'agent'
        ? await ctx.db.query('conversationAgentRuns').withIndex('by_agentId_status', q => q.eq('agentId', ownerId).eq('status', 'running')).take(100)
        : await ctx.db.query('conversationAgentRuns').withIndex('by_userId_status', q => q.eq('userId', ownerId).eq('status', 'running')).take(100)
      if (runs.length >= 100) return null
      for (const run of runs) {
        if ((run.leaseExpiresAt ?? run.updatedAt + 2 * 60_000) <= args.now) continue
        const conversation = await ctx.db.get(run.conversationId)
        if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== args.workspaceId) continue
        if ((args.ownerType === 'agent' && run.agentId === args.ownerId)
          || (args.ownerType === 'user' && run.userId === args.ownerId && conversation.conversationType === 'personal')) return null
      }
    }
    const activity = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
      ? lifecycle.activityTokens as Record<string, { expiresAt?: number }>
      : {}
    const nextActivity = args.force ? {} : Object.fromEntries(Object.entries(activity)
      .filter(([, value]) => typeof value.expiresAt === 'number' && value.expiresAt > args.now))
    await ctx.db.patch(lease._id, {
      ...(['stop', 'idle', 'delete'].includes(args.kind) ? { status: 'stopping' } : {}),
      ...(['stop', 'idle', 'delete'].includes(args.kind) ? { nextMeterAt: args.now } : {}),
      usage: { ...usage, computerLifecycle: {
        ...lifecycle, maintenance: {
          kind: args.kind, token: args.token, expiresAt: args.expiresAt,
          ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        },
        activityTokens: nextActivity,
      } },
      updatedAt: args.now,
    })
    return { kind: args.kind, token: args.token, expiresAt: args.expiresAt }
  },
})

export const releaseComputerMaintenanceByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(), token: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return false
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const maintenance = lifecycle.maintenance as { token?: string } | undefined
    if (maintenance?.token !== args.token) return false
    await ctx.db.patch(lease._id, { usage: { ...usage, computerLifecycle: { ...lifecycle, maintenance: null } }, updatedAt: args.now })
    return true
  },
})

export const claimComputerActivityByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(), token: v.string(), userId: v.string(), now: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId || lease.status !== 'running'
      || ['released', 'deleted'].includes(lease.status) || args.expiresAt <= args.now
      || args.expiresAt - args.now > 10 * 60_000 + 60_000) return null
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const maintenance = lifecycle.maintenance as { token?: string; expiresAt?: number } | undefined
    if (maintenance?.token) return null
    const computer = await ctx.db.query('computers')
      .withIndex('by_entityId', q => q.eq('id', lease.computerId!)).unique()
    if (!computer || computer.workspaceId !== args.workspaceId || computer.status !== 'ready'
      || args.leaseId !== `computer:${computer.id}` || !lease.providerReference
      || computer.providerRef !== lease.providerReference) return null
    const tokens = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
      ? lifecycle.activityTokens as Record<string, { userId?: string; expiresAt?: number }>
      : {}
    const active = Object.fromEntries(Object.entries(tokens).filter(([, value]) =>
      typeof value.expiresAt === 'number' && value.expiresAt > args.now))
    if (Object.keys(active).length >= 64) return null
    active[args.token] = { userId: args.userId, expiresAt: args.expiresAt }
    await ctx.db.patch(lease._id, { usage: { ...usage, computerLifecycle: { ...lifecycle, activityTokens: active } }, updatedAt: args.now })
    return { token: args.token, expiresAt: args.expiresAt }
  },
})

export const releaseComputerActivityByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(), token: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return false
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const tokens = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
      ? lifecycle.activityTokens as Record<string, unknown>
      : {}
    if (!(args.token in tokens)) return false
    delete tokens[args.token]
    await ctx.db.patch(lease._id, { usage: { ...usage, computerLifecycle: { ...lifecycle, activityTokens: tokens } }, updatedAt: args.now })
    return true
  },
})

export const prepareComputerAllocationByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    allocationKey: v.string(), allocationRecipe: v.string(), maintenanceToken: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return null
    const lifecycle = computerLifecycleUsage((lease.usage ?? {}) as Record<string, unknown>)
    const maintenance = lifecycle.maintenance as { token?: string; kind?: string } | null | undefined
    if (maintenance?.token !== args.maintenanceToken || maintenance.kind !== 'provision'
      || !['reserved', 'provisioning', 'cleanup_failed'].includes(lease.status)) return null
    if (args.leaseId !== `computer:${lease.computerId}`
      || args.allocationKey !== `computer:${lease.computerId}`) {
      throw new Error('COMPUTER_ALLOCATION_KEY_MISMATCH')
    }
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    if ((typeof usage.allocationKey === 'string' && usage.allocationKey !== args.allocationKey)
      || (typeof usage.allocationRecipe === 'string' && usage.allocationRecipe !== args.allocationRecipe)) return null
    const requestedAt = typeof usage.requestedAt === 'number' ? usage.requestedAt : args.now
    await ctx.db.patch(lease._id, {
      status: 'provisioning', cleanupAfter: null, nextMeterAt: args.now + 60_000,
      meterClaimToken: null, meterClaimUntil: null,
      usage: {
        ...usage, allocationKey: args.allocationKey, allocationRecipe: args.allocationRecipe,
        requestedAt, allocationRetryable: false,
      },
      updatedAt: args.now,
    })
    return { requestedAt }
  },
})

export const computerHasActiveRunsByServer = query({
  args: {
    serverSecret: v.string(), workspaceId: v.string(),
    ownerType: v.union(v.literal('agent'), v.literal('user')), ownerId: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = args.ownerType === 'agent'
      ? await ctx.db.query('conversationAgentRuns')
        .withIndex('by_agentId_status', (q) => q.eq('agentId', args.ownerId).eq('status', 'running')).take(100)
      : await ctx.db.query('conversationAgentRuns')
        .withIndex('by_userId_status', (q) => q.eq('userId', args.ownerId).eq('status', 'running')).take(100)
    for (const row of rows) {
      if ((row.leaseExpiresAt ?? row.updatedAt + 2 * 60_000) <= args.now) continue
      const conversation = await ctx.db.get(row.conversationId)
      if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== args.workspaceId) continue
      if (args.ownerType === 'agent' && row.agentId === args.ownerId) return true
      if (args.ownerType === 'user' && row.userId === args.ownerId && conversation.conversationType === 'personal') return true
    }
    return false
  },
})

/** Whether a run on this environment is still going (so its machine must stay up). */

export const stopSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    reason: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId))
      .unique()
    if (!lease || lease.workspaceId !== args.workspaceId) return null
    if (['released', 'cleanup_failed'].includes(lease.status)) {
      return { ...clean(lease), id: lease.leaseId }
    }
    const usage = {
      ...((lease.usage ?? {}) as Record<string, unknown>),
      stopReason: args.reason,
    }
    await ctx.db.patch(lease._id, {
      status: 'stopping',
      reservedUntil: args.now,
      runtimeEndedAt: lease.runtimeEndedAt ?? args.now,
      cleanupAfter: args.now,
      nextMeterAt: args.now,
      usage,
      updatedAt: args.now,
    })
    if (lease.computerId) {
      return {
        ...clean(lease), status: 'stopping', reservedUntil: args.now,
        runtimeEndedAt: lease.runtimeEndedAt ?? args.now, cleanupAfter: args.now,
        nextMeterAt: args.now, usage, updatedAt: args.now, id: lease.leaseId,
      }
    }
    return {
      ...clean(lease), status: 'stopping', reservedUntil: args.now,
      runtimeEndedAt: lease.runtimeEndedAt ?? args.now, cleanupAfter: args.now,
      usage, updatedAt: args.now, id: lease.leaseId,
    }
  },
})

const sandboxLeasePayerValidator = v.object({
  scope: v.union(v.literal('personal'), v.literal('workspace')),
  billingAccountId: v.optional(v.string()),
  userId: v.string(),
  workspaceId: v.optional(v.string()),
  spendSubjectKind: v.optional(v.union(v.literal('member'), v.literal('programmatic'))),
  spendSubjectId: v.optional(v.string()),
})

/**
 * One meter tick: charges the machine's observed usage since the last tick (capped at what the workspace holds, so a
 * balance never goes negative) and advances the lease's cursor. Nothing is held or predicted. `budgetLow` says the
 * workspace now has under 2% of its budget left and `spendLimitReached` that an admin's spend limit for the member or
 * agent is used up: the caller stops the machine. A hold a lease kept from before holds were removed is released.
 */
export const meterSandboxLeaseDebitByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(), now: v.number(),
    expectedMeterVersion: v.number(),
    meteredUsage: anyObject,
    meteredProviderReference: v.optional(v.string()),
    meteredAt: v.number(),
    payer: v.optional(sandboxLeasePayerValidator),
    charge: v.optional(v.object({
      costCents: v.number(),
      durationSeconds: v.number(),
      modelId: v.string(),
      providerCostUsd: v.number(),
      metadata: anyObject,
    })),
    providerEvidence: v.optional(v.object({ usage: anyObject, stopped: v.boolean() })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db
      .query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId))
      .unique()
    if (!lease || lease.workspaceId !== args.workspaceId)
      return { applied: false, reason: 'lease_missing' }
    if (
      !['reserved', 'provisioning', 'running', 'paused', 'stopping', 'cleanup_failed'].includes(
        lease.status,
      )
    ) {
      return { applied: false, reason: 'lease_not_meterable' }
    }
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const meterVersion = typeof usage.meterVersion === 'number' ? usage.meterVersion : 0
    if (meterVersion !== args.expectedMeterVersion) return { applied: false, reason: 'lease_conflict' }
    const monetaryInputs = [args.charge?.costCents ?? 0, args.charge?.providerCostUsd ?? 0, args.charge?.durationSeconds ?? 0]
    if (!monetaryInputs.every((value) => Number.isFinite(value) && value >= 0)
      || !Number.isSafeInteger(Math.round((args.charge?.costCents ?? 0) * 10_000))) {
      throw new Error('sandbox_meter_amount_invalid')
    }
    const previousHoldMicros = typeof usage.runtimeHoldMicros === 'number' ? usage.runtimeHoldMicros : 0
    if (!Number.isSafeInteger(previousHoldMicros) || previousHoldMicros < 0) throw new Error('sandbox_runtime_hold_invalid')
    const evidence = args.providerEvidence ? {
      ...args.providerEvidence, providerReference: args.meteredProviderReference, observedAt: args.meteredAt,
    } : usage.lastProviderEvidence
    if (args.providerEvidence) {
      await ctx.db.patch(lease._id, { usage: { ...usage, lastProviderEvidence: evidence }, updatedAt: args.now })
    }
    const nextUsage: Record<string, unknown> = {
      ...usage,
      ...(evidence ? { lastProviderEvidence: evidence } : {}),
      meteredUsage: args.meteredUsage,
      meteredAt: args.meteredAt,
      meterVersion: meterVersion + 1,
      ...(args.meteredProviderReference === undefined ? {} : { meteredProviderReference: args.meteredProviderReference }),
      ...(args.payer === undefined ? {} : { lastPayer: args.payer }),
    }
    let remainingCents: number | undefined
    let budgetLow = false
    let spendLimitReached = false
    const charge = args.charge && args.charge.costCents > 0 ? args.charge : undefined
    // A legacy hold stays bound to the payer that made it until this tick releases it.
    const payer = previousHoldMicros > 0 ? usage.runtimeHoldPayer as typeof args.payer : args.payer
    if (!payer && (charge || previousHoldMicros > 0)) {
      return { applied: false, reason: 'insufficient_budget', remainingCents: 0 }
    }
    if (payer) {
      if (payer.scope === 'workspace') {
        if (payer.workspaceId !== lease.workspaceId || payer.workspaceId !== args.workspaceId) {
          throw new Error('workspace_billing_account_mismatch')
        }
        const billingAccountId = payer.billingAccountId?.trim()
        if (!billingAccountId)
          throw new Error('workspace_billing_account_missing')
        const account = await ctx.db
          .query('billingAccounts')
          .withIndex('by_billingAccountId', (q) =>
            q.eq('billingAccountId', billingAccountId),
          )
          .unique()
        if (
          !account ||
          account.scope !== 'workspace' ||
          account.workspaceId !== payer.workspaceId
        ) {
          throw new Error('workspace_billing_account_mismatch')
        }
        const subscription = await ctx.db
          .query('billingAccountSubscriptions')
          .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
          .unique()
        // Without a paid plan, only settle confirmed-stopped usage; never keep live runtime going.
        const settlesWithoutRuntime = args.providerEvidence ? args.providerEvidence.stopped : !charge
        if (subscription?.planKind !== 'paid' && !settlesWithoutRuntime) {
          return { applied: false, reason: 'paid_plan_required' }
        }
        const balance = await ctx.db
          .query('billingAccountBalances')
          .withIndex('by_billingAccountId', (q) =>
            q.eq('billingAccountId', billingAccountId),
          )
          .unique()
        if (!balance) throw new Error('workspace_billing_balance_missing')
        if (previousHoldMicros > balance.reservedMicros) throw new Error('sandbox_runtime_hold_balance_mismatch')
        // Observed usage is always recorded, capped at what the workspace holds.
        const chargeMicros = charge
          ? Math.min(Math.round(Math.max(0, charge.costCents) * 10_000), workspaceAvailableMicros(balance))
          : 0
        if (charge || previousHoldMicros > 0) {
          const limits = await chargeSandboxSpendLimits(ctx, {
            billingAccountId, userId: payer.userId, spendSubjectKind: payer.spendSubjectKind, spendSubjectId: payer.spendSubjectId,
            usage, previousHoldMicros, chargeMicros, now: args.now,
          })
          spendLimitReached = limits.limitReached
          await finalizeWorkspaceLedger(ctx, {
            actualMicros: chargeMicros, balance, limit: null, reservedMicros: previousHoldMicros,
          })
          if (previousHoldMicros > 0) {
            nextUsage.runtimeHoldMicros = 0
            nextUsage.runtimeHoldPayer = null
            nextUsage.runtimeHoldLimits = []
            nextUsage.runtimeHoldLimitId = null
          }
          if (charge) await insertUsageOperation(ctx, {
            userId: payer.userId,
            billingAccountId,
            operationId: `sandbox-meter:${args.leaseId}:${meterVersion + 1}`,
            recorded: 1,
            ...meterUsageFields({ ...charge, costCents: chargeMicros / 10_000 }),
            sandboxEvidence: {
              category: 'compute', provider: lease.provider,
              providerReference: args.meteredProviderReference ?? lease.providerReference ?? '',
              providerCostUsd: charge.providerCostUsd, pricingVersion: account.pricingVersion,
              metadataJson: JSON.stringify(charge.metadata),
            },
            createdAt: args.now,
          })
        }
        budgetLow = account.status !== 'active' || await workspaceBudgetLowAfterCharge(ctx, balance._id)
        const after = await ctx.db.get(balance._id)
        remainingCents = after ? workspaceRemainingCents(after) : 0
      } else {
        // Not a paid workspace: a person's own account has no credit, so metered machine time cannot be paid for.
        if (charge || previousHoldMicros > 0) {
          return { applied: false, reason: 'insufficient_budget', remainingCents: 0 }
        }
        remainingCents = 0
      }
    }
    await ctx.db.patch(lease._id, { usage: nextUsage, updatedAt: args.now })
    return {
      applied: true, meterVersion: meterVersion + 1, budgetLow, spendLimitReached,
      ...(remainingCents === undefined ? {} : { remainingCents }),
    }
  },
})


/** Revokes a connected machine: its credentials stop working and any machine lease it held is stopped. */
export const revokeEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments')
      .withIndex('by_environmentId', (q) => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return false
    if (environment.status === 'revoked') return true
    await ctx.db.patch(environment._id, { status: 'revoked', revokedAt: args.now, updatedAt: args.now })
    const [credentials, envLeases] = await Promise.all([
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_environmentId_expiresAt', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId).eq('environmentId', args.environmentId)).take(1_000),
    ])
    await Promise.all([
      ...credentials.filter((credential) => !credential.revokedAt)
        .map((credential) => ctx.db.patch(credential._id, { revokedAt: args.now })),
      ...envLeases.filter((lease) => !['released', 'cleanup_failed'].includes(lease.status))
        .map((lease) => ctx.db.patch(lease._id, { status: 'stopping', reservedUntil: args.now, cleanupAfter: args.now, updatedAt: args.now })),
    ])
    return true
  },
})

function meterUsageFields(charge: { costCents: number; modelId?: string; durationSeconds?: number }) {
  return {
    cents: Math.max(0, charge.costCents),
    kind: 'sandbox' as const,
    ...(charge.modelId ? { modelId: charge.modelId } : {}),
    ...(charge.durationSeconds ? { usageSeconds: charge.durationSeconds } : {}),
  }
}
