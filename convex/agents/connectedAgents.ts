import { v } from 'convex/values'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { projectRemoteAgentEvents, resolveRemoteRequestPart, waitingRemoteAgentParts } from '../../src/shared/agents/remote-agent-transcript'
import { assertValidElicitationResponse } from '../../src/shared/agents/elicitation-schema'
import { markBudgetReservationReconcile } from '../platform/usage'

const anyObject = v.any()
const MAX_COMMAND_BYTES = 128 * 1024
const MAX_COMMANDS_PER_POLL = 50
const MAX_EVENTS_PER_BATCH = 100
const MAX_EVENT_BATCH_BYTES = 512 * 1024
const REMOTE_RUN_LEASE_MS = 30 * 60_000

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
function sameJson(left: unknown, right: unknown) { return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right)) }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortJson(item)]))
}
function clean<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}
function conversationParts(parts: Array<Record<string, unknown>>) {
  return parts.map(part => {
    if (part.type !== 'data-remote-agent-status' || !part.data || typeof part.data !== 'object') return part
    const data = part.data as Record<string, unknown>
    return { type: 'data-remote-agent-status', data: {
      environmentName: typeof data.environmentName === 'string' ? data.environmentName : 'connected environment',
      queueExpiresAt: typeof data.queueExpiresAt === 'number' ? data.queueExpiresAt : 0,
      runId: typeof data.runId === 'string' ? data.runId : 'remote-agent',
      state: ['waiting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recoverable', 'completed', 'failed', 'cancelled'].includes(String(data.state))
        ? data.state : 'running',
      ...(typeof data.retryable === 'boolean' ? { retryable: data.retryable } : {}),
      ...(['transient', 'timeout', 'host_offline', 'permission', 'fatal'].includes(String(data.retryClass))
        ? { retryClass: data.retryClass } : {}),
    } }
  }) as unknown as NonNullable<Doc<'conversationMessages'>['parts']>
}

export const createEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), kind: v.string(), name: v.string(), status: v.string(), publicKey: v.optional(v.string()), hostVersion: v.optional(v.string()), platform: v.optional(v.string()), capabilities: anyObject, lastSeenAt: v.optional(v.number()), revokedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.id)).unique()
    if (existing) throw new Error('AGENT_ENVIRONMENT_EXISTS')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, environmentId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentEnvironments', row)
    return { ...row, id }
  },
})

export const createBindingByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), agentId: v.string(), environmentId: v.string(), protocolAdapter: v.string(), adapterConfig: anyObject, enabled: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'pending' || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, bindingId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentBindings', row)
    return { ...row, id }
  },
})

export const upsertBindingByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), agentId: v.string(), environmentId: v.string(), protocolAdapter: v.string(), adapterConfig: anyObject, enabled: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || !environment.approvedAt || environment.status === 'pending' || environment.status === 'revoked') {
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    }
    const agentPrincipal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId)).unique()
    if (!agentPrincipal || agentPrincipal.type !== 'agent' || agentPrincipal.archivedAt) {
      throw new Error('AGENT_PRINCIPAL_UNAVAILABLE')
    }
    const existing = (await ctx.db.query('agentBindings')
      .withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .take(200)).sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (existing) {
      await ctx.db.patch(existing._id, {
        environmentId: args.environmentId, protocolAdapter: args.protocolAdapter,
        adapterConfig: args.adapterConfig, enabled: args.enabled, updatedAt: args.now,
      })
      return { ...clean(existing), environmentId: args.environmentId, protocolAdapter: args.protocolAdapter,
        adapterConfig: args.adapterConfig, enabled: args.enabled, updatedAt: args.now, id: existing.bindingId }
    }
    const row = { bindingId: args.id, workspaceId: args.workspaceId, agentId: args.agentId,
      environmentId: args.environmentId, protocolAdapter: args.protocolAdapter,
      adapterConfig: args.adapterConfig, enabled: args.enabled, createdAt: args.now, updatedAt: args.now }
    await ctx.db.insert('agentBindings', row)
    return { ...row, id: row.bindingId }
  },
})

export const listBindingsByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = args.agentId
      ? await ctx.db.query('agentBindings').withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId!)).take(200)
      : await ctx.db.query('agentBindings').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).take(200)
    return rows.sort((left, right) => right.updatedAt - left.updatedAt)
      .map(row => ({ ...clean(row), id: row.bindingId }))
  },
})

export const getWorkspacePolicyUsageByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.object({ activeArtifactBytes: v.number(), activeRuns: v.number(), environments: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environmentStatuses = ['pending', 'offline', 'online'] as const
    const runStatuses = ['starting', 'running', 'waiting_for_approval', 'recovering'] as const
    const [environmentGroups, runGroups, artifactUsage] = await Promise.all([
      Promise.all(environmentStatuses.map(status => ctx.db.query('agentEnvironments')
        .withIndex('by_workspaceId_status', q => q.eq('workspaceId', args.workspaceId).eq('status', status)).take(101))),
      Promise.all(runStatuses.map(status => ctx.db.query('agentRemoteSessions')
        .withIndex('by_workspaceId_status', q => q.eq('workspaceId', args.workspaceId).eq('status', status)).take(101))),
      ctx.db.query('agentWorkspacePolicyUsage')
        .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique(),
    ])
    return {
      activeArtifactBytes: artifactUsage?.activeArtifactBytes ?? 0,
      activeRuns: runGroups.flat().length,
      environments: environmentGroups.flat().length,
    }
  },
})

export const disableBindingsForAgentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('agentBindings')
      .withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .take(200)
    let changed = false
    for (const row of rows) if (row.enabled) {
      await ctx.db.patch(row._id, { enabled: false, updatedAt: args.now })
      changed = true
    }
    return changed
  },
})

export const findInvocationTargetByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), now: v.number(), onlineWithinMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const bindings = (await ctx.db.query('agentBindings')
      .withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .take(200)).filter(binding => binding.enabled).sort((left, right) => right.updatedAt - left.updatedAt)
    for (const binding of bindings) {
      const environment = await ctx.db.query('agentEnvironments')
        .withIndex('by_environmentId', q => q.eq('environmentId', binding.environmentId)).unique()
      if (!environment || environment.workspaceId !== args.workspaceId || !environment.approvedAt || environment.revokedAt || environment.status === 'revoked') continue
      const online = environment.status === 'online' && (environment.lastSeenAt ?? 0) >= args.now - args.onlineWithinMs
      return {
        binding: { ...clean(binding), id: binding.bindingId },
        environment: { ...clean(environment), status: online ? 'online' : 'offline', id: environment.environmentId },
      }
    }
    return null
  },
})

export const startRemoteAgentTurnByServer = mutation({
  args: {
    serverSecret: v.string(), actorUserId: v.string(), agentId: v.string(), authorPrincipalId: v.string(),
    bindingId: v.string(), clientNonce: v.string(), commandId: v.string(), conversationId: v.id('conversations'),
    environmentId: v.string(), environmentName: v.string(), environmentOnline: v.boolean(),
    initiatorPrincipalId: v.string(), modelId: v.string(), modelUsageBilling: v.union(v.literal('byok'), v.literal('overlay')),
    maxConcurrentRuns: v.number(), maxRunTimeMs: v.number(), prompt: v.string(), queueExpiresAt: v.number(),
    reservationId: v.union(v.string(), v.null()), runId: v.string(), sessionId: v.string(),
    sandboxBilling: v.optional(anyObject),
    startPayload: anyObject, threadRootMessageId: v.optional(v.id('conversationMessages')),
    turnId: v.string(), userMessageId: v.id('conversationMessages'), workspaceId: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (jsonByteLength(args.startPayload) > MAX_COMMAND_BYTES) throw new Error('AGENT_COMMAND_TOO_LARGE')
    const actor = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)).unique()
    if (!actor || actor.type !== 'human' || actor.archivedAt || actor.principalId !== args.initiatorPrincipalId) {
      throw new Error('CONVERSATION_ACCESS_DENIED')
    }
    const [membership, actorParticipant, agent, agentParticipant, conversation, userMessage, binding, environment] = await Promise.all([
      ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)).unique(),
      ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', args.conversationId).eq('principalId', actor.principalId)).unique(),
      ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', args.authorPrincipalId)).unique(),
      ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', args.conversationId).eq('principalId', args.authorPrincipalId)).unique(),
      ctx.db.get(args.conversationId), ctx.db.get(args.userMessageId),
      ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', args.bindingId)).unique(),
      ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique(),
    ])
    if (!membership || membership.status !== 'active' || !actorParticipant || actorParticipant.status !== 'active' ||
      !conversation || conversation.deletedAt || conversation.workspaceId !== args.workspaceId ||
      !userMessage || userMessage.conversationId !== args.conversationId || userMessage.role !== 'user' ||
      userMessage.userId !== args.actorUserId ||
      !agent || agent.type !== 'agent' || agent.archivedAt || agent.workspaceId !== args.workspaceId ||
      agent.agentId !== args.agentId || !agentParticipant || agentParticipant.status !== 'active') {
      throw new Error('CONVERSATION_ACCESS_DENIED')
    }
    if (!binding || binding.workspaceId !== args.workspaceId || binding.agentId !== args.agentId ||
      binding.environmentId !== args.environmentId || !binding.enabled || !environment ||
      environment.workspaceId !== args.workspaceId || !environment.approvedAt || environment.revokedAt ||
      environment.status === 'pending' || environment.status === 'revoked') {
      throw new Error('AGENT_BINDING_UNAVAILABLE')
    }
    const existingMessage = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_clientNonce', q => q.eq('conversationId', args.conversationId).eq('clientNonce', args.clientNonce)).first()
    if (existingMessage) {
      const existingRun = await ctx.db.query('conversationAgentRuns')
        .withIndex('by_assistantMessageId', q => q.eq('assistantMessageId', existingMessage._id)).unique()
      if (!existingRun || existingRun.runner !== 'remote' || existingRun.agentId !== args.agentId || !existingRun.externalRunId) {
        throw new Error('AGENT_REMOTE_TURN_IDEMPOTENCY_CONFLICT')
      }
      const existingCommand = await ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId))
        .filter(q => q.eq(q.field('runId'), existingRun.externalRunId)).first()
      if (!existingCommand) throw new Error('AGENT_REMOTE_TURN_INCOMPLETE')
      const currentOnline = environment.status === 'online' && (environment.lastSeenAt ?? 0) >= args.now - 45_000
      return { commandId: existingCommand.commandId, environmentName: environment.name,
        messageId: existingMessage._id, resumed: true, runId: existingRun.externalRunId, waiting: !currentOnline }
    }
    if (args.threadRootMessageId) {
      const threadRoot = await ctx.db.get(args.threadRootMessageId)
      if (!threadRoot || threadRoot.conversationId !== args.conversationId || threadRoot.deletedAt) {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
    }
    const [runCollision, sessionCollision, commandCollision] = await Promise.all([
      ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).first(),
      ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.sessionId)).first(),
      ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', args.commandId)).first(),
    ])
    if (runCollision || sessionCollision || commandCollision) throw new Error('AGENT_REMOTE_TURN_EXISTS')
    const activeStatuses = ['starting', 'running', 'waiting_for_approval', 'recovering'] as const
    const activeRuns = (await Promise.all(activeStatuses.map(status => ctx.db.query('agentRemoteSessions')
      .withIndex('by_workspaceId_status', q => q.eq('workspaceId', args.workspaceId).eq('status', status))
      .take(args.maxConcurrentRuns + 1)))).flat()
    if (activeRuns.length >= args.maxConcurrentRuns) throw new Error('CONNECTED_AGENT_POLICY_LIMIT:concurrent_runs')
    if (environment.kind === 'overlay_cloud') {
      const activeManagedRuns = (await Promise.all(activeStatuses.map(status => ctx.db.query('agentRemoteSessions')
        .withIndex('by_environmentId_status', q => q.eq('environmentId', args.environmentId).eq('status', status)).first())))
        .filter(Boolean)
      if (activeManagedRuns.length > 0) throw new Error('CONNECTED_AGENT_POLICY_LIMIT:managed_environment_concurrency')
    }
    const online = environment.status === 'online' && (environment.lastSeenAt ?? 0) >= args.now - 45_000
    const waitingParts = waitingRemoteAgentParts({ environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId, userId: args.actorUserId, authorKind: 'agent',
      authorPrincipalId: args.authorPrincipalId, turnId: args.turnId, role: 'assistant', mode: 'act',
      content: online ? '' : `Waiting for ${environment.name}`, contentType: 'text', modelId: args.modelId,
      parts: online ? [] : conversationParts(waitingParts), status: 'generating', clientNonce: args.clientNonce,
      threadRootMessageId: args.threadRootMessageId, createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.insert('conversationAgentRuns', {
      externalRunId: args.runId, conversationId: args.conversationId, turnId: args.turnId,
      userId: args.actorUserId, userMessageId: args.userMessageId, assistantMessageId: messageId,
      agentId: args.agentId, agentPrincipalId: args.authorPrincipalId,
      initiatorPrincipalId: args.initiatorPrincipalId, environmentId: args.environmentId,
      bindingId: args.bindingId, mode: 'room', runner: 'remote', status: 'queued',
      leaseExpiresAt: Math.min(args.now + args.maxRunTimeMs, online ? args.now + REMOTE_RUN_LEASE_MS : args.queueExpiresAt),
      createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.insert('agentRemoteSessions', {
      sessionId: args.sessionId, workspaceId: args.workspaceId, environmentId: args.environmentId,
      bindingId: args.bindingId, runId: args.runId, status: 'starting', commandCursor: 0, eventCursor: 0,
      capabilitySnapshot: { ...environment.capabilities, billing: { reservationId: args.reservationId,
        agentId: args.agentId, environmentId: args.environmentId, modelId: args.modelId,
        modelUsageBilling: args.modelUsageBilling, runId: args.runId, userId: args.actorUserId,
        workspaceId: args.workspaceId, operationId: `workspace-agent:${args.turnId}` },
        hardExpiresAt: args.now + args.maxRunTimeMs,
        ...(args.sandboxBilling ? { sandboxBilling: args.sandboxBilling } : {}),
        queueExpiresAt: args.queueExpiresAt, environmentName: environment.name,
        startPayload: args.startPayload },
      createdAt: args.now, updatedAt: args.now,
    })
    if (args.sandboxBilling && typeof args.sandboxBilling.reservationId === 'string') {
      if (typeof args.sandboxBilling.leaseId !== 'string' || !args.sandboxBilling.leaseId) {
        throw new Error('MANAGED_SANDBOX_BILLING_INVALID')
      }
      await ctx.db.insert('agentSandboxSettlements', {
        reservationId: args.sandboxBilling.reservationId,
        workspaceId: args.workspaceId,
        environmentId: args.environmentId,
        runId: args.runId,
        leaseId: args.sandboxBilling.leaseId,
        status: 'pending',
        createdAt: args.now,
        updatedAt: args.now,
      })
    }
    const latest = await ctx.db.query('agentRunCommands')
      .withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).order('desc').first()
    await ctx.db.insert('agentRunCommands', {
      commandId: args.commandId, workspaceId: args.workspaceId, environmentId: args.environmentId,
      runId: args.runId, type: 'start', sequence: (latest?.sequence ?? 0) + 1,
      payload: args.startPayload, status: 'pending', createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.patch(args.conversationId, { lastMode: 'act', lastModified: args.now, updatedAt: args.now })
    await ctx.db.insert('conversationEvents', { conversationId: args.conversationId, workspaceId: args.workspaceId,
      messageId, type: 'message.created', userId: args.actorUserId, createdAt: args.now })
    return { commandId: args.commandId, environmentName: environment.name, messageId,
      resumed: false, runId: args.runId, waiting: !online }
  },
})

export const controlRemoteAgentTurnByServer = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), conversationId: v.string(), workspaceId: v.string(), runId: v.string(), action: v.union(v.literal('cancel'), v.literal('retry'), v.literal('resume'), v.literal('start_fresh')), queueExpiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run || run.conversationId !== args.conversationId || run.runner !== 'remote') return { applied: false }
    const actor = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)).unique()
    const membership = actor ? await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)).unique() : null
    const participant = actor ? await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run.conversationId).eq('principalId', actor.principalId)).unique() : null
    if (!actor || actor.type !== 'human' || actor.archivedAt || membership?.status !== 'active' || participant?.status !== 'active') return { applied: false }
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    if (!session || session.workspaceId !== args.workspaceId) return { applied: false }
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', session.environmentId)).unique()
    if (!environment) return { applied: false }
    const commands = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).filter(q => q.eq(q.field('runId'), args.runId)).take(100)
    if (args.action === 'cancel') {
      if (run.status === 'cancelled') return { applied: true, messageId: run.assistantMessageId }
      if (run.status === 'completed') return { applied: false }
      let cancelCommand = commands.find(command => command.type === 'cancel'
        && (command.status === 'pending' || command.status === 'claimed'))
      if (!cancelCommand) {
        const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
        const commandId = `command_${crypto.randomUUID()}`
        await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId,
          environmentId: session.environmentId, runId: args.runId, type: 'cancel',
          sequence: (latest?.sequence ?? 0) + 1, payload: { reason: 'Cancelled from Overlay' },
          status: 'pending', createdAt: args.now, updatedAt: args.now })
        cancelCommand = { commandId } as typeof commands[number]
      }
      await ctx.db.patch(run._id, { status: 'cancelled', cancelledAt: args.now, updatedAt: args.now })
      await ctx.db.patch(session._id, { status: 'cancelled', endedAt: args.now, updatedAt: args.now })
      for (const command of commands) if (command.type !== 'cancel' && (command.status === 'pending' || command.status === 'claimed')) {
        await ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: undefined, updatedAt: args.now })
      }
      const pendingRequests = await ctx.db.query('agentApprovalRequests')
        .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', args.workspaceId).eq('runId', args.runId)).take(100)
      for (const request of pendingRequests) if (!request.resolution) {
        await ctx.db.patch(request._id, { resolution: {
          decision: 'cancelled', resolvedByPrincipalId: actor.principalId, resolvedAt: args.now,
        } })
      }
      await ctx.db.patch(run.assistantMessageId, { content: 'Cancelled',
        parts: [{ type: 'text', text: 'Cancelled' }, { type: 'data-remote-agent-status', data: {
          environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId, state: 'cancelled' } }],
        status: 'completed', updatedAt: args.now })
      await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
        messageId: run.assistantMessageId, type: 'message.completed', userId: run.userId, createdAt: args.now })
      return { applied: true, commandId: cancelCommand.commandId, messageId: run.assistantMessageId,
        terminal: terminalBilling(session.capabilitySnapshot, { input: 0, output: 0 }, 'cancelled') }
    }
    if (args.action === 'retry' && run.status === 'queued') {
      await ctx.db.patch(run._id, { leaseExpiresAt: args.queueExpiresAt, updatedAt: args.now })
      for (const command of commands) if (command.status !== 'acknowledged') {
        await ctx.db.patch(command._id, { status: 'pending', claimedAt: undefined, claimExpiresAt: undefined, updatedAt: args.now })
      }
      await ctx.db.patch(session._id, { capabilitySnapshot: { ...session.capabilitySnapshot, queueExpiresAt: args.queueExpiresAt }, updatedAt: args.now })
      await ctx.db.patch(run.assistantMessageId, { content: `Waiting for ${environment.name}`,
        parts: conversationParts(waitingRemoteAgentParts({ environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId })),
        status: 'generating', updatedAt: args.now })
      await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
        messageId: run.assistantMessageId, type: 'message.delta', userId: run.userId, createdAt: args.now })
      return { applied: true, messageId: run.assistantMessageId }
    }
    if (!['failed', 'cancelled'].includes(run.status)) return { applied: false }
    const snapshot = session.capabilitySnapshot && typeof session.capabilitySnapshot === 'object'
      ? session.capabilitySnapshot as Record<string, unknown> : {}
    const startPayload = snapshot.startPayload && typeof snapshot.startPayload === 'object'
      ? snapshot.startPayload as Record<string, unknown> : null
    const mode = args.action === 'start_fresh' ? 'start_fresh' : args.action === 'resume' ? 'resume'
      : session.remoteSessionId ? 'resume' : 'start_fresh'
    if ((mode === 'resume' && !session.remoteSessionId) || (mode === 'start_fresh' && !startPayload)) return { applied: false }
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
    const commandId = `command_${crypto.randomUUID()}`
    await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId,
      environmentId: session.environmentId, runId: args.runId, type: mode === 'resume' ? 'reconnect' : 'start',
      sequence: (latest?.sequence ?? 0) + 1,
      payload: mode === 'resume' ? { remoteSessionId: session.remoteSessionId } : { ...startPayload, sessionId: undefined, fresh: true },
      status: 'pending', createdAt: args.now, updatedAt: args.now })
    await ctx.db.patch(run._id, { status: 'queued', leaseExpiresAt: args.queueExpiresAt,
      failedAt: undefined, cancelledAt: undefined, terminalError: undefined,
      metrics: { ...(run.metrics ?? {}), workflowRetryCount: (run.metrics?.workflowRetryCount ?? 0) + 1 }, updatedAt: args.now })
    await ctx.db.patch(session._id, { status: 'recovering', endedAt: undefined,
      capabilitySnapshot: { ...snapshot, queueExpiresAt: args.queueExpiresAt }, updatedAt: args.now })
    await ctx.db.patch(run.assistantMessageId, { status: 'generating', updatedAt: args.now })
    await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
      messageId: run.assistantMessageId, type: 'message.delta', userId: run.userId, createdAt: args.now })
    return { applied: true, commandId, messageId: run.assistantMessageId }
  },
})

export const createRemoteSessionByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(), bindingId: v.string(), runId: v.string(), remoteSessionId: v.optional(v.string()), status: v.string(), commandCursor: v.number(), eventCursor: v.number(), capabilitySnapshot: anyObject, startedAt: v.optional(v.number()), endedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'pending' || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', args.bindingId)).unique()
    if (!binding || binding.workspaceId !== args.workspaceId || binding.environmentId !== args.environmentId || !binding.enabled) throw new Error('AGENT_BINDING_UNAVAILABLE')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, sessionId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRemoteSessions', row)
    return { ...row, id }
  },
})

export const enqueueCommandByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string(), type: v.string(), payload: anyObject, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'pending' || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    if (!args.type || args.type.length > 64 || jsonByteLength(args.payload) > MAX_COMMAND_BYTES) {
      throw new Error('AGENT_COMMAND_TOO_LARGE')
    }
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).order('desc').first()
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, commandId: id, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRunCommands', row)
    return { ...row, id }
  },
})

export const acknowledgeCommandByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), commandId: v.string(), accepted: v.optional(v.boolean()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', args.commandId)).unique()
    if (!command || command.workspaceId !== args.workspaceId || command.environmentId !== args.environmentId || command.status === 'cancelled') return false
    if (args.accepted === false) {
      if (command.status === 'acknowledged') return false
      await ctx.db.patch(command._id, {
        status: 'cancelled', claimExpiresAt: undefined, updatedAt: args.now,
      })
      return true
    }
    if (command.status !== 'acknowledged') {
      await ctx.db.patch(command._id, {
        status: 'acknowledged', acknowledgedAt: args.now, claimExpiresAt: undefined, updatedAt: args.now,
      })
    }
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', command.runId)).unique()
    if (session && session.workspaceId === args.workspaceId && session.environmentId === args.environmentId) {
      await ctx.db.patch(session._id, { commandCursor: Math.max(session.commandCursor, command.sequence), updatedAt: args.now })
    }
    return true
  },
})

export const getRemoteSessionForRunByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.environmentId !== args.environmentId) return null
    return { ...clean(session), id: session.sessionId }
  },
})

export const createApprovalRequestByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), runId: v.string(),
    remoteSessionId: v.string(), requestKey: v.string(), kind: v.union(v.literal('permission'), v.literal('elicitation')), prompt: v.string(),
    options: v.array(v.string()), payload: anyObject, requestedAt: v.number(),
    resolution: v.optional(v.object({
      decision: v.string(), resolvedByPrincipalId: v.string(), resolvedAt: v.number(),
      response: v.optional(v.any()),
    })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.remoteSessionId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.runId !== args.runId) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const existing = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', args.remoteSessionId).eq('requestKey', args.requestKey)).unique()
    if (existing) return { ...clean(existing), id: existing.approvalId }
    const { serverSecret, id, ...value } = args
    void serverSecret
    const row = { ...value, approvalId: id }
    await ctx.db.insert('agentApprovalRequests', row)
    return { ...row, id }
  },
})

export const resolveApprovalRequestByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), approvalId: v.string(),
    resolution: v.object({ decision: v.string(), response: v.optional(v.any()), resolvedByPrincipalId: v.string(), resolvedAt: v.number() }),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db.query('agentApprovalRequests').withIndex('by_approvalId', q => q.eq('approvalId', args.approvalId)).unique()
    if (!current || current.workspaceId !== args.workspaceId) return null
    if (current.resolution) {
      if (!sameResolution(current.resolution, args.resolution)) throw new Error('AGENT_APPROVAL_ALREADY_RESOLVED')
      return { ...clean(current), id: current.approvalId }
    }
    await ctx.db.patch(current._id, { resolution: args.resolution })
    return { ...clean(current), resolution: args.resolution, id: current.approvalId }
  },
})

export const resolveRemoteRequestByServer = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), conversationId: v.string(),
    runId: v.string(), requestKey: v.string(), decision: v.string(), response: v.optional(anyObject), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run || run.conversationId !== args.conversationId || !['waiting_for_approval', 'running'].includes(run.status)) return { applied: false }
    const actor = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)).unique()
    const membership = actor ? await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)).unique() : null
    const participant = actor ? await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run.conversationId).eq('principalId', actor.principalId)).unique() : null
    if (!actor || actor.type !== 'human' || actor.archivedAt || membership?.status !== 'active' || participant?.status !== 'active') return { applied: false }
    const requests = await ctx.db.query('agentApprovalRequests').withIndex('by_workspaceId_runId', q => q.eq('workspaceId', args.workspaceId).eq('runId', args.runId)).take(100)
    const request = requests.find(row => row.requestKey === args.requestKey)
    if (!request) return { applied: false }
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', request.remoteSessionId)).unique()
    const message = await ctx.db.get(run.assistantMessageId)
    if (!session || !message || session.runId !== args.runId) return { applied: false }
    if (request.resolution) {
      if (request.resolution.decision !== args.decision
        || !sameJson(request.resolution.response ?? null, args.response ?? null)) {
        throw new Error('AGENT_REMOTE_REQUEST_ALREADY_RESOLVED')
      }
      const commands = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).filter(q => q.eq(q.field('runId'), args.runId)).take(100)
      const existing = commands.find(command => (command.payload as Record<string, unknown>).requestKey === args.requestKey)
      return { applied: true, commandId: existing?.commandId, messageId: run.assistantMessageId }
    }
    const kind = request.kind === 'elicitation' ? 'elicitation' : 'permission'
    if (kind === 'permission' && !request.options.includes(args.decision)) throw new Error('AGENT_APPROVAL_OPTION_INVALID')
    if (kind === 'elicitation' && !['accept', 'decline', 'cancel'].includes(args.decision)) throw new Error('AGENT_ELICITATION_ACTION_INVALID')
    if (kind === 'elicitation' && args.decision === 'accept') assertValidElicitationResponse(request.payload, args.response)
    const resolution = { decision: args.decision, ...(args.response ? { response: args.response } : {}),
      resolvedByPrincipalId: actor.principalId, resolvedAt: args.now }
    await ctx.db.patch(request._id, { resolution })
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
    const commandId = `command_${crypto.randomUUID()}`
    await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId,
      environmentId: session.environmentId, runId: args.runId,
      type: kind === 'permission' ? 'approval_response' : 'elicitation_response',
      sequence: (latest?.sequence ?? 0) + 1,
      payload: kind === 'permission' ? { requestKey: args.requestKey, optionId: args.decision }
        : { requestKey: args.requestKey, action: args.decision, ...(args.response ? { content: args.response } : {}) },
      status: 'pending', createdAt: args.now, updatedAt: args.now })
    await ctx.db.patch(run._id, { status: 'running', approval: undefined, updatedAt: args.now })
    await ctx.db.patch(session._id, { status: 'running', updatedAt: args.now })
    await ctx.db.patch(message._id, { parts: conversationParts(resolveRemoteRequestPart(
      Array.isArray(message.parts) ? message.parts as unknown as Array<Record<string, unknown>> : [],
      args.requestKey, resolution,
    )), status: 'generating', updatedAt: args.now })
    await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
      messageId: message._id, type: 'message.delta', userId: run.userId, createdAt: args.now })
    return { applied: true, commandId, messageId: message._id }
  },
})

export const createArtifactByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(),
    runId: v.string(), remoteSessionId: v.string(), name: v.string(), mediaType: v.string(), size: v.number(),
    sha256: v.string(), objectKey: v.string(), status: v.string(), scanResult: v.optional(v.string()),
    expiresAt: v.number(), linkedAt: v.optional(v.number()), deletedAt: v.optional(v.number()),
    createdAt: v.number(), updatedAt: v.number(), maxWorkspaceArtifactBytes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.remoteSessionId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.environmentId !== args.environmentId || session.runId !== args.runId) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const usage = await artifactPolicyUsage(ctx, args.workspaceId, args.updatedAt)
    if (args.maxWorkspaceArtifactBytes !== undefined &&
      usage.activeArtifactBytes + args.size > args.maxWorkspaceArtifactBytes) {
      throw new Error('CONNECTED_AGENT_POLICY_LIMIT:artifact_bytes')
    }
    const { serverSecret, id, maxWorkspaceArtifactBytes: _maxWorkspaceArtifactBytes, ...value } = args
    void serverSecret
    void _maxWorkspaceArtifactBytes
    await ctx.db.insert('agentArtifacts', { ...value, artifactId: id })
    await ctx.db.patch(usage._id, { activeArtifactBytes: usage.activeArtifactBytes + args.size, updatedAt: args.updatedAt })
    return { ...value, id }
  },
})

export const getArtifactByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', args.artifactId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.environmentId !== args.environmentId) return null
    return { ...clean(row), id: row.artifactId }
  },
})

export const getArtifactForDownloadByServer = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', args.artifactId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || !['clean', 'linked'].includes(row.status) || row.deletedAt) return null
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', row.runId)).unique()
    const actor = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)).unique()
    const membership = actor ? await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)).unique() : null
    const participant = actor && run ? await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run.conversationId).eq('principalId', actor.principalId)).unique() : null
    if (!run || !actor || actor.archivedAt || actor.type !== 'human' || membership?.status !== 'active' || participant?.status !== 'active') return null
    return { ...clean(row), id: row.artifactId }
  },
})

export const finalizeArtifactByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), artifactId: v.string(),
    status: v.union(v.literal('clean'), v.literal('rejected')), scanResult: v.string(), expiresAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', args.artifactId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.environmentId !== args.environmentId || !['pending_upload', 'scanning'].includes(row.status)) return null
    const usage = args.status === 'rejected' ? await artifactPolicyUsage(ctx, row.workspaceId, args.now) : null
    await ctx.db.patch(row._id, { status: args.status, scanResult: args.scanResult,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }), updatedAt: args.now })
    if (usage) await ctx.db.patch(usage._id, {
      activeArtifactBytes: Math.max(0, usage.activeArtifactBytes - row.size), updatedAt: args.now,
    })
    return { ...clean(row), id: row.artifactId, status: args.status, scanResult: args.scanResult,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }), updatedAt: args.now }
  },
})

export const listArtifactsForCleanupByServer = query({
  args: { serverSecret: v.string(), now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('agentArtifacts').withIndex('by_status_expiresAt').collect()
    return rows.filter(row => row.status !== 'deleted' && row.expiresAt <= args.now).slice(0, args.limit)
      .map(row => ({ ...clean(row), id: row.artifactId }))
  },
})

export const markArtifactDeletedByServer = mutation({
  args: { serverSecret: v.string(), artifactId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', args.artifactId)).unique()
    if (!row || row.status === 'deleted') return false
    const usage = ['pending_upload', 'scanning', 'clean', 'linked'].includes(row.status)
      ? await artifactPolicyUsage(ctx, row.workspaceId, args.now) : null
    await ctx.db.patch(row._id, { status: 'deleted', deletedAt: args.now, updatedAt: args.now })
    if (usage) await ctx.db.patch(usage._id, {
      activeArtifactBytes: Math.max(0, usage.activeArtifactBytes - row.size), updatedAt: args.now,
    })
    return true
  },
})

export const sweepRemoteRunsByServer = mutation({
  args: { serverSecret: v.string(), now: v.number(), hostOfflineBefore: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return sweepRemoteRuns(ctx, { ...args, settleBilling: false })
  },
})

export const sweepRemoteRunsInternal = internalMutation({
  args: { now: v.optional(v.number()), hostOfflineBefore: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    return sweepRemoteRuns(ctx, {
      now,
      hostOfflineBefore: args.hostOfflineBefore ?? now - 90_000,
      limit: 100,
      settleBilling: true,
    })
  },
})

export const pruneEventRateWindowsInternal = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - 10 * 60_000
    const rows = await ctx.db.query('agentEventRateWindows')
      .withIndex('by_windowStartedAt', q => q.lt('windowStartedAt', cutoff)).take(1_000)
    for (const row of rows) await ctx.db.delete(row._id)
    return { deleted: rows.length }
  },
})

export const listPendingSandboxSettlementsByServer = query({
  args: { serverSecret: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)))
    const markers = await ctx.db.query('agentSandboxSettlements')
      .withIndex('by_status_updatedAt', q => q.eq('status', 'pending'))
      .take(limit)
    const settlements = []
    for (const marker of markers) {
      const session = await ctx.db.query('agentRemoteSessions')
        .withIndex('by_runId', q => q.eq('runId', marker.runId)).unique()
      if (!session || !['completed', 'failed', 'cancelled'].includes(session.status)) continue
      const run = await ctx.db.query('conversationAgentRuns')
        .withIndex('by_externalRunId', q => q.eq('externalRunId', marker.runId)).unique()
      const message = run ? await ctx.db.get(run.assistantMessageId) : null
      settlements.push(terminalBilling(
        session.capabilitySnapshot,
        message?.tokens,
        terminalOutcome(session.status),
      ))
    }
    return settlements
  },
})

export const markSandboxSettlementCompleteByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), reservationId: v.string(), settledAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const marker = await ctx.db.query('agentSandboxSettlements')
      .withIndex('by_reservationId', q => q.eq('reservationId', args.reservationId)).unique()
    if (!marker || marker.workspaceId !== args.workspaceId) return false
    if (marker.status === 'settled') return true
    await ctx.db.patch(marker._id, { status: 'settled', settledAt: args.settledAt, updatedAt: args.settledAt })
    return true
  },
})

export const createSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(),
    runId: v.optional(v.string()), provider: v.string(), providerReference: v.optional(v.string()),
    status: v.string(), reservationId: v.optional(v.string()), reservedUntil: v.number(),
    runtimeStartedAt: v.optional(v.number()), runtimeEndedAt: v.optional(v.number()),
    usage: anyObject, cleanupAttempts: v.number(), cleanupAfter: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
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
    cleanupAfter: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', q => q.eq('leaseId', args.leaseId)).unique()
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
    const rows = await ctx.db.query('agentSandboxLeases')
      .withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId).eq('environmentId', args.environmentId))
      .take(100)
    const current = rows.filter(row => ['reserved', 'provisioning', 'running'].includes(row.status))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    return current ? { ...clean(current), id: current.leaseId } : null
  },
})

export const claimCommandsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number(), leaseMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'pending' || environment.status === 'revoked') return []
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_COMMANDS_PER_POLL ||
      !Number.isSafeInteger(args.leaseMs) || args.leaseMs < 1_000 || args.leaseMs > 60_000) {
      throw new Error('AGENT_COMMAND_POLL_LIMIT_INVALID')
    }
    const [pendingRows, expiredClaimRows] = await Promise.all([
      ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_status_sequence', q => q.eq('environmentId', args.environmentId).eq('status', 'pending'))
        .take(args.limit),
      ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_status_claimExpiresAt', q => q
          .eq('environmentId', args.environmentId)
          .eq('status', 'claimed')
          .lte('claimExpiresAt', args.now))
        .take(args.limit),
    ])
    const rows = [...pendingRows, ...expiredClaimRows].sort((left, right) => left.sequence - right.sequence)
    const claimable: typeof rows = []
    for (const row of rows) {
      if (claimable.length >= args.limit) break
      if (row.workspaceId !== args.workspaceId || !(row.status === 'pending' || (row.status === 'claimed' && (row.claimExpiresAt ?? 0) <= args.now))) continue
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', row.runId)).unique()
      if (run && row.type !== 'cancel' && (!['queued', 'running', 'waiting_for_approval'].includes(run.status) ||
        (run.leaseExpiresAt !== undefined && run.leaseExpiresAt <= args.now))) continue
      claimable.push(row)
    }
    return await Promise.all(claimable.map(async row => {
      await ctx.db.patch(row._id, { status: 'claimed', claimedAt: args.now, claimExpiresAt: args.now + args.leaseMs, updatedAt: args.now })
      return { ...clean(row), id: row.commandId, status: 'claimed', claimedAt: args.now, claimExpiresAt: args.now + args.leaseMs, updatedAt: args.now }
    }))
  },
})

export const applyRemoteEventsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), sessionId: v.string(), events: v.array(v.object({ protocolVersion: v.number(), eventId: v.string(), environmentId: v.string(), runId: v.string(), sourceSequence: v.number(), type: v.string(), occurredAt: v.number(), payload: anyObject })), maxEventsPerMinute: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.sessionId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.environmentId !== args.environmentId) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'pending' || environment.status === 'revoked') {
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    }
    if (args.events.length === 0) return { accepted: true, acknowledgedSequence: session.eventCursor, duplicate: true }
    if (args.events.length > MAX_EVENTS_PER_BATCH || jsonByteLength(args.events) > MAX_EVENT_BATCH_BYTES) {
      throw new Error('AGENT_EVENT_BATCH_TOO_LARGE')
    }
    if (args.events.some(event => event.protocolVersion !== 1) || new Set(args.events.map(event => event.eventId)).size !== args.events.length) {
      throw new Error('AGENT_EVENT_BATCH_INVALID')
    }
    const first = args.events[0]!.sourceSequence
    if (args.events.some((event, index) => event.sourceSequence !== first + index)) throw new Error('AGENT_EVENT_BATCH_NOT_CONTIGUOUS')
    if (args.events.some(event => event.environmentId !== args.environmentId || event.runId !== session.runId)) throw new Error('AGENT_EVENT_SCOPE_MISMATCH')
    const last = args.events.at(-1)!.sourceSequence
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', session.runId)).unique()
    const message = run ? await ctx.db.get(run.assistantMessageId) : null
    const duplicateResult = () => ({
      accepted: true as const, acknowledgedSequence: session.eventCursor, duplicate: true,
      ...(run && message && ['completed', 'failed', 'cancelled'].includes(run.status)
        ? { terminal: terminalBilling(session.capabilitySnapshot, message.tokens, run.status as 'completed' | 'failed' | 'cancelled') } : {}),
    })
    if (last <= session.eventCursor) return duplicateResult()
    const expected = session.eventCursor + 1
    if (first !== expected) return { accepted: false, expectedSequence: expected }
    if (args.maxEventsPerMinute !== undefined) {
      const windowStartedAt = Math.floor(args.now / 60_000) * 60_000
      const window = await ctx.db.query('agentEventRateWindows')
        .withIndex('by_environmentId_windowStartedAt', q => q.eq('environmentId', args.environmentId).eq('windowStartedAt', windowStartedAt))
        .unique()
      const eventCount = (window?.eventCount ?? 0) + args.events.length
      if (eventCount > args.maxEventsPerMinute) throw new Error('CONNECTED_AGENT_POLICY_LIMIT:event_rate')
      if (window) await ctx.db.patch(window._id, { eventCount, updatedAt: args.now })
      else await ctx.db.insert('agentEventRateWindows', {
        environmentId: args.environmentId, workspaceId: args.workspaceId,
        windowStartedAt, eventCount, updatedAt: args.now,
      })
    }
    // Compatibility for sessions created through the lower-level Phase 1 repository contract.
    if (!run) {
      await ctx.db.patch(session._id, { eventCursor: last, updatedAt: args.now })
      return { accepted: true, acknowledgedSequence: last, duplicate: false }
    }
    if (run.runner !== 'remote' || run.environmentId !== args.environmentId) throw new Error('AGENT_REMOTE_RUN_NOT_FOUND')
    if (!message) throw new Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      if (!isCompatibleTerminalAcknowledgement(run.status, args.events)) throw new Error('AGENT_RUN_TERMINAL')
      await ctx.db.patch(session._id, { eventCursor: last, updatedAt: args.now })
      return { accepted: true, acknowledgedSequence: last, duplicate: false,
        terminal: terminalBilling(session.capabilitySnapshot, message.tokens, terminalOutcome(run.status)) }
    }
    const snapshot = session.capabilitySnapshot && typeof session.capabilitySnapshot === 'object'
      ? session.capabilitySnapshot as Record<string, unknown> : {}
    const normalizedEvents: AgentRemoteEvent[] = []
    for (const event of args.events as AgentRemoteEvent[]) {
      if (event.type === 'approval_requested' || event.type === 'elicitation_requested') {
        const requestKey = typeof event.payload.requestKey === 'string' ? event.payload.requestKey : ''
        if (!requestKey) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
        const existing = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId).eq('requestKey', requestKey)).unique()
        if (!existing) {
          const options = event.type === 'approval_requested' && Array.isArray(event.payload.options)
            ? event.payload.options.map(option => option && typeof option === 'object' ? String((option as Record<string, unknown>).id ?? '') : '').filter(Boolean)
            : ['accept', 'decline', 'cancel']
          if (options.length === 0) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
          await ctx.db.insert('agentApprovalRequests', { approvalId: `approval_${crypto.randomUUID()}`,
            workspaceId: args.workspaceId, runId: session.runId, remoteSessionId: session.sessionId,
            requestKey, kind: event.type === 'approval_requested' ? 'permission' : 'elicitation',
            prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'Agent request',
            options, payload: event.payload, requestedAt: event.occurredAt })
        }
      }
      if (event.type === 'artifact') {
        const reference = typeof event.payload.uploadReference === 'string' ? event.payload.uploadReference : ''
        const artifact = await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', reference)).unique()
        if (!artifact || artifact.workspaceId !== args.workspaceId || artifact.environmentId !== args.environmentId
          || artifact.runId !== session.runId || artifact.remoteSessionId !== session.sessionId
          || !['clean', 'linked'].includes(artifact.status) || artifact.name !== event.payload.name
          || artifact.mediaType !== event.payload.mediaType || artifact.size !== event.payload.size || artifact.sha256 !== event.payload.sha256) {
          throw new Error('AGENT_ARTIFACT_NOT_VALIDATED')
        }
        if (artifact.status !== 'linked') await ctx.db.patch(artifact._id, { status: 'linked', linkedAt: args.now, updatedAt: args.now })
        normalizedEvents.push({ ...event, payload: { ...event.payload,
          url: `/api/v1/conversations/run/remote/artifacts/${artifact.artifactId}` } })
        continue
      }
      normalizedEvents.push(event)
    }
    const projection = projectRemoteAgentEvents({
      content: message.content,
      parts: Array.isArray(message.parts) ? message.parts as unknown as Array<Record<string, unknown>> : [],
      events: normalizedEvents,
      environmentName: typeof snapshot.environmentName === 'string' ? snapshot.environmentName : 'connected environment',
      queueExpiresAt: typeof snapshot.queueExpiresAt === 'number' ? snapshot.queueExpiresAt : args.now,
      runId: session.runId,
    })
    await ctx.db.patch(session._id, {
      eventCursor: last, status: projection.sessionStatus,
      ...(projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
      ...(!session.startedAt ? { startedAt: args.now } : {}),
      ...(projection.terminal ? { endedAt: args.now } : {}), updatedAt: args.now,
    })
    await ctx.db.patch(run._id, {
      status: projection.runStatus,
      ...(projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
      ...(!run.startedAt ? { startedAt: args.now } : {}),
      ...(projection.runStatus === 'completed' ? { completedAt: args.now } : {}),
      ...(projection.runStatus === 'failed' ? { failedAt: args.now, terminalError: projection.terminalError } : {}),
      ...(projection.runStatus === 'cancelled' ? { cancelledAt: args.now } : {}),
      ...(projection.terminal ? { metrics: { ...(run.metrics ?? {}), inputTokens: projection.tokens.input, outputTokens: projection.tokens.output } } : {}),
      ...(!projection.terminal ? { leaseExpiresAt: Math.min(
        args.now + REMOTE_RUN_LEASE_MS,
        typeof snapshot.hardExpiresAt === 'number' ? snapshot.hardExpiresAt : args.now + REMOTE_RUN_LEASE_MS,
      ) } : {}),
      updatedAt: args.now,
    })
    await ctx.db.patch(message._id, {
      content: projection.content, parts: conversationParts(projection.parts),
      ...(projection.terminal ? { tokens: projection.tokens } : {}),
      status: projection.runStatus === 'failed' ? 'error' : projection.terminal ? 'completed' : 'generating',
      updatedAt: args.now,
    })
    await ctx.db.patch(run.conversationId, { lastModified: args.now, updatedAt: args.now })
    await ctx.db.insert('conversationEvents', {
      conversationId: run.conversationId, workspaceId: args.workspaceId, messageId: message._id,
      type: projection.runStatus === 'failed' ? 'message.failed' : projection.terminal ? 'message.completed' : 'message.delta',
      userId: run.userId, createdAt: args.now,
    })
    if (projection.terminal) {
      const requests = await ctx.db.query('agentApprovalRequests')
        .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', args.workspaceId).eq('runId', session.runId)).take(100)
      for (const request of requests) if (!request.resolution) {
        await ctx.db.patch(request._id, { resolution: {
          decision: projection.runStatus === 'cancelled' ? 'cancelled' : projection.runStatus === 'failed' ? 'run_failed' : 'run_completed',
          resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
        } })
      }
      const commands = await ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId))
        .filter(q => q.eq(q.field('runId'), session.runId)).take(100)
      for (const command of commands) if (command.status !== 'cancelled') {
        await ctx.db.patch(command._id, { status: 'acknowledged',
          acknowledgedAt: command.acknowledgedAt ?? args.now, claimExpiresAt: undefined, updatedAt: args.now })
      }
    }
    return { accepted: true, acknowledgedSequence: last, duplicate: false,
      ...(projection.terminal ? { terminal: terminalBilling(session.capabilitySnapshot, projection.tokens, terminalOutcome(projection.runStatus)) } : {}) }
  },
})

export const revokeEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return false
    if (environment.status === 'revoked') return true
    await ctx.db.patch(environment._id, { status: 'revoked', revokedAt: args.now, updatedAt: args.now })
    for (const binding of await ctx.db.query('agentBindings').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).take(1_000)) await ctx.db.patch(binding._id, { enabled: false, updatedAt: args.now })
    for (const command of await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).take(1_000)) if (command.status === 'pending' || command.status === 'claimed') await ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: args.now, updatedAt: args.now })
    for (const credential of await ctx.db.query('agentEnvironmentCredentials').withIndex('by_environmentId_expiresAt', q => q.eq('environmentId', args.environmentId)).take(1_000)) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: args.now })
    for (const lease of await ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId).eq('environmentId', args.environmentId)).take(1_000)) if (!['released', 'cleanup_failed'].includes(lease.status)) await ctx.db.patch(lease._id, { status: 'stopping', reservedUntil: args.now, cleanupAfter: args.now, updatedAt: args.now })
    return true
  },
})

export const deleteWorkspaceDataByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const credentials = await ctx.db.query('agentEnvironmentCredentials')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    const credentialNonces = (await Promise.all(credentials.map(credential =>
      ctx.db.query('agentEnvironmentCredentialNonces')
        .withIndex('by_credentialId_expiresAt', q => q.eq('credentialId', credential.credentialId)).collect(),
    ))).flat()
    const groups = await Promise.all([
      Promise.resolve(credentialNonces),
      Promise.resolve(credentials),
      ctx.db.query('agentEnvironmentProofChallenges').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentEnrollmentSessions').withIndex('by_workspaceId_createdAt', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentApprovalRequests').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentArtifacts').withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentRunCommands').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentEventRateWindows').withIndex('by_workspaceId_windowStartedAt', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentWorkspacePolicyUsage').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentSandboxSettlements').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentRemoteSessions').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentBindings').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentEnvironments').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
    ])
    for (const rows of groups) for (const row of rows) await ctx.db.delete(row._id)
    return true
  },
})

async function artifactPolicyUsage(ctx: MutationCtx, workspaceId: string, now: number) {
  const existing = await ctx.db.query('agentWorkspacePolicyUsage')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  if (existing) return existing
  const statuses = ['pending_upload', 'scanning', 'clean', 'linked'] as const
  const groups = await Promise.all(statuses.map(status => ctx.db.query('agentArtifacts')
    .withIndex('by_workspaceId_status', q => q.eq('workspaceId', workspaceId).eq('status', status))
    .take(10_001)))
  if (groups.some(group => group.length > 10_000)) throw new Error('CONNECTED_AGENT_POLICY_USAGE_RECONCILIATION_REQUIRED')
  const activeArtifactBytes = groups.flat().reduce((sum, artifact) => sum + artifact.size, 0)
  const _id = await ctx.db.insert('agentWorkspacePolicyUsage', { workspaceId, activeArtifactBytes, updatedAt: now })
  const inserted = await ctx.db.get(_id)
  if (!inserted) throw new Error('CONNECTED_AGENT_POLICY_USAGE_UNAVAILABLE')
  return inserted
}

function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) {
  return left.decision === right.decision
    && left.resolvedByPrincipalId === right.resolvedByPrincipalId
    && left.resolvedAt === right.resolvedAt
}

function terminalBilling(snapshotValue: unknown, tokensValue: unknown, outcome: 'completed' | 'failed' | 'cancelled' | 'timeout') {
  const snapshot = snapshotValue && typeof snapshotValue === 'object'
    ? snapshotValue as Record<string, unknown> : {}
  const billing = snapshot.billing && typeof snapshot.billing === 'object'
    ? snapshot.billing as Record<string, unknown> : {}
  const tokens = tokensValue && typeof tokensValue === 'object'
    ? tokensValue as Record<string, unknown> : {}
  return {
    agentId: typeof billing.agentId === 'string' ? billing.agentId : '',
    environmentId: typeof billing.environmentId === 'string' ? billing.environmentId : '',
    forceFreeTierLimits: false,
    inputTokens: typeof tokens.input === 'number' ? tokens.input : 0,
    modelId: typeof billing.modelId === 'string' ? billing.modelId : 'openrouter/free',
    modelUsageBilling: billing.modelUsageBilling === 'overlay' ? 'overlay' as const : 'byok' as const,
    operationId: typeof billing.operationId === 'string' ? billing.operationId : 'remote-agent',
    outcome,
    outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
    reservationId: typeof billing.reservationId === 'string' ? billing.reservationId : null,
    runId: typeof billing.runId === 'string' ? billing.runId : '',
    sandboxBilling: snapshot.sandboxBilling && typeof snapshot.sandboxBilling === 'object'
      ? snapshot.sandboxBilling as Record<string, unknown>
      : null,
    userId: typeof billing.userId === 'string' ? billing.userId : '',
    workspaceId: typeof billing.workspaceId === 'string' ? billing.workspaceId : '',
  }
}
function terminalOutcome(status: string): 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed'
}
function isCompatibleTerminalAcknowledgement(status: string, events: Array<{ type: string }>) {
  const expected = status === 'cancelled' ? 'cancelled' : status === 'completed' ? 'completed' : 'failed'
  return events.every((event) => event.type === expected)
}

async function sweepRemoteRuns(
  ctx: MutationCtx,
  args: { now: number; hostOfflineBefore: number; limit: number; settleBilling?: boolean },
) {
  const statuses = ['queued', 'running', 'waiting_for_approval'] as const
  const active = (await Promise.all(statuses.map(status =>
    ctx.db.query('conversationAgentRuns')
      .withIndex('by_runner_status_leaseExpiresAt', q => q.eq('runner', 'remote').eq('status', status))
      .take(args.limit),
  ))).flat().slice(0, args.limit)
  const expiredRunIds: string[] = []
  const settlements = []
  const alerts: Array<Record<string, unknown>> = []
  for (const run of active) {
    const session = run.externalRunId
      ? await ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', run.externalRunId!)).unique()
      : null
    const environment = session
      ? await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', session.environmentId)).unique()
      : null
    const offline = (environment?.lastSeenAt ?? 0) <= args.hostOfflineBefore
    if (!offline && (run.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > args.now) continue
    const message = await ctx.db.get(run.assistantMessageId)
    if (!session || !environment || !message || !run.externalRunId) continue
    const code = offline ? 'remote_host_offline' : 'remote_run_timeout'
    const failureMessage = offline ? 'The connected environment disappeared.' : 'The connected agent run timed out.'
    await ctx.db.patch(run._id, { status: 'failed', failedAt: args.now,
      terminalError: { code, message: failureMessage, retryable: true }, updatedAt: args.now })
    await ctx.db.patch(session._id, { status: 'failed', endedAt: args.now, updatedAt: args.now })
    await ctx.db.patch(message._id, { content: message.content || failureMessage,
      parts: conversationParts(recoveryParts(message.parts, run.externalRunId, environment.name, code, failureMessage, args.now)),
      status: 'error', updatedAt: args.now })
    const commands = await ctx.db.query('agentRunCommands')
      .withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId))
      .filter(q => q.eq(q.field('runId'), run.externalRunId!)).take(100)
    for (const command of commands) {
      if (command.status === 'pending' || command.status === 'claimed') {
        await ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: undefined, updatedAt: args.now })
      }
    }
    const requests = await ctx.db.query('agentApprovalRequests')
      .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', session.workspaceId).eq('runId', run.externalRunId!)).take(100)
    for (const request of requests) if (!request.resolution) {
      await ctx.db.patch(request._id, { resolution: {
        decision: code, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
      } })
    }
    await ctx.db.insert('conversationEvents', { conversationId: run.conversationId,
      workspaceId: session.workspaceId, messageId: message._id, type: 'message.failed', userId: run.userId, createdAt: args.now })
    expiredRunIds.push(run.externalRunId)
    const settlement = terminalBilling(session.capabilitySnapshot, message.tokens, 'timeout')
    settlements.push(settlement)
    alerts.push({
      code: offline ? 'offline_environment' : 'lease_expired',
      workspaceId: session.workspaceId,
      agentId: settlement.agentId || run.agentId,
      environmentId: session.environmentId,
      runId: run.externalRunId,
      remoteSessionId: session.sessionId,
      ...(settlement.reservationId ? { reservationId: settlement.reservationId } : {}),
      eventCursor: session.eventCursor,
    })
    for (const command of commands) if (
      (command.status === 'pending' || command.status === 'claimed') && command.updatedAt <= args.now - 2 * 60_000
    ) alerts.push({
      code: 'stuck_command', workspaceId: command.workspaceId, environmentId: command.environmentId,
      runId: command.runId, commandId: command.commandId, ageMs: args.now - command.updatedAt,
    })
    for (const request of requests) if (!request.resolution && request.requestedAt <= args.now - 15 * 60_000) {
      alerts.push({
        code: 'approval_age', workspaceId: request.workspaceId, environmentId: session.environmentId,
        runId: request.runId, remoteSessionId: request.remoteSessionId,
        eventCursor: session.eventCursor, ageMs: args.now - request.requestedAt,
      })
    }
    if (args.settleBilling && settlement.reservationId && settlement.userId) {
      await markBudgetReservationReconcile(ctx, {
        userId: settlement.userId,
        reservationId: settlement.reservationId,
        errorMessage: `remote_agent_${settlement.outcome}`,
      })
    }
  }
  const [offlineEnvironments, staleOnlineEnvironments] = await Promise.all([
    ctx.db.query('agentEnvironments').withIndex('by_status_lastSeenAt', q => q.eq('status', 'offline')).take(args.limit),
    ctx.db.query('agentEnvironments').withIndex('by_status_lastSeenAt', q => q
      .eq('status', 'online').lte('lastSeenAt', args.hostOfflineBefore)).take(args.limit),
  ])
  const alertedEnvironments = new Set(alerts.map(alert => alert.environmentId).filter(Boolean))
  for (const environment of [...offlineEnvironments, ...staleOnlineEnvironments]) {
    if (!environment.approvedAt || environment.revokedAt || alertedEnvironments.has(environment.environmentId)) continue
    alerts.push({
      code: 'offline_environment', workspaceId: environment.workspaceId,
      environmentId: environment.environmentId,
      ...(environment.lastSeenAt === undefined ? {} : { ageMs: args.now - environment.lastSeenAt }),
    })
  }
  const oldCommands = (await Promise.all((['pending', 'claimed'] as const).map(status =>
    ctx.db.query('agentRunCommands').withIndex('by_status_updatedAt', q => q
      .eq('status', status).lte('updatedAt', args.now - 2 * 60_000)).take(args.limit),
  ))).flat().slice(0, args.limit)
  const alertedCommands = new Set(alerts.map(alert => alert.commandId).filter(Boolean))
  for (const command of oldCommands) if (!alertedCommands.has(command.commandId)) alerts.push({
    code: 'stuck_command', workspaceId: command.workspaceId, environmentId: command.environmentId,
    runId: command.runId, commandId: command.commandId, ageMs: args.now - command.updatedAt,
  })
  const oldApprovals = await ctx.db.query('agentApprovalRequests')
    .withIndex('by_requestedAt', q => q.lte('requestedAt', args.now - 15 * 60_000)).take(args.limit)
  const alertedApprovals = new Set(alerts.map(alert => `${alert.remoteSessionId}:${alert.runId}`).filter(Boolean))
  for (const approval of oldApprovals) {
    if (approval.resolution || alertedApprovals.has(`${approval.remoteSessionId}:${approval.runId}`)) continue
    const session = await ctx.db.query('agentRemoteSessions')
      .withIndex('by_sessionId', q => q.eq('sessionId', approval.remoteSessionId)).unique()
    alerts.push({
      code: 'approval_age', workspaceId: approval.workspaceId,
      ...(session ? { environmentId: session.environmentId, eventCursor: session.eventCursor } : {}),
      runId: approval.runId, remoteSessionId: approval.remoteSessionId,
      ageMs: args.now - approval.requestedAt,
    })
  }
  const cleanupFailures = await ctx.db.query('agentSandboxLeases')
    .withIndex('by_status_cleanupAfter', q => q.eq('status', 'cleanup_failed')).take(args.limit)
  alerts.push(...cleanupFailures.map(lease => ({
    code: 'cleanup_failure', workspaceId: lease.workspaceId, environmentId: lease.environmentId,
    ...(lease.runId ? { runId: lease.runId } : {}),
    ...(lease.providerReference ? { providerReference: lease.providerReference } : {}),
    ...(lease.reservationId ? { reservationId: lease.reservationId } : {}),
    ageMs: args.now - lease.updatedAt,
  })))
  if (args.settleBilling) for (const alert of alerts) console.warn('connected_agent_operational_alert', alert)
  return { alerts, expiredRunIds, settlements }
}

function recoveryParts(value: unknown, runId: string, environmentName: string, code: string, message: string, resolvedAt: number) {
  const parts = Array.isArray(value) ? value as Array<Record<string, unknown>> : []
  return [...parts.filter(part => part.type !== 'data-remote-agent-status').map((part) => {
    const data = part.data && typeof part.data === 'object' ? part.data as Record<string, unknown> : null
    return part.type === 'data-remote-agent-request' && data?.state === 'pending'
      ? { ...part, data: { ...data, state: 'resolved', resolution: {
        decision: code, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt,
      } } }
      : part
  }), {
    type: 'data-remote-agent-status', data: { runId, environmentName, queueExpiresAt: 0,
      state: 'recoverable', retryable: true, retryClass: code.includes('offline') ? 'host_offline' : 'timeout', message },
  }]
}
