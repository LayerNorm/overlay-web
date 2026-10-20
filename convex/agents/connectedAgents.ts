import { recordRemoteRunLiveness } from '../../src/shared/agents/remote-run-liveness'
import { agentMcpAttemptMatches, agentMcpSessionIsLive } from '../../src/shared/agents/agent-mcp-authority'
import { applyRemoteText } from '../../src/shared/agents/remote-agent-text'
import { hydrateRemoteMessage, prepareRemoteMessageText } from '../lib/remoteMessageText'
import { recoveryStartPayload } from '../lib/remoteRecovery'
import { currentRemoteAttempt, applyRemoteFact, reconcileRemoteRequestParts } from './remoteRunModel'
import {retryNativePreparation} from '../lib/nativePreparationRetry'
import {nativeRestorationStarted} from '../lib/nativeRestorationStarted'
import {admitNativeStart} from '../lib/nativeStartAdmission'
import {acceptsNativeHistory} from '../lib/nativeHistoricalEvents'
import type {NativeStartAdmission} from '@layernorm/overlay-agent-bridge-protocol'
import { pendingRemoteApprovals, remoteRunCoarseStatus, type RemoteRunState } from '../../src/shared/agents/remote-run'
import { v } from 'convex/values'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { interruptRemoteAgentToolParts, projectRemoteAgentEvents, resolveRemoteRequestPart, waitingRemoteAgentParts } from '../../src/shared/agents/remote-agent-transcript'
import { recordAcceptedBatch, recordRejectedBatch, settleInterruptedRemoteRunTools } from '../../src/shared/agents/remote-run-stream-stats'
import { assertValidElicitationResponse } from '../../src/shared/agents/elicitation-schema'
import { finalizeWorkspaceLedger, markBudgetReservationReconcile } from '../platform/usage'
import { connectedAgentPolicyProjection } from '../lib/connectedAgentPolicyProjection'
import { applySandboxSpendLimits, prepareSandboxSpendLimits } from '../lib/sandboxSpendLimits'

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
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}
function clean<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}
function conversationParts(parts: Array<Record<string, unknown>>) {
  return parts.map((part) => {
    if (
      part.type !== 'data-remote-agent-status' ||
      !part.data ||
      typeof part.data !== 'object'
    )
      return part
    const data = part.data as Record<string, unknown>
    return { type: 'data-remote-agent-status', data: {
      environmentName: typeof data.environmentName === 'string' ? data.environmentName : 'connected environment',
      queueExpiresAt: typeof data.queueExpiresAt === 'number' ? data.queueExpiresAt : 0,
      ...(typeof data.hardDeadlineAt === 'number' ? { hardDeadlineAt: data.hardDeadlineAt } : {}),
      ...(['attached_live', 'restored', 'requires_new_attempt', 'unavailable'].includes(String(data.recoveryOutcome))
        ? {recoveryOutcome: data.recoveryOutcome} : {}),
      runId: typeof data.runId === 'string' ? data.runId : 'remote-agent',
      state: ['waiting', 'starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recoverable', 'recovering', 'finalizing', 'needs_attention', 'cancelling', 'completed', 'failed', 'cancelled'].includes(String(data.state))
        ? data.state : 'running',
      ...(typeof data.retryable === 'boolean' ? { retryable: data.retryable } : {}),
      ...(['transient', 'timeout', 'host_offline', 'permission', 'fatal'].includes(String(data.retryClass))
        ? { retryClass: data.retryClass } : {}),
    } }
  }) as unknown as NonNullable<Doc<'conversationMessages'>['parts']>
}

/** A cloud run with no events for this long, on a machine whose host has since restarted, will never finish. */
const ABANDONED_CLOUD_RUN_MS = 15 * 60_000

export const createEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), kind: v.string(), name: v.string(), status: v.string(), publicKey: v.optional(v.string()), hostVersion: v.optional(v.string()), platform: v.optional(v.string()), capabilities: anyObject, filesystemGrant: v.optional(anyObject), approvedByUserId: v.optional(v.string()), approvedAt: v.optional(v.number()), lastSeenAt: v.optional(v.number()), revokedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) => q.eq('environmentId', args.id))
      .unique()
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
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    )
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
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
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      !environment.approvedAt ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    ) {
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    }
    const agentPrincipal = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId_agentId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId),
      )
      .unique()
    if (
      !agentPrincipal ||
      agentPrincipal.type !== 'agent' ||
      agentPrincipal.archivedAt
    ) {
      throw new Error('AGENT_PRINCIPAL_UNAVAILABLE')
    }
    const existing = (
      await ctx.db
        .query('agentBindings')
        .withIndex('by_workspaceId_agentId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId),
        )
        .take(200)
    ).sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (existing) {
      await ctx.db.patch(existing._id, {
        environmentId: args.environmentId, protocolAdapter: args.protocolAdapter,
        adapterConfig: args.adapterConfig, enabled: args.enabled, updatedAt: args.now,
      })
      return {
        ...clean(existing),
        environmentId: args.environmentId,
        protocolAdapter: args.protocolAdapter,
        adapterConfig: args.adapterConfig,
        enabled: args.enabled,
        updatedAt: args.now,
        id: existing.bindingId,
    }
    }
    const row = {
      bindingId: args.id,
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      environmentId: args.environmentId,
      protocolAdapter: args.protocolAdapter,
      adapterConfig: args.adapterConfig,
      enabled: args.enabled,
      createdAt: args.now,
      updatedAt: args.now,
    }
    await ctx.db.insert('agentBindings', row)
    return { ...row, id: row.bindingId }
  },
})

export const listBindingsByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = args.agentId
      ? await ctx.db
          .query('agentBindings')
          .withIndex('by_workspaceId_agentId', (q) =>
            q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId!),
          )
          .take(200)
      : await ctx.db
          .query('agentBindings')
          .withIndex('by_workspaceId', (q) =>
            q.eq('workspaceId', args.workspaceId),
          )
          .take(200)
    return rows
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((row) => ({ ...clean(row), id: row.bindingId }))
  },
})

export const getWorkspacePolicyUsageByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.object({ activeArtifactBytes: v.number(), activeRuns: v.number(), environments: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environmentStatuses = ['pending', 'offline', 'online'] as const
    const runStatuses = ['queued', 'waking', 'starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering', 'needs_attention', 'cancelling'] as const
    const [environmentGroups, runGroups, artifactUsage] = await Promise.all([
      Promise.all(
        environmentStatuses.map((status) =>
          ctx.db
            .query('agentEnvironments')
            .withIndex('by_workspaceId_status', (q) =>
              q.eq('workspaceId', args.workspaceId).eq('status', status),
            )
            .take(101),
        ),
      ),
      Promise.all(
        runStatuses.map((status) =>
          ctx.db
            .query('agentRemoteSessions')
            .withIndex('by_workspaceId_status', (q) =>
              q.eq('workspaceId', args.workspaceId).eq('status', status),
            )
            .take(101),
        ),
      ),
      ctx.db
        .query('agentWorkspacePolicyUsage')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .unique(),
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
    const rows = await ctx.db
      .query('agentBindings')
      .withIndex('by_workspaceId_agentId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId),
      )
      .take(200)
    const enabledRows = rows.filter((row) => row.enabled)
    await Promise.all(enabledRows.map((row) => ctx.db.patch(row._id, { enabled: false, updatedAt: args.now })))
    return enabledRows.length > 0
  },
})

export const findInvocationTargetByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), now: v.number(), onlineWithinMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const bindings = (
      await ctx.db
        .query('agentBindings')
        .withIndex('by_workspaceId_agentId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId),
        )
        .take(200)
    )
      .filter((binding) => binding.enabled)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    for (const binding of bindings) {
      const environment = await ctx.db
        .query('agentEnvironments')
        .withIndex('by_environmentId', (q) =>
          q.eq('environmentId', binding.environmentId),
        )
        .unique()
      if (
        !environment ||
        environment.workspaceId !== args.workspaceId ||
        !environment.approvedAt ||
        environment.revokedAt ||
        environment.status === 'revoked'
      )
        continue
      const online =
        environment.status === 'online' &&
        (environment.lastSeenAt ?? 0) >= args.now - args.onlineWithinMs
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
    memoryEnabled: v.optional(v.boolean()),
    lifecycleVersion: v.optional(v.literal(2)),
    reservationId: v.union(v.string(), v.null()), runId: v.string(), sessionId: v.string(),
    sandboxBilling: v.optional(anyObject),
    startPayload: anyObject, threadRootMessageId: v.optional(v.id('conversationMessages')),
    turnId: v.string(), userMessageId: v.id('conversationMessages'), workspaceId: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (jsonByteLength(args.startPayload) > MAX_COMMAND_BYTES)
      throw new Error('AGENT_COMMAND_TOO_LARGE')
    const actor = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId),
      )
      .unique()
    if (
      !actor ||
      actor.type !== 'human' ||
      actor.archivedAt ||
      actor.principalId !== args.initiatorPrincipalId
    ) {
      throw new Error('CONVERSATION_ACCESS_DENIED')
    }
    const [
      membership,
      actorParticipant,
      agent,
      agentParticipant,
      conversation,
      userMessage,
      binding,
      environment,
    ] = await Promise.all([
      ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) =>
          q
            .eq('workspaceId', args.workspaceId)
            .eq('principalId', actor.principalId),
        )
        .unique(),
      ctx.db
        .query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) =>
          q
            .eq('conversationId', args.conversationId)
            .eq('principalId', actor.principalId),
        )
        .unique(),
      ctx.db
        .query('workspacePrincipals')
        .withIndex('by_principalId', (q) =>
          q.eq('principalId', args.authorPrincipalId),
        )
        .unique(),
      ctx.db
        .query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) =>
          q
            .eq('conversationId', args.conversationId)
            .eq('principalId', args.authorPrincipalId),
        )
        .unique(),
      ctx.db.get(args.conversationId),
      ctx.db.get(args.userMessageId),
      ctx.db
        .query('agentBindings')
        .withIndex('by_bindingId', (q) => q.eq('bindingId', args.bindingId))
        .unique(),
      ctx.db
        .query('agentEnvironments')
        .withIndex('by_environmentId', (q) =>
          q.eq('environmentId', args.environmentId),
        )
        .unique(),
    ])
    if (!membership || membership.status !== 'active' || !actorParticipant || actorParticipant.status !== 'active' ||
      !conversation || conversation.deletedAt || conversation.workspaceId !== args.workspaceId ||
      // The message that asks is a person's, or an agent's question posted for that person (agent asks agent).
      !userMessage || userMessage.conversationId !== args.conversationId ||
      (userMessage.role !== 'user' && userMessage.authorKind !== 'agent') ||
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
    const existingMessage = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_clientNonce', (q) =>
        q
          .eq('conversationId', args.conversationId)
          .eq('clientNonce', args.clientNonce),
      )
      .first()
    if (existingMessage) {
      const existingRun = await ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_assistantMessageId', (q) =>
          q.eq('assistantMessageId', existingMessage._id),
        )
        .unique()
      if (
        !existingRun ||
        existingRun.runner !== 'remote' ||
        existingRun.agentId !== args.agentId ||
        !existingRun.externalRunId
      ) {
        throw new Error('AGENT_REMOTE_TURN_IDEMPOTENCY_CONFLICT')
      }
      const existingCommand = await ctx.db
        .query('agentRunCommands')
        .withIndex('by_environmentId_sequence', (q) =>
          q.eq('environmentId', args.environmentId),
        )
        .filter((q) => q.eq(q.field('runId'), existingRun.externalRunId))
        .first()
      if (!existingCommand) throw new Error('AGENT_REMOTE_TURN_INCOMPLETE')
      const currentOnline = environment.status === 'online' && (environment.lastSeenAt ?? 0) >= args.now - 45_000
      return { lifecycleVersion: existingRun.remoteLifecycle ? 2 : 1, commandId: existingCommand.commandId, environmentName: environment.name,
        messageId: existingMessage._id, resumed: true, runId: existingRun.externalRunId, waiting: !currentOnline }
    }
    if (args.threadRootMessageId) {
      const threadRoot = await ctx.db.get(args.threadRootMessageId)
      if (!threadRoot || threadRoot.conversationId !== args.conversationId || threadRoot.deletedAt) {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
    }
    const [runCollision, sessionCollision, commandCollision] =
      await Promise.all([
        ctx.db
          .query('conversationAgentRuns')
          .withIndex('by_externalRunId', (q) =>
            q.eq('externalRunId', args.runId),
          )
          .first(),
        ctx.db
          .query('agentRemoteSessions')
          .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
          .first(),
        ctx.db
          .query('agentRunCommands')
          .withIndex('by_commandId', (q) => q.eq('commandId', args.commandId))
          .first(),
    ])
    if (runCollision || sessionCollision || commandCollision)
      throw new Error('AGENT_REMOTE_TURN_EXISTS')
    const activeStatuses = [
      'queued',
      'waking',
      'starting',
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'recovering',
      'needs_attention',
      'cancelling',
    ] as const
    const activeRuns = (
      await Promise.all(
        activeStatuses.map((status) =>
          ctx.db
            .query('agentRemoteSessions')
            .withIndex('by_workspaceId_status', (q) =>
              q.eq('workspaceId', args.workspaceId).eq('status', status),
            )
            .take(args.maxConcurrentRuns + 1),
        ),
      )
    ).flat()
    if (activeRuns.length >= args.maxConcurrentRuns)
      throw new Error('CONNECTED_AGENT_POLICY_LIMIT:concurrent_runs')
    if (environment.kind === 'overlay_cloud') {
      const activeManagedRuns = (
        await Promise.all(
          activeStatuses.map((status) =>
            ctx.db
              .query('agentRemoteSessions')
              .withIndex('by_environmentId_status', (q) =>
                q.eq('environmentId', args.environmentId).eq('status', status),
              )
              .first(),
          ),
        )
      ).filter(Boolean)
      if (activeManagedRuns.length > 0)
        throw new Error(
          'CONNECTED_AGENT_POLICY_LIMIT:managed_environment_concurrency',
        )
    }
    const online = environment.status === 'online' && (environment.lastSeenAt ?? 0) >= args.now - 45_000
    const lifecycle = args.lifecycleVersion === 2 && (environment.capabilities as { remoteLifecycleVersion?: number }).remoteLifecycleVersion === 2
      ? { version: 2 as const, revision: 0, phase: 'queued' as const, currentAttemptId: args.sessionId,
          executionGeneration: 1, coordinatorGeneration: 1, hardDeadlineAt: args.now + args.maxRunTimeMs,
          claimDeadlineAt: args.queueExpiresAt } : undefined
    const checkpointPayload = lifecycle ? {
      bindingId: args.bindingId, adapterId: args.startPayload.adapterId,
      workingDirectory: args.startPayload.workingDirectory,
      configurationReference: args.bindingId, toolsReference: args.runId,
      model: args.startPayload.metadata?.model ?? null,
    } : args.startPayload
    const waitingParts = waitingRemoteAgentParts({ environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId,
      ...(lifecycle ? { hardDeadlineAt: lifecycle.hardDeadlineAt } : {}) })
    let initialParts = online ? [] : waitingParts
    if (online && lifecycle) initialParts = [{type: 'data-remote-agent-status', data: {
      environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId,
      state: 'starting', hardDeadlineAt: lifecycle.hardDeadlineAt,
    }}]
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId, userId: args.actorUserId, authorKind: 'agent',
      authorPrincipalId: args.authorPrincipalId, turnId: args.turnId, role: 'assistant', mode: 'act',
      content: online ? '' : `Waiting for ${environment.name}`, contentType: 'text', modelId: args.modelId,
      parts: conversationParts(initialParts), status: 'generating', clientNonce: args.clientNonce,
      threadRootMessageId: args.threadRootMessageId, createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.insert('conversationAgentRuns', {
      ...(lifecycle ? { remoteLifecycle: lifecycle } : {}),
      externalRunId: args.runId, conversationId: args.conversationId, turnId: args.turnId,
      userId: args.actorUserId, userMessageId: args.userMessageId, assistantMessageId: messageId,
      agentId: args.agentId, agentPrincipalId: args.authorPrincipalId,
      initiatorPrincipalId: args.initiatorPrincipalId, environmentId: args.environmentId,
      bindingId: args.bindingId, mode: 'room', runner: 'remote', status: 'queued',
      leaseExpiresAt: Math.min(args.now + args.maxRunTimeMs, online ? args.now + REMOTE_RUN_LEASE_MS : args.queueExpiresAt),
      createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.insert('agentRemoteSessions', {
      ...(lifecycle ? { attemptId: args.sessionId, executionGeneration: 1, hardDeadlineAt: lifecycle.hardDeadlineAt, claimDeadlineAt: args.queueExpiresAt } : {}),
      sessionId: args.sessionId, workspaceId: args.workspaceId, environmentId: args.environmentId,
      bindingId: args.bindingId, runId: args.runId, status: 'starting', commandCursor: 0, eventCursor: 0,
      capabilitySnapshot: { ...environment.capabilities, billing: { reservationId: args.reservationId,
        agentId: args.agentId, conversationId: args.conversationId, environmentId: args.environmentId,
        memoryEnabled: args.memoryEnabled !== false, messageId, modelId: args.modelId,
        modelUsageBilling: args.modelUsageBilling, runId: args.runId, turnId: args.turnId, userId: args.actorUserId,
        workspaceId: args.workspaceId, operationId: `workspace-agent:${args.turnId}` },
        hardExpiresAt: args.now + args.maxRunTimeMs,
        ...(args.sandboxBilling ? { sandboxBilling: args.sandboxBilling } : {}),
        queueExpiresAt: args.queueExpiresAt, environmentName: environment.name,
        startPayload: checkpointPayload },
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
    const latest = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .order('desc')
      .first()
    await ctx.db.insert('agentRunCommands', {
      commandId: args.commandId, workspaceId: args.workspaceId, environmentId: args.environmentId,
      runId: args.runId, type: 'start', sequence: (latest?.sequence ?? 0) + 1,
      payload: args.startPayload, status: lifecycle ? 'coordinator_pending' : 'pending',
      ...(lifecycle ? { attemptId: args.sessionId, executionGeneration: 1 } : {}), createdAt: args.now, updatedAt: args.now,
    })
    if (lifecycle) for (const reservationId of [args.reservationId, args.sandboxBilling?.reservationId]) {
      if (typeof reservationId !== 'string') continue
      const reservation = await ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', reservationId)).unique()
      if (!reservation || reservation.userId !== args.actorUserId || reservation.status !== 'reserved') throw new Error('AGENT_REMOTE_FUNDING_UNAVAILABLE')
      await ctx.db.patch(reservation._id, { remoteRunId: args.runId })
    }
    if (lifecycle) await ctx.db.insert('agentRemoteRunIntents', {
      intentId: `start:${args.runId}:1`, runId: args.runId, kind: 'start', revision: 0,
      status: 'pending', createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.patch(args.conversationId, { lastMode: 'act', lastModified: args.now, updatedAt: args.now })
    await ctx.db.insert('conversationEvents', { conversationId: args.conversationId, workspaceId: args.workspaceId,
      messageId, type: 'message.created', userId: args.actorUserId, createdAt: args.now })
    return { lifecycleVersion: lifecycle ? 2 : 1, commandId: args.commandId, environmentName: environment.name, messageId,
      resumed: false, runId: args.runId, waiting: !online }
  },
})

export const controlRemoteAgentTurnByServer = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), conversationId: v.string(), workspaceId: v.string(), runId: v.string(), action: v.union(v.literal('cancel'), v.literal('retry'), v.literal('resume'), v.literal('start_fresh')), controlRequestId: v.optional(v.string()), queueExpiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_externalRunId', (q) => q.eq('externalRunId', args.runId))
      .unique()
    if (
      !run ||
      run.conversationId !== args.conversationId ||
      run.runner !== 'remote'
    )
      return { applied: false, reason: 'missing' }
    const actor = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId),
      )
      .unique()
    const membership = actor
      ? await ctx.db
          .query('workspaceMemberships')
          .withIndex('by_workspaceId_principalId', (q) =>
            q
              .eq('workspaceId', args.workspaceId)
              .eq('principalId', actor.principalId),
          )
          .unique()
      : null
    const participant = actor
      ? await ctx.db
          .query('conversationParticipants')
          .withIndex('by_conversationId_principalId', (q) =>
            q
              .eq('conversationId', run.conversationId)
              .eq('principalId', actor.principalId),
          )
          .unique()
      : null
    if (
      !actor ||
      actor.type !== 'human' ||
      actor.archivedAt ||
      membership?.status !== 'active' ||
      participant?.status !== 'active'
    )
      return { applied: false, reason: 'forbidden' }
    const session = await currentRemoteAttempt(ctx, args.runId)
    if (!session || session.workspaceId !== args.workspaceId)
      return { applied: false, reason: 'missing' }
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', session.environmentId),
      )
      .unique()
    if (!environment) return { applied: false, reason: 'missing' }
    const commands = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) =>
        q.eq('environmentId', session.environmentId),
      )
      .filter((q) => q.eq(q.field('runId'), args.runId))
      .take(100)
    if (run.remoteLifecycle) {
      const state = run.remoteLifecycle as RemoteRunState
      const operationId = args.controlRequestId ?? `${args.runId}:${state.currentAttemptId}:${args.action}`
      const intentId = `control:${operationId}`
      const existing = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', intentId)).unique()
      if (existing) {
        if (existing.runId !== args.runId || existing.action !== args.action) return { applied: false, reason: 'conflicting_state' }
        return { applied: true, operationId, phase: state.phase, messageId: run.assistantMessageId }
      }
      if (args.action !== 'cancel' && state.phase === 'recovering') {
        const prior = await ctx.db.query('agentRemoteRunIntents').withIndex('by_runId', q => q.eq('runId', args.runId)).take(100)
        const operation = prior.find(intent => intent.kind === 'control' && intent.action === args.action)
        if (operation) return { applied: true, operationId: operation.operationId, phase: state.phase, messageId: run.assistantMessageId }
      }
      if (['completed', 'cancelled', 'failed'].includes(state.phase)) return { applied: false, reason: 'conflicting_state' }
      if (args.action !== 'cancel' && args.now >= state.hardDeadlineAt) return { applied: false, reason: 'expired_deadline' }
      if (args.action !== 'cancel' && state.phase === 'cancelling') return { applied: false, reason: 'conflicting_state' }
      if (args.action === 'start_fresh') {
        // BYO adapters cannot reattach to a dead process: the only continuation is a
        // brand-new attempt on a fresh execution generation. The old attempt's
        // approval context is discarded; the new process asks again if it needs to.
        if (state.phase !== 'needs_attention') return { applied: false, reason: 'unsupported_recovery' }
        const newAttemptId = `agent_session_${crypto.randomUUID()}`
        const nextGeneration = state.executionGeneration + 1
        const snapshot = session.capabilitySnapshot as Record<string, unknown>
        // The checkpoint contains nonsecret references, not an executable start.
        // Reuse the original validated command; its prompt/config remain canonical.
        const originalStart = commands.find(command => command.type === 'start'
          && command.payload && typeof command.payload.prompt === 'string')
        if (!originalStart) return { applied: false, reason: 'unsupported_recovery' }
        const startPayload = originalStart.payload
        const { attemptId: _oldAttemptId, executionGeneration: _oldGen, ...snapshotRest } = snapshot as Record<string, unknown> & { attemptId?: string, executionGeneration?: number }
        const { _id: oldSessionDocId, _creationTime: _oldCreationTime, ...sessionRest } = session
        void _oldCreationTime
        const now = args.now
        const latestFresh = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
        await ctx.db.insert('agentRemoteSessions', {
          ...sessionRest,
          attemptId: newAttemptId,
          executionGeneration: nextGeneration,
          sessionId: newAttemptId,
          status: 'queued',
          commandCursor: 0,
          eventCursor: 0,
          remoteSessionId: undefined,
          hostBootId: undefined,
          lastHealthAt: undefined,
          executionLeaseExpiresAt: undefined,
          capabilitySnapshot: snapshotRest,
          createdAt: now,
          updatedAt: now,
        } as never)
        await ctx.db.patch(session._id, { status: 'failed', endedAt: now, updatedAt: now })
        const nextState: RemoteRunState = {
          ...state,
          revision: state.revision + 1,
          phase: 'recovering',
          cause: 'fresh_attempt',
          currentAttemptId: newAttemptId,
          executionGeneration: nextGeneration,
          recoveryOutcome: 'requires_new_attempt',
        }
        delete nextState.approval
        delete nextState.approvals
        delete nextState.cancelRequestedAt
        delete nextState.lastHealthAt
        delete nextState.lastPreparationAt
        delete nextState.providerStop
        await ctx.db.patch(run._id, { remoteLifecycle: nextState, status: remoteRunCoarseStatus(nextState.phase), updatedAt: now })
        // A replacement cannot leave an executable card from the old process ahead
        // of its new requests. Preserve answered decisions and close only old waits.
        const oldRequests = await ctx.db.query('agentApprovalRequests')
          .withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId)).take(100)
        for (const request of oldRequests) if (!request.resolution) await ctx.db.patch(request._id, {
          resolution: { decision: 'execution_replaced', resolvedByPrincipalId: actor.principalId, resolvedAt: now },
        })
        const message = await ctx.db.get(run.assistantMessageId)
        if (message) {
          const parts = reconcileRemoteRequestParts(message.parts ?? [], { ...state, phase: 'cancelling', cause: 'execution_replaced' }, now)
            .map(part => part.type === 'data-remote-agent-status'
              ? { ...part, data: { ...(part.data as Record<string, unknown>), state: 'recovering', hardDeadlineAt: state.hardDeadlineAt,
                recoveryOutcome: nextState.recoveryOutcome } } : part)
          if (!parts.some(part => part.type === 'data-remote-agent-status')) parts.push({ type: 'data-remote-agent-status',
            data: { environmentName: environment.name, runId: args.runId, queueExpiresAt: state.claimDeadlineAt, hardDeadlineAt: state.hardDeadlineAt, state: 'recovering' } })
          await ctx.db.patch(message._id, { parts: conversationParts(parts), status: 'generating', updatedAt: now })
        }
        await ctx.db.insert('agentRemoteRunIntents', { intentId: `control:${operationId}`, runId: args.runId, kind: 'control', action: args.action,
          operationId, revision: nextState.revision, status: 'pending', createdAt: now, updatedAt: now })
        await ctx.db.insert('agentRunCommands', {
          commandId: `command:${operationId}`, workspaceId: args.workspaceId, environmentId: session.environmentId,
          runId: args.runId, attemptId: newAttemptId, executionGeneration: nextGeneration,
          type: 'start', sequence: (latestFresh?.sequence ?? 0) + 1,
          payload: recoveryStartPayload(startPayload, message ? (await hydrateRemoteMessage(ctx, message)).content.length : 0),
          status: 'pending', createdAt: now, updatedAt: now })
        return { applied: true, operationId, phase: nextState.phase, commandId: `command:${operationId}`, messageId: run.assistantMessageId }
      }
      const result = await applyRemoteFact(ctx, run, args.action === 'cancel'
        ? { type: 'cancel', cause: 'user_cancelled' } : { type: 'recovery_requested' }, args.now)
      const next = result?.state ?? state
      await ctx.db.insert('agentRemoteRunIntents', { intentId, runId: args.runId, kind: 'control', action: args.action,
        operationId, revision: next.revision, status: 'pending', createdAt: args.now, updatedAt: args.now })
      const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
      const commandId = args.action === 'cancel' ? `stop:${args.runId}:${state.currentAttemptId}` : `command:${operationId}`
      const existingCommand = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', commandId)).unique()
      if (!existingCommand) await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId, environmentId: session.environmentId,
        runId: args.runId, attemptId: state.currentAttemptId, executionGeneration: state.executionGeneration,
        type: args.action === 'cancel' ? 'cancel' : session.remoteSessionId ? 'reconnect' : 'observe',
        sequence: (latest?.sequence ?? 0) + 1, payload: args.action === 'cancel' ? { reason: 'Cancelled from Overlay' }
          : session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}, status: 'pending', createdAt: args.now, updatedAt: args.now })
      await ctx.db.patch(session._id, { status: next.phase, updatedAt: args.now })
      const message = await ctx.db.get(run.assistantMessageId)
      await ctx.db.patch(run.assistantMessageId, { parts: conversationParts([
        ...(message?.parts ?? []).filter(part => part.type !== 'data-remote-agent-status'),
        { type: 'data-remote-agent-status', data: { environmentName: environment.name, runId: args.runId,
          queueExpiresAt: state.claimDeadlineAt, hardDeadlineAt: state.hardDeadlineAt, state: next.phase } },
      ]), status: 'generating', updatedAt: args.now })
      return { applied: true, operationId, phase: next.phase, commandId, messageId: run.assistantMessageId }
    }
    const snapshotBeforeControl = session.capabilitySnapshot as Record<string, unknown>
    if (args.action !== 'cancel' && typeof snapshotBeforeControl.hardExpiresAt === 'number' && snapshotBeforeControl.hardExpiresAt <= args.now)
      return { applied: false, reason: 'expired_deadline' }
    if (args.action !== 'cancel' && session.status === 'recovering') {
      const recovery = commands.find((command) => command.type === 'reconnect' || command.type === 'start')
      return { applied: true, commandId: recovery?.commandId, messageId: run.assistantMessageId }
    }
    if (args.action === 'cancel') {
      if (run.status === 'cancelled') return { applied: true, messageId: run.assistantMessageId }
      if (run.status === 'completed') return { applied: false, reason: 'conflicting_state' }
      let cancelCommand = commands.find(
        (command) =>
          command.type === 'cancel' &&
          (command.status === 'pending' || command.status === 'claimed'),
      )
      if (!cancelCommand) {
        const latest = await ctx.db
          .query('agentRunCommands')
          .withIndex('by_environmentId_sequence', (q) =>
            q.eq('environmentId', session.environmentId),
          )
          .order('desc')
          .first()
        const commandId = `command_${crypto.randomUUID()}`
        await ctx.db.insert('agentRunCommands', {
          commandId,
          workspaceId: args.workspaceId,
          environmentId: session.environmentId,
          runId: args.runId,
          type: 'cancel',
          sequence: (latest?.sequence ?? 0) + 1,
          payload: { reason: 'Cancelled from Overlay' },
          status: 'pending',
          createdAt: args.now,
          updatedAt: args.now,
        })
        cancelCommand = { commandId } as (typeof commands)[number]
      }
      await ctx.db.patch(run._id, { status: 'cancelled', cancelledAt: args.now, updatedAt: args.now })
      await ctx.db.patch(session._id, { status: 'cancelled', endedAt: args.now, updatedAt: args.now })
      // The run's other commands are left as they are. A host numbers its commands and rejects every later one when a
      // number is missing, so a command that was never delivered must not be cancelled: once the run is over, delivery
      // sends it as a harmless shutdown instead (see `claimCommandsByServer`).
      const pendingRequests = await ctx.db.query('agentApprovalRequests')
        .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', args.workspaceId).eq('runId', args.runId)).take(100)
      await Promise.all(pendingRequests.filter((request) => !request.resolution).map((request) =>
        ctx.db.patch(request._id, { resolution: {
          decision: 'cancelled', resolvedByPrincipalId: actor.principalId, resolvedAt: args.now,
        } })))
      const stored = await ctx.db.get(run.assistantMessageId)
      if (!stored) throw new Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
      const message = await hydrateRemoteMessage(ctx, stored)
      const stopped = projectRemoteAgentEvents({ content: message.content, parts: message.parts ?? [],
        environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId,
        events: [{ protocolVersion: 1, eventId: `cancel:${args.runId}`, environmentId: environment.environmentId,
          runId: args.runId, sourceSequence: session.eventCursor, occurredAt: args.now, type: 'cancelled', payload: {} }] })
      const stoppedFields = stored.remoteTextStored
        ? await prepareRemoteMessageText(ctx, stored, { content: stopped.content, parts: conversationParts(stopped.parts) })
        : { content: stopped.content, parts: conversationParts(stopped.parts) }
      const { content, parts } = stoppedFields
      await ctx.db.patch(message._id, { content, parts,
        ...('remoteTextStored' in stoppedFields ? { remoteTextStored: stoppedFields.remoteTextStored } : {}),
        status: 'completed', updatedAt: args.now })
      await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
        messageId: run.assistantMessageId, type: 'message.completed', userId: run.userId, createdAt: args.now })
      return { applied: true, commandId: cancelCommand.commandId, messageId: run.assistantMessageId,
        terminal: terminalBilling(session.capabilitySnapshot, { input: 0, output: 0 }, 'cancelled') }
    }
    if (args.action === 'retry' && run.status === 'queued') {
      await ctx.db.patch(run._id, { leaseExpiresAt: args.queueExpiresAt, updatedAt: args.now })
      await Promise.all(commands.filter((command) => command.status !== 'acknowledged').map((command) =>
        ctx.db.patch(command._id, { status: 'pending', claimedAt: undefined, claimExpiresAt: undefined, updatedAt: args.now })))
      await ctx.db.patch(session._id, { capabilitySnapshot: { ...session.capabilitySnapshot, queueExpiresAt: args.queueExpiresAt }, updatedAt: args.now })
      await ctx.db.patch(run.assistantMessageId, { content: `Waiting for ${environment.name}`,
        parts: conversationParts(waitingRemoteAgentParts({ environmentName: environment.name, queueExpiresAt: args.queueExpiresAt, runId: args.runId })),
        status: 'generating', updatedAt: args.now })
      await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
        messageId: run.assistantMessageId, type: 'message.delta', userId: run.userId, createdAt: args.now })
      return { applied: true, messageId: run.assistantMessageId }
    }
    if (!['failed'].includes(run.status))
      return { applied: false, reason: 'conflicting_state' }
    const snapshot =
      session.capabilitySnapshot &&
      typeof session.capabilitySnapshot === 'object'
        ? (session.capabilitySnapshot as Record<string, unknown>)
        : {}
    const startPayload =
      snapshot.startPayload && typeof snapshot.startPayload === 'object'
        ? (snapshot.startPayload as Record<string, unknown>)
        : null
    const mode =
      args.action === 'start_fresh'
        ? 'start_fresh'
        : args.action === 'resume'
          ? 'resume'
          : session.remoteSessionId
            ? 'resume'
            : 'start_fresh'
    if (
      (mode === 'resume' && !session.remoteSessionId) ||
      (mode === 'start_fresh' && !startPayload)
    )
      return { applied: false, reason: 'unsupported_recovery' }
    const latest = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) =>
        q.eq('environmentId', session.environmentId),
      )
      .order('desc')
      .first()
    const commandId = `command_${crypto.randomUUID()}`
    const existingMessage = await ctx.db.get(run.assistantMessageId)
    const textOffset = mode === 'start_fresh' && existingMessage ? (await hydrateRemoteMessage(ctx, existingMessage)).content.length : 0
    await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId,
      environmentId: session.environmentId, runId: args.runId, type: mode === 'resume' ? 'reconnect' : 'start',
      sequence: (latest?.sequence ?? 0) + 1,
      payload: mode === 'resume' ? { remoteSessionId: session.remoteSessionId }
        : recoveryStartPayload({ ...startPayload, sessionId: undefined }, textOffset),
      status: 'pending', createdAt: args.now, updatedAt: args.now })
    await ctx.db.patch(run._id, { status: 'queued', leaseExpiresAt: args.queueExpiresAt,
      failedAt: undefined, cancelledAt: undefined, terminalError: undefined,
      metrics: { ...(run.metrics ?? {}), workflowRetryCount: (run.metrics?.workflowRetryCount ?? 0) + 1 }, updatedAt: args.now })
    await ctx.db.patch(session._id, { status: 'recovering', endedAt: undefined,
      capabilitySnapshot: { ...snapshot, queueExpiresAt: args.queueExpiresAt }, updatedAt: args.now })
    const parts = (existingMessage?.parts ?? []).filter((part) => part.type !== 'data-remote-agent-status')
    await ctx.db.patch(run.assistantMessageId, { parts: conversationParts([...parts, {
      type: 'data-remote-agent-status', data: { environmentName: environment.name,
        queueExpiresAt: args.queueExpiresAt, runId: args.runId, state: 'recovering' },
    }]), status: 'generating', updatedAt: args.now })
    await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
      messageId: run.assistantMessageId, type: 'message.delta', userId: run.userId, createdAt: args.now })
    return { applied: true, commandId, messageId: run.assistantMessageId }
  },
})

export const createRemoteSessionByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(), bindingId: v.string(), runId: v.string(), remoteSessionId: v.optional(v.string()), status: v.string(), commandCursor: v.number(), eventCursor: v.number(), capabilitySnapshot: anyObject, startedAt: v.optional(v.number()), endedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    )
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_bindingId', (q) => q.eq('bindingId', args.bindingId))
      .unique()
    if (
      !binding ||
      binding.workspaceId !== args.workspaceId ||
      binding.environmentId !== args.environmentId ||
      !binding.enabled
    )
      throw new Error('AGENT_BINDING_UNAVAILABLE')
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
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    )
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    if (
      !args.type ||
      args.type.length > 64 ||
      jsonByteLength(args.payload) > MAX_COMMAND_BYTES
    ) {
      throw new Error('AGENT_COMMAND_TOO_LARGE')
    }
    const latest = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .order('desc')
      .first()
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, commandId: id, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRunCommands', row)
    return { ...row, id }
  },
})

/** What the host said when it rejected a command, made safe to show: one short line of plain text. */
function rejectionDetail(code: string | undefined, message: string | undefined): string {
  const text = [code, message].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return text ? ` (${text})` : ''
}

export const acknowledgeCommandByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), commandId: v.string(), accepted: v.optional(v.boolean()), now: v.number(),
    /** Why the host rejected the command, when it said. Host-supplied, so it is trimmed before it is shown. */
    errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const command = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_commandId', (q) => q.eq('commandId', args.commandId))
      .unique()
    if (
      !command ||
      command.workspaceId !== args.workspaceId ||
      command.environmentId !== args.environmentId ||
      command.status === 'cancelled'
    )
      return false
    if (args.accepted === false) {
      if (command.status === 'acknowledged') return false
      // A sequence-gap rejection says the host never saw an earlier command; it is not a verdict
      // on this command. Cancelling here would chain the missing row into a second hole, so the
      // command stays claimable and re-delivers once its lease expires (or the host resyncs).
      if (args.errorCode !== 'command_sequence_gap')
        await ctx.db.patch(command._id, {
          status: 'cancelled', claimExpiresAt: undefined, updatedAt: args.now,
        })
      const run = await ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_externalRunId', (q) =>
          q.eq('externalRunId', command.runId),
        )
        .unique()
      const session = await currentRemoteAttempt(ctx, command.runId)
      const message = run ? await ctx.db.get(run.assistantMessageId) : null
      const environment = session
        ? await ctx.db
            .query('agentEnvironments')
            .withIndex('by_environmentId', (q) =>
              q.eq('environmentId', session.environmentId),
            )
            .unique()
        : null
      if (run?.remoteLifecycle && session) {
        if (args.errorCode === 'command_sequence_gap') return true
        if (args.errorCode === 'native_preparation_retryable' && await retryNativePreparation(ctx, run, session, command, args.now)) return true
        await applyRemoteFact(ctx, run, { type: 'health', process: 'unknown' }, args.now)
        await ctx.db.patch(session._id, { recoveryCause: 'command_rejected', recoveryResult: 'unavailable', updatedAt: args.now })
        return true
      }
      if (run && session && message && !['completed', 'failed', 'cancelled'].includes(run.status)) {
        const code = 'remote_command_rejected'
        const failureMessage = `The connected environment rejected this command${rejectionDetail(args.errorCode, args.errorMessage)}. Reconnect it, then retry this message.`
        await ctx.db.patch(run._id, { status: 'failed', failedAt: args.now,
          terminalError: { code, message: failureMessage, retryable: true }, updatedAt: args.now })
        await ctx.db.patch(session._id, { status: 'failed', endedAt: args.now, updatedAt: args.now })
        await ctx.db.patch(message._id, { content: failureMessage,
          parts: conversationParts(recoveryParts(message.parts, command.runId,
            environment?.name ?? 'connected environment', code, failureMessage, args.now)),
          status: 'error', updatedAt: args.now })
        await ctx.db.insert('conversationEvents', { conversationId: run.conversationId,
          workspaceId: args.workspaceId, messageId: message._id, type: 'message.failed',
          userId: run.userId, createdAt: args.now })
      }
      return true
    }
    if (command.status !== 'acknowledged') {
      await ctx.db.patch(command._id, {
        status: 'acknowledged', acknowledgedAt: args.now, claimExpiresAt: undefined, updatedAt: args.now,
      })
    }
    const session = await currentRemoteAttempt(ctx, command.runId)
    if (
      session &&
      session.workspaceId === args.workspaceId &&
      session.environmentId === args.environmentId
    ) {
      await ctx.db.patch(session._id, {
        commandCursor: Math.max(session.commandCursor, command.sequence),
        updatedAt: args.now,
      })
    }
    if (command.type === 'approval_response' || command.type === 'elicitation_response') {
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', command.runId)).unique()
      if (run?.remoteLifecycle && command.attemptId === run.remoteLifecycle.currentAttemptId) {
        const result = await applyRemoteFact(ctx, run, { type: 'decision_delivered', requestKey: String(command.payload.requestKey) }, args.now)
        if (result?.applied) {
          const message = await ctx.db.get(run.assistantMessageId)
          const parts = (message?.parts ?? []).map(part => {
            const data = 'data' in part ? part.data as Record<string, unknown> : undefined
            if (part.type === 'data-remote-agent-request' && data?.requestKey === command.payload.requestKey)
              return { ...part, data: { ...data, state: 'resolved' } }
            if (part.type === 'data-remote-agent-status') return { ...part, data: { ...data, state: result.state.phase } }
            return part
          })
          await ctx.db.patch(run.assistantMessageId, { parts: conversationParts(parts), updatedAt: args.now })
          if (session) await ctx.db.patch(session._id, { status: result.state.phase, updatedAt: args.now })
        }
      }
    }
    return true
  },
})

export const getRemoteSessionForRunByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await currentRemoteAttempt(ctx, args.runId)
    if (
      !session ||
      session.workspaceId !== args.workspaceId ||
      session.environmentId !== args.environmentId
    )
      return null
    const billingUserId = session.capabilitySnapshot?.billing?.userId
    const policyEntitlements = typeof billingUserId === 'string' && billingUserId
      ? await connectedAgentPolicyProjection(ctx, {workspaceId: args.workspaceId, userId: billingUserId}) : undefined
    return { ...clean(session), id: session.sessionId,
      ...(policyEntitlements === undefined ? {} : {policyEntitlements}) }
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
    const session = await ctx.db
      .query('agentRemoteSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.remoteSessionId))
      .unique()
    if (
      !session ||
      session.workspaceId !== args.workspaceId ||
      session.runId !== args.runId
    )
      throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const existing = await ctx.db
      .query('agentApprovalRequests')
      .withIndex('by_remoteSessionId_requestKey', (q) =>
        q
          .eq('remoteSessionId', args.remoteSessionId)
          .eq('requestKey', args.requestKey),
      )
      .unique()
    if (existing) return { ...clean(existing), id: existing.approvalId }
    const { serverSecret, id, ...value } = args
    void serverSecret
    const row = { ...value, approvalId: id }
    await ctx.db.insert('agentApprovalRequests', row)
    return { ...row, id }
  },
})

/**
 * An Overlay tool a connected agent called over MCP needs the person's approval. Shows the same
 * approval card an agent's own permission request does, but the answer goes back to the waiting
 * MCP call (it reads this row). A journal-bound elicitation bridge also answers the host's signed form.
 * Safe to call repeatedly for one
 * `requestKey`: it reports the current state, and a resolved request stays resolved.
 */
/** Marks an approval request that belongs to an Overlay MCP tool call, not to the host's agent. */
const MCP_APPROVAL_SOURCE = 'overlay_mcp'

export const requestMcpApprovalByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string(),
    sessionId: v.optional(v.string()), expiresAt: v.optional(v.number()),
    bridge: v.optional(v.boolean()),
    execution: v.optional(v.object({ attemptId: v.string(), generation: v.number() })),
    requestKey: v.string(), prompt: v.string(), now: v.number(),
  },
  returns: v.object({
    state: v.union(v.literal('pending'), v.literal('resolved'), v.literal('unavailable')),
    decision: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await currentRemoteAttempt(ctx, args.runId)
    if (!session || !agentMcpAttemptMatches(args, { ...session, id: session.sessionId })) return { state: 'unavailable' as const }
    let authorityExpiresAt = args.expiresAt
    if (args.bridge) {
      const callId = args.requestKey.startsWith('mcp_call:') ? args.requestKey.slice('mcp_call:'.length) : ''
      const call = callId ? await ctx.db.query('agentMcpCalls').withIndex('by_callId', q => q.eq('callId', callId)).unique() : null
      if (!call || call.requestKey !== args.requestKey || call.workspaceId !== args.workspaceId || call.runId !== args.runId
        || call.environmentId !== args.environmentId || call.sessionId !== session.sessionId || call.expiresAt <= args.now
        || call.execution?.attemptId !== args.execution?.attemptId || call.execution?.generation !== args.execution?.generation) return { state: 'unavailable' as const }
      authorityExpiresAt = Math.min(authorityExpiresAt ?? call.expiresAt, call.expiresAt)
    }
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', (q) => q.eq('externalRunId', args.runId)).unique()
    const existing = await ctx.db.query('agentApprovalRequests')
      .withIndex('by_remoteSessionId_requestKey', (q) => q.eq('remoteSessionId', session.sessionId).eq('requestKey', args.requestKey)).unique()
    // A request keeps reporting its answer after the run ends (the run's end closes it), so a call still waiting is told.
    if (existing) {
      if (!existing.resolution && typeof existing.payload?.expiresAt === 'number' && existing.payload.expiresAt <= args.now) return { state: 'unavailable' as const }
      if (existing.resolution && run?.remoteLifecycle && existing.payload?.bridge !== true) await applyRemoteFact(ctx, run, { type: 'decision_delivered', requestKey: args.requestKey }, args.now)
      return existing.resolution
        ? { state: 'resolved' as const, decision: existing.resolution.decision }
        : { state: 'pending' as const }
    }
    if (!agentMcpSessionIsLive(args, { ...session, id: session.sessionId }, args.now)) return { state: 'unavailable' as const }
    const message = run?.assistantMessageId ? await ctx.db.get(run.assistantMessageId) : null
    if (!run || !message) return { state: 'unavailable' as const }
    if (run.remoteLifecycle && !['running', 'waiting_for_approval', 'waiting_for_input'].includes(run.remoteLifecycle.phase)) return { state: 'unavailable' as const }
    const expiresAt = Math.min(args.now + 60 * 60_000, run.remoteLifecycle?.hardDeadlineAt ?? Infinity, authorityExpiresAt ?? Infinity)
    if (expiresAt <= args.now) return { state: 'unavailable' as const }
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    const requestContext = { expiresAt, machineCostContinues: environment?.kind === 'overlay_cloud' }
    const options = [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }]
    await ctx.db.insert('agentApprovalRequests', {
      approvalId: `approval_${crypto.randomUUID()}`, workspaceId: args.workspaceId, runId: args.runId,
      remoteSessionId: session.sessionId, requestKey: args.requestKey, kind: 'permission', prompt: args.prompt,
      options: options.map((option) => option.id),
      payload: { source: MCP_APPROVAL_SOURCE, ...(args.bridge ? { bridge: true } : {}), requestKey: args.requestKey, prompt: args.prompt, options, ...requestContext },
      requestedAt: args.now,
    })
    const snapshot = session.capabilitySnapshot && typeof session.capabilitySnapshot === 'object'
      ? (session.capabilitySnapshot as Record<string, unknown>) : {}
    const projection = projectRemoteAgentEvents({
      content: message.content,
      parts: Array.isArray(message.parts) ? (message.parts as unknown as Array<Record<string, unknown>>) : [],
      events: [{
        protocolVersion: 1, eventId: `mcp-approval:${args.requestKey}`, environmentId: args.environmentId, runId: args.runId,
        sourceSequence: session.eventCursor, type: 'approval_requested', occurredAt: args.now,
        payload: { requestKey: args.requestKey, prompt: args.prompt, options, context: requestContext },
      } as AgentRemoteEvent],
      environmentName: typeof snapshot.environmentName === 'string' ? snapshot.environmentName : 'connected environment',
      queueExpiresAt: typeof snapshot.queueExpiresAt === 'number' ? snapshot.queueExpiresAt : args.now,
      runId: args.runId,
    })
    await ctx.db.patch(message._id, { parts: conversationParts(projection.parts), status: 'generating', updatedAt: args.now })
    if (run.remoteLifecycle) await applyRemoteFact(ctx, run, { type: 'request', requestKey: args.requestKey,
      kind: 'permission', expiresAt }, args.now)
    else await ctx.db.patch(run._id, { status: 'waiting_for_approval', updatedAt: args.now })
    await ctx.db.patch(session._id, { status: 'waiting_for_approval', updatedAt: args.now })
    await ctx.db.insert('conversationEvents', {
      conversationId: run.conversationId, workspaceId: args.workspaceId, messageId: message._id,
      type: 'message.delta', userId: run.userId, createdAt: args.now,
    })
    return { state: 'pending' as const }
  },
})

export const resolveApprovalRequestByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), approvalId: v.string(),
    resolution: v.object({ decision: v.string(), response: v.optional(v.any()), resolvedByPrincipalId: v.string(), resolvedAt: v.number() }),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db
      .query('agentApprovalRequests')
      .withIndex('by_approvalId', (q) => q.eq('approvalId', args.approvalId))
      .unique()
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
    const run = await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_externalRunId', (q) => q.eq('externalRunId', args.runId))
      .unique()
    if (
      !run ||
      run.conversationId !== args.conversationId ||
      !['waiting_for_approval', 'running'].includes(run.status)
    )
      return { applied: false }
    const actor = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId),
      )
      .unique()
    const [membership, participant] = actor
      ? await Promise.all([
          ctx.db
            .query('workspaceMemberships')
            .withIndex('by_workspaceId_principalId', (q) =>
              q
                .eq('workspaceId', args.workspaceId)
                .eq('principalId', actor.principalId),
            )
            .unique(),
          ctx.db
            .query('conversationParticipants')
            .withIndex('by_conversationId_principalId', (q) =>
              q
                .eq('conversationId', run.conversationId)
                .eq('principalId', actor.principalId),
            )
            .unique(),
        ])
      : [null, null]
    if (
      !actor ||
      actor.type !== 'human' ||
      actor.archivedAt ||
      membership?.status !== 'active' ||
      participant?.status !== 'active'
    )
      return { applied: false }
    const requests = await ctx.db
      .query('agentApprovalRequests')
      .withIndex('by_workspaceId_runId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('runId', args.runId),
      )
      .take(100)
    const request = requests.find((row) => row.requestKey === args.requestKey)
    if (!request) return { applied: false }
    const [session, message] = await Promise.all([
      ctx.db
        .query('agentRemoteSessions')
        .withIndex('by_sessionId', (q) =>
          q.eq('sessionId', request.remoteSessionId),
        )
        .unique(),
      run.assistantMessageId
        ? ctx.db.get(run.assistantMessageId)
        : Promise.resolve(null),
    ])
    if (run.remoteLifecycle && session?.sessionId !== run.remoteLifecycle.currentAttemptId) return { applied: false }
    if (!session || !message || session.runId !== args.runId)
      return { applied: false }
    if (request.resolution) {
      if (request.resolution.decision !== args.decision
        || !sameJson(request.resolution.response ?? null, args.response ?? null)) {
        throw new Error('AGENT_REMOTE_REQUEST_ALREADY_RESOLVED')
      }
      const commands = await ctx.db
        .query('agentRunCommands')
        .withIndex('by_environmentId_sequence', (q) =>
          q.eq('environmentId', session.environmentId),
        )
        .filter((q) => q.eq(q.field('runId'), args.runId))
        .take(100)
      const existing = commands.find(
        (command) =>
          (command.payload as Record<string, unknown>).requestKey ===
          args.requestKey,
      )
      return {
        applied: true,
        commandId: existing?.commandId,
        messageId: run.assistantMessageId,
      }
    }
    const expiresAt = request.payload?.expiresAt
    if (typeof expiresAt === 'number' && expiresAt <= args.now) return { applied: false }
    const kind = request.kind === 'elicitation' ? 'elicitation' : 'permission'
    if (kind === 'permission' && !request.options.includes(args.decision)) throw new Error('AGENT_APPROVAL_OPTION_INVALID')
    if (kind === 'elicitation' && !['accept', 'decline', 'cancel'].includes(args.decision)) throw new Error('AGENT_ELICITATION_ACTION_INVALID')
    if (kind === 'elicitation' && args.decision === 'accept') assertValidElicitationResponse(request.payload, args.response)
    const resolution = { decision: args.decision, ...(args.response ? { response: args.response } : {}),
      resolvedByPrincipalId: actor.principalId, resolvedAt: args.now }
    if (run.remoteLifecycle) {
      const applied = await applyRemoteFact(ctx, run, { type: 'decision', requestKey: args.requestKey, decision: args.decision }, args.now)
      if (!applied?.applied) return { applied: false }
    }
    await ctx.db.patch(request._id, { resolution })
    const mcpRequest = (request.payload as { source?: unknown; bridge?: unknown } | undefined)
    const mcpBridge = mcpRequest?.source === MCP_APPROVAL_SOURCE && mcpRequest.bridge === true
    if (mcpRequest?.source === MCP_APPROVAL_SOURCE && !mcpBridge) {
      // The waiting MCP call reads the resolution itself; the host has nothing to answer.
      if (!run.remoteLifecycle) {
        await ctx.db.patch(run._id, { status: 'running', approval: undefined, updatedAt: args.now })
        await ctx.db.patch(session._id, { status: 'running', updatedAt: args.now })
      }
      await ctx.db.patch(message._id, {
        parts: conversationParts(resolveRemoteRequestPart(
          Array.isArray(message.parts) ? (message.parts as unknown as Array<Record<string, unknown>>) : [],
          args.requestKey, resolution, Boolean(run.remoteLifecycle),
        )),
        status: 'generating', updatedAt: args.now,
      })
      await ctx.db.insert('conversationEvents', {
        conversationId: run.conversationId, workspaceId: args.workspaceId, messageId: message._id,
        type: 'message.delta', userId: run.userId, createdAt: args.now,
      })
      return { applied: true, messageId: message._id }
    }
    const latest = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) =>
        q.eq('environmentId', session.environmentId),
      )
      .order('desc')
      .first()
    const commandId = `command_${crypto.randomUUID()}`
    await ctx.db.insert('agentRunCommands', { commandId, workspaceId: args.workspaceId,
      environmentId: session.environmentId, runId: args.runId,
      ...(run.remoteLifecycle ? { attemptId: run.remoteLifecycle.currentAttemptId, executionGeneration: run.remoteLifecycle.executionGeneration } : {}),
      type: mcpBridge ? 'elicitation_response' : kind === 'permission' ? 'approval_response' : 'elicitation_response',
      sequence: (latest?.sequence ?? 0) + 1,
      payload: mcpBridge ? { requestKey: args.requestKey, action: args.decision === 'allow' ? 'accept' : 'decline',
        ...(args.decision === 'allow' ? { content: { confirm: true } } : {}) }
        : kind === 'permission' ? { requestKey: args.requestKey, optionId: args.decision }
        : { requestKey: args.requestKey, action: args.decision, ...(args.response ? { content: args.response } : {}) },
      status: 'pending', createdAt: args.now, updatedAt: args.now })
    if (!run.remoteLifecycle) {
      await ctx.db.patch(run._id, { status: 'running', approval: undefined, updatedAt: args.now })
      await ctx.db.patch(session._id, { status: 'running', updatedAt: args.now })
    }
    await ctx.db.patch(message._id, {
      parts: conversationParts(
        resolveRemoteRequestPart(
          Array.isArray(message.parts)
            ? (message.parts as unknown as Array<Record<string, unknown>>)
            : [],
          args.requestKey,
          resolution,
          Boolean(run.remoteLifecycle),
        ),
      ),
      status: 'generating',
      updatedAt: args.now,
    })
    await ctx.db.insert('conversationEvents', {
      conversationId: run.conversationId,
      workspaceId: args.workspaceId,
      messageId: message._id,
      type: 'message.delta',
      userId: run.userId,
      createdAt: args.now,
    })
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
    const session = await ctx.db
      .query('agentRemoteSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.remoteSessionId))
      .unique()
    if (
      !session ||
      session.workspaceId !== args.workspaceId ||
      session.environmentId !== args.environmentId ||
      session.runId !== args.runId
    )
      throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const usage = await artifactPolicyUsage(
      ctx,
      args.workspaceId,
      args.updatedAt,
    )
    if (
      args.maxWorkspaceArtifactBytes !== undefined &&
      usage.activeArtifactBytes + args.size > args.maxWorkspaceArtifactBytes
    ) {
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
    const row = await ctx.db
      .query('agentArtifacts')
      .withIndex('by_artifactId', (q) => q.eq('artifactId', args.artifactId))
      .unique()
    if (
      !row ||
      row.workspaceId !== args.workspaceId ||
      row.environmentId !== args.environmentId
    )
      return null
    return { ...clean(row), id: row.artifactId }
  },
})

export const getArtifactForDownloadByServer = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const [row, actor] = await Promise.all([
      ctx.db
        .query('agentArtifacts')
        .withIndex('by_artifactId', (q) => q.eq('artifactId', args.artifactId))
        .unique(),
      ctx.db
        .query('workspacePrincipals')
        .withIndex('by_workspaceId_userId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId),
        )
        .unique(),
    ])
    if (
      !row ||
      row.workspaceId !== args.workspaceId ||
      !['clean', 'linked'].includes(row.status) ||
      row.deletedAt
    )
      return null
    const [run, membership] = await Promise.all([
      ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_externalRunId', (q) => q.eq('externalRunId', row.runId))
        .unique(),
      actor
        ? ctx.db
            .query('workspaceMemberships')
            .withIndex('by_workspaceId_principalId', (q) =>
              q
                .eq('workspaceId', args.workspaceId)
                .eq('principalId', actor.principalId),
            )
            .unique()
        : Promise.resolve(null),
    ])
    const participant =
      actor && run
        ? await ctx.db
            .query('conversationParticipants')
            .withIndex('by_conversationId_principalId', (q) =>
              q
                .eq('conversationId', run.conversationId)
                .eq('principalId', actor.principalId),
            )
            .unique()
        : null
    if (
      !run ||
      !actor ||
      actor.archivedAt ||
      actor.type !== 'human' ||
      membership?.status !== 'active' ||
      participant?.status !== 'active'
    )
      return null
    return { ...clean(row), id: row.artifactId }
  },
})

export const finalizeArtifactByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), artifactId: v.string(),
    status: v.union(v.literal('clean'), v.literal('rejected')), scanResult: v.string(), expiresAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('agentArtifacts')
      .withIndex('by_artifactId', (q) => q.eq('artifactId', args.artifactId))
      .unique()
    if (
      !row ||
      row.workspaceId !== args.workspaceId ||
      row.environmentId !== args.environmentId ||
      !['pending_upload', 'scanning'].includes(row.status)
    )
      return null
    const usage =
      args.status === 'rejected'
        ? await artifactPolicyUsage(ctx, row.workspaceId, args.now)
        : null
    await ctx.db.patch(row._id, {
      status: args.status,
      scanResult: args.scanResult,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
      updatedAt: args.now,
    })
    if (usage)
      await ctx.db.patch(usage._id, {
        activeArtifactBytes: Math.max(0, usage.activeArtifactBytes - row.size),
        updatedAt: args.now,
      })
    return {
      ...clean(row),
      id: row.artifactId,
      status: args.status,
      scanResult: args.scanResult,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
      updatedAt: args.now,
    }
  },
})

export const listArtifactsForCleanupByServer = query({
  args: { serverSecret: v.string(), now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('agentArtifacts')
      .withIndex('by_status_expiresAt')
      .collect()
    return rows
      .filter((row) => row.status !== 'deleted' && row.expiresAt <= args.now)
      .slice(0, args.limit)
      .map((row) => ({ ...clean(row), id: row.artifactId }))
  },
})

export const markArtifactDeletedByServer = mutation({
  args: { serverSecret: v.string(), artifactId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('agentArtifacts')
      .withIndex('by_artifactId', (q) => q.eq('artifactId', args.artifactId))
      .unique()
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
  args: { serverSecret: v.string(), now: v.number(), hostOfflineBefore: v.number(), limit: v.number(), abandonEnvironmentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const { serverSecret: _serverSecret, ...sweep } = args
    return sweepRemoteRuns(ctx, { ...sweep, settleBilling: false })
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
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
    return { deleted: rows.length }
  },
})

export const listPendingSandboxSettlementsByServer = query({
  args: { serverSecret: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)))
    const markers = await ctx.db
      .query('agentSandboxSettlements')
      .withIndex('by_status_updatedAt', (q) => q.eq('status', 'pending'))
      .take(limit)
    const settlements = (await Promise.all(markers.map(async (marker) => {
      const session = await currentRemoteAttempt(ctx, marker.runId)
      if (!session || !['completed', 'failed', 'cancelled'].includes(session.status)) return null
      const run = await ctx.db.query('conversationAgentRuns')
        .withIndex('by_externalRunId', q => q.eq('externalRunId', marker.runId)).unique()
      const message = run ? await ctx.db.get(run.assistantMessageId) : null
      return terminalBilling(
        session.capabilitySnapshot,
        message?.tokens,
        terminalOutcome(session.status),
      )
    }))).filter((settlement) => settlement !== null)
    return settlements
  },
})

export const markSandboxSettlementCompleteByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), reservationId: v.string(), settledAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const marker = await ctx.db
      .query('agentSandboxSettlements')
      .withIndex('by_reservationId', (q) =>
        q.eq('reservationId', args.reservationId),
      )
      .unique()
    if (!marker || marker.workspaceId !== args.workspaceId) return false
    if (marker.status === 'settled') return true
    await ctx.db.patch(marker._id, { status: 'settled', settledAt: args.settledAt, updatedAt: args.settledAt })
    return true
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
    const candidates = (await Promise.all(args.statuses.map((status) =>
      ctx.db.query('agentSandboxLeases')
        .withIndex('by_status_nextMeterAt', (q) => q.eq('status', status))
        .take(limit)))).flat()
      .filter((row) =>
        (row.nextMeterAt === undefined || row.nextMeterAt <= args.now)
        && (row.meterClaimUntil === undefined || row.meterClaimUntil <= args.now)
        && (row.cleanupAfter === undefined || row.cleanupAfter <= args.now))
      .sort((left, right) => (left.nextMeterAt ?? 0) - (right.nextMeterAt ?? 0) || left.updatedAt - right.updatedAt)
    const seen = new Set<string>()
    const claimed = candidates.filter((row) => {
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
    return claimed.map((row) => ({
      ...clean(row), id: row.leaseId, nextMeterAt: args.now + 2 * 60_000,
      meterClaimToken: args.claimToken, meterClaimUntil: args.claimUntil,
    }))
  },
})

export const finishSandboxLeaseClaimByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    claimToken: v.string(), now: v.number(), nextMeterAt: v.number(), cleanupAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentSandboxLeases')
      .withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.meterClaimToken !== args.claimToken) return false
    await ctx.db.patch(row._id, {
      nextMeterAt: args.nextMeterAt,
      meterClaimToken: undefined,
      meterClaimUntil: undefined,
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

export const claimComputerMaintenanceByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    kind: v.union(v.literal('provision'), v.literal('wake'), v.literal('stop'), v.literal('delete'), v.literal('idle')),
    token: v.string(), now: v.number(), expiresAt: v.number(), force: v.optional(v.boolean()),
    idleBefore: v.optional(v.number()), reconcileToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return null
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const current = lifecycle.maintenance as { token?: string; expiresAt?: number } | undefined
    if (current?.token && current.token !== args.token
      && ((current.expiresAt ?? Number.MAX_SAFE_INTEGER) > args.now || current.token !== args.reconcileToken)) return null
    if (args.kind === 'idle') {
      const computer = await ctx.db.query('computers')
        .withIndex('by_entityId', (q) => q.eq('id', lease.computerId!)).unique()
      if (!computer || computer.lastActiveAt === undefined || computer.lastActiveAt > (args.idleBefore ?? 0)) return null
      const activity = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
        ? lifecycle.activityTokens as Record<string, { expiresAt?: number }>
        : {}
      if (Object.values(activity).some((value) => (value.expiresAt ?? 0) > args.now)) return null
    }
    const activity = lifecycle.activityTokens && typeof lifecycle.activityTokens === 'object'
      ? lifecycle.activityTokens as Record<string, { expiresAt?: number }>
      : {}
    const nextActivity = args.force ? {} : Object.fromEntries(Object.entries(activity)
      .filter(([, value]) => typeof value.expiresAt === 'number' && value.expiresAt > args.now))
    await ctx.db.patch(lease._id, {
      usage: { ...usage, computerLifecycle: {
        ...lifecycle, maintenance: { kind: args.kind, token: args.token, expiresAt: args.expiresAt },
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
    await ctx.db.patch(lease._id, { usage: { ...usage, computerLifecycle: { ...lifecycle, maintenance: undefined } }, updatedAt: args.now })
    return true
  },
})

export const claimComputerActivityByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(), token: v.string(), userId: v.string(), now: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return null
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    const lifecycle = computerLifecycleUsage(usage)
    const maintenance = lifecycle.maintenance as { token?: string; expiresAt?: number } | undefined
    if (maintenance?.token) return null
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
    allocationKey: v.string(), allocationRecipe: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', args.leaseId)).unique()
    if (!lease || lease.workspaceId !== args.workspaceId || !lease.computerId) return null
    if (args.leaseId !== `computer:${lease.computerId}`
      || args.allocationKey !== `computer:${lease.computerId}`) {
      throw new Error('COMPUTER_ALLOCATION_KEY_MISMATCH')
    }
    const usage = (lease.usage ?? {}) as Record<string, unknown>
    if ((typeof usage.allocationKey === 'string' && usage.allocationKey !== args.allocationKey)
      || (typeof usage.allocationRecipe === 'string' && usage.allocationRecipe !== args.allocationRecipe)) return null
    const requestedAt = typeof usage.requestedAt === 'number' ? usage.requestedAt : args.now
    await ctx.db.patch(lease._id, {
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
export const environmentHasActiveRunsByServer = query({
  args: { serverSecret: v.string(), environmentId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    for (const status of ['queued', 'waking', 'starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering', 'needs_attention', 'cancelling'] as const) {
      const row = await ctx.db
        .query('agentRemoteSessions')
        .withIndex('by_environmentId_status', (q) => q.eq('environmentId', args.environmentId).eq('status', status))
        .first()
      if (row) return true
    }
    return false
  },
})

const USAGE_LIMITED_NOTICE = 'Stopped: your Overlay credit ran low, so the agent\'s computer was shut down. Add credit and send the message again.'

/**
 * Closes the chat row of a connected-agent run that ended without its machine saying so (its machine was shut down):
 * the message stops showing as generating, unfinished actions are closed, the run's remote session is ended, and the
 * room is told. Safe to repeat.
 */
async function finishRunMessage(
  ctx: MutationCtx,
  run: Doc<'conversationAgentRuns'>,
  workspaceId: string,
  now: number,
  notice: string,
) {
  const stored = await ctx.db.get(run.assistantMessageId)
  const message = stored ? await hydrateRemoteMessage(ctx, stored) : null
  if (message && stored && message.status === 'generating') {
    const environmentName = 'connected environment'
    const projection = projectRemoteAgentEvents({
      content: message.content,
      parts: Array.isArray(message.parts) ? (message.parts as unknown as Array<Record<string, unknown>>) : [],
      events: [{
        protocolVersion: 1, eventId: `system-stop-${run._id}`, environmentId: run.environmentId ?? '', runId: run.externalRunId ?? '',
        sourceSequence: 0, type: 'cancelled', occurredAt: now, payload: { reason: notice },
      } as AgentRemoteEvent],
      environmentName,
      queueExpiresAt: now,
      runId: run.externalRunId ?? '',
    })
    const base = message.content.trim() ? projection.content : ''
    const finalText = {
      content: `${base.trimEnd()}${base.trim() ? '\n\n' : ''}${notice}`,
      parts: conversationParts([...projection.parts, { type: 'text', text: `${base.trim() ? '\n\n' : ''}${notice}` }]),
    }
    const finalFields: Pick<Doc<'conversationMessages'>, 'content' | 'parts' | 'remoteTextStored'> =
      stored.remoteTextStored ? await prepareRemoteMessageText(ctx, stored, finalText) : finalText
    await ctx.db.patch(message._id, {
      content: finalFields.content, parts: finalFields.parts,
      ...(finalFields.remoteTextStored ? { remoteTextStored: finalFields.remoteTextStored } : {}),
      status: 'completed',
      updatedAt: now,
    })
    await ctx.db.insert('conversationEvents', {
      conversationId: run.conversationId, workspaceId, messageId: message._id,
      type: 'message.completed', userId: run.userId, createdAt: now,
    })
  }
  if (run.externalRunId) {
    const session = await currentRemoteAttempt(ctx, run.externalRunId!)
    if (session && !['completed', 'failed', 'cancelled'].includes(session.status)) {
      await ctx.db.patch(session._id, { status: 'cancelled', endedAt: now, updatedAt: now })
    }
  }
}

/** One-off/operations repair: finishes the chat rows of cancelled connected-agent runs that still show as generating. */
export const repairOrphanedRemoteMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const cancelled = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_runner_status_leaseExpiresAt', (q) => q.eq('runner', 'remote').eq('status', 'cancelled'))
      .take(500)
    let repaired = 0
    for (const run of cancelled) {
      const message = await ctx.db.get(run.assistantMessageId)
      if (message?.status !== 'generating') continue
      const conversation = await ctx.db.get(run.conversationId)
      await finishRunMessage(ctx, run, conversation?.workspaceId ?? '', now, USAGE_LIMITED_NOTICE)
      repaired += 1
    }
    return { repaired }
  },
})

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
    const environmentId = lease.environmentId
    if (!environmentId) throw new Error('AGENT_ENVIRONMENT_MISSING')
    const leaseCommands = await ctx.db.query('agentRunCommands')
      .withIndex('by_environmentId_sequence', q => q.eq('environmentId', environmentId)).take(1_000)
    await Promise.all(leaseCommands
      .filter((command) => command.status === 'pending' || command.status === 'claimed')
      .map((command) => ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: args.now, updatedAt: args.now })))
    // Managed-harness workflow slices check the run row at slice entry —
    // cancelling them here is what fails parked turns cleanly.
    const leaseRuns = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_environmentId_createdAt', q => q.eq('environmentId', lease.environmentId)).take(1_000)
    const stoppedRuns = leaseRuns.filter((run) => ['queued', 'running', 'waiting_for_approval'].includes(run.status))
    await Promise.all(stoppedRuns.map(async (run) => {
      if (run.remoteLifecycle) {
        await applyRemoteFact(ctx, run, { type: 'refuse', cause: args.reason }, args.now)
        return
      }
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        cancelledAt: args.now,
        terminalError: {
          code: 'usage_limited',
          message: 'The sandbox was stopped because the billing balance ran low.',
          retryable: false,
        },
        updatedAt: args.now,
      })
      await finishRunMessage(ctx, run, args.workspaceId, args.now, USAGE_LIMITED_NOTICE)
    }))
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
    minRemainingCents: v.number(),
    runtimeHoldCents: v.optional(v.number()),
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
    const monetaryInputs = [args.minRemainingCents, args.runtimeHoldCents ?? 0, args.charge?.costCents ?? 0, args.charge?.providerCostUsd ?? 0, args.charge?.durationSeconds ?? 0]
    if (!monetaryInputs.every((value) => Number.isFinite(value) && value >= 0)
      || !Number.isSafeInteger(Math.round((args.charge?.costCents ?? 0) * 10_000))) {
      throw new Error('sandbox_meter_amount_invalid')
    }
    const previousHoldMicros = typeof usage.runtimeHoldMicros === 'number' ? usage.runtimeHoldMicros : 0
    const holdMicros = args.runtimeHoldCents === undefined ? previousHoldMicros : Math.round(args.runtimeHoldCents * 10_000)
    if (![previousHoldMicros, holdMicros].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('sandbox_runtime_hold_invalid')
    const evidence = args.providerEvidence ? {
      ...args.providerEvidence, providerReference: args.meteredProviderReference, observedAt: args.meteredAt,
    } : usage.lastProviderEvidence
    if (args.providerEvidence) {
      await ctx.db.patch(lease._id, { usage: { ...usage, lastProviderEvidence: evidence }, updatedAt: args.now })
    }
    const nextUsage: Record<string, unknown> = {
      ...usage,
      ...(evidence ? { lastProviderEvidence: evidence } : {}),
      runtimeHoldMicros: holdMicros,
      meteredUsage: args.meteredUsage,
      meteredAt: args.meteredAt,
      meterVersion: meterVersion + 1,
      ...(args.meteredProviderReference === undefined ? {} : { meteredProviderReference: args.meteredProviderReference }),
      ...(args.payer === undefined ? {} : { lastPayer: args.payer }),
    }
    let remainingCents: number | undefined
    const charge = args.charge && args.charge.costCents > 0 ? args.charge : undefined
    const payer = args.payer
    if (!payer && (charge || holdMicros > 0 || previousHoldMicros > 0)) {
      return { applied: false, reason: 'insufficient_budget', remainingCents: 0 }
    }
    const heldPayer = usage.runtimeHoldPayer as typeof payer
    if (previousHoldMicros > 0 && (!heldPayer || !payer
      || heldPayer.billingAccountId !== payer.billingAccountId
      || heldPayer.userId !== payer.userId
      || heldPayer.spendSubjectKind !== payer.spendSubjectKind
      || heldPayer.spendSubjectId !== payer.spendSubjectId
      || args.meteredProviderReference !== usage.meteredProviderReference)) {
      throw new Error('sandbox_runtime_hold_identity_changed')
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
        const balance = await ctx.db
          .query('billingAccountBalances')
          .withIndex('by_billingAccountId', (q) =>
            q.eq('billingAccountId', billingAccountId),
          )
          .unique()
        if (!balance) throw new Error('workspace_billing_balance_missing')
        if (previousHoldMicros > balance.reservedMicros) throw new Error('sandbox_runtime_hold_balance_mismatch')
        const availableMicros = balance.mode === 'unlimited'
          ? Number.MAX_SAFE_INTEGER
          : Math.max(0, balance.includedMicros + balance.institutionalGrantMicros + balance.topUpPurchasedMicros - balance.usedMicros - balance.reservedMicros + previousHoldMicros)
        const chargeMicros = charge ? Math.round(Math.max(0, charge.costCents) * 10_000) : 0
        const floorMicros = Math.round(Math.max(0, args.minRemainingCents) * 10_000)
        const settlingHeldUsage = previousHoldMicros > 0 && holdMicros === 0 && chargeMicros <= previousHoldMicros
        if ((account.status !== 'active' && !settlingHeldUsage) || chargeMicros + holdMicros + floorMicros > availableMicros) {
          return {
            applied: false,
            reason: 'insufficient_budget',
            remainingCents: Math.round((availableMicros / 10_000) * 100) / 100,
          }
        }
        if (charge || holdMicros > 0 || previousHoldMicros > 0) {
          const limits = await prepareSandboxSpendLimits(ctx, {
            billingAccountId, userId: payer.userId, spendSubjectKind: payer.spendSubjectKind, spendSubjectId: payer.spendSubjectId,
            usage, previousHoldMicros, chargeMicros, holdMicros, now: args.now,
          })
          if (!limits.ok) return { applied: false, reason: 'insufficient_budget', remainingCents: limits.remainingMicros / 10_000 }
          nextUsage.runtimeHoldLimits = await applySandboxSpendLimits(ctx, { limits: limits.limits, holdMicros, chargeMicros, now: args.now })
          await finalizeWorkspaceLedger(ctx, {
            actualMicros: chargeMicros, balance, limit: null, reservedMicros: previousHoldMicros, reserveMicros: holdMicros,
          })
          nextUsage.runtimeHoldPayer = holdMicros > 0 ? payer : null
          nextUsage.runtimeHoldLimitId = null
          if (charge) await ctx.db.insert('usageOperations', {
            userId: payer.userId,
            billingAccountId,
            operationId: `sandbox-meter:${args.leaseId}:${meterVersion + 1}`,
            recorded: 1,
            ...meterUsageFields(charge),
            sandboxEvidence: {
              category: 'compute', provider: lease.provider,
              providerReference: args.meteredProviderReference ?? lease.providerReference ?? '',
              providerCostUsd: charge.providerCostUsd, pricingVersion: account.pricingVersion,
              metadataJson: JSON.stringify(charge.metadata),
            },
            createdAt: args.now,
          })
        }
        remainingCents =
          Math.round(((availableMicros - chargeMicros - holdMicros) / 10_000) * 100) / 100
      } else {
        // Not a paid workspace: a person's own account has no credit, so metered machine time cannot be paid for.
        if (holdMicros > 0 || previousHoldMicros > 0 || (charge?.costCents ?? 0) + Math.max(0, args.minRemainingCents) > 0) {
          return { applied: false, reason: 'insufficient_budget', remainingCents: 0 }
        }
        remainingCents = 0
      }
    }
    await ctx.db.patch(lease._id, { usage: nextUsage, updatedAt: args.now })
    return {
      applied: true, meterVersion: meterVersion + 1,
      ...(remainingCents === undefined ? {} : { remainingCents }),
    }
  },
})

export const getHarnessSessionByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), bindingId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('agentHarnessSessions')
      .withIndex('by_bindingId_conversationId', (q) =>
        q
          .eq('bindingId', args.bindingId)
          .eq('conversationId', args.conversationId),
      )
      .unique()
    if (!row || row.workspaceId !== args.workspaceId) return null
    return { ...clean(row), id: row.harnessSessionId }
  },
})

export const upsertHarnessSessionByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), bindingId: v.string(), conversationId: v.string(), harnessId: v.string(), sessionId: v.optional(v.string()), resumeState: v.optional(v.any()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_bindingId', (q) => q.eq('bindingId', args.bindingId))
      .unique()
    if (!binding || binding.workspaceId !== args.workspaceId)
      throw new Error('AGENT_BINDING_UNAVAILABLE')
    const existing = await ctx.db
      .query('agentHarnessSessions')
      .withIndex('by_bindingId_conversationId', (q) =>
        q
          .eq('bindingId', args.bindingId)
          .eq('conversationId', args.conversationId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        harnessId: args.harnessId, sessionId: args.sessionId, resumeState: args.resumeState, updatedAt: args.now,
      })
      return { ...clean(existing), harnessId: args.harnessId, sessionId: args.sessionId, resumeState: args.resumeState, updatedAt: args.now, id: existing.harnessSessionId }
    }
    const row = {
      harnessSessionId: args.id, workspaceId: args.workspaceId, bindingId: args.bindingId,
      conversationId: args.conversationId, harnessId: args.harnessId, sessionId: args.sessionId,
      resumeState: args.resumeState, createdAt: args.now, updatedAt: args.now,
    }
    await ctx.db.insert('agentHarnessSessions', row)
    return { ...row, id: row.harnessSessionId }
  },
})

export const deleteHarnessSessionsForBindingByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), bindingId: v.string(), now: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('agentHarnessSessions')
      .withIndex('by_bindingId_conversationId', (q) =>
        q.eq('bindingId', args.bindingId),
      )
      .collect()
    const ownedRows = rows.filter((row) => row.workspaceId === args.workspaceId)
    await Promise.all(ownedRows.map((row) => ctx.db.delete(row._id)))
    return ownedRows.length
  },
})

export const claimCommandsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number(), leaseMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    )
      return []
    if (
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > MAX_COMMANDS_PER_POLL ||
      !Number.isSafeInteger(args.leaseMs) ||
      args.leaseMs < 1_000 ||
      args.leaseMs > 60_000
    ) {
      throw new Error('AGENT_COMMAND_POLL_LIMIT_INVALID')
    }
    const [pendingRows, expiredClaimRows] = await Promise.all([
      ctx.db
        .query('agentRunCommands')
        .withIndex('by_environmentId_status_sequence', (q) =>
          q.eq('environmentId', args.environmentId).eq('status', 'pending'),
        )
        .take(args.limit),
      ctx.db
        .query('agentRunCommands')
        .withIndex('by_environmentId_status_claimExpiresAt', (q) =>
          q
          .eq('environmentId', args.environmentId)
          .eq('status', 'claimed')
          .lte('claimExpiresAt', args.now))
        .take(args.limit),
    ])
    const blocked = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_status_sequence', q => q.eq('environmentId', args.environmentId).eq('status', 'coordinator_pending')).first()
    const rows = [...pendingRows, ...expiredClaimRows].sort((left, right) => left.sequence - right.sequence)
    const claimable: typeof rows = []
    // A command whose run is over must still be delivered, or the host sees a hole in its command numbers and rejects
    // every later command. It goes out as a shutdown, which a host accepts for a run it does not know.
    const neutralized = new Set<string>()
    const legacyLimitations = new Set<string>()
    const candidates = rows.filter((row) => (
      row.workspaceId === args.workspaceId
      && (row.status === 'pending' || (row.status === 'claimed' && (row.claimExpiresAt ?? 0) <= args.now))
    ))
    const candidateRuns = await Promise.all(candidates.map((row) =>
      ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', row.runId)).unique()))
    for (let i = 0; i < candidates.length; i += 1) {
      if (claimable.length >= args.limit) break
      const row = candidates[i]!
      const run = candidateRuns[i]
      if (blocked && row.sequence > blocked.sequence) break
      if (run?.remoteLifecycle && (environment.capabilities as { remoteLifecycleVersion?: number }).remoteLifecycleVersion !== 2) {
        await applyRemoteFact(ctx, run, { type: 'health', process: 'unknown' }, args.now)
        neutralized.add(row.commandId)
        legacyLimitations.add(row.commandId)
      }
      // Fresh-attempt starts are user-authorized recovery, not queue leftovers: the
      // initial start's claim deadline must not neutralize them into a shutdown.
      const isFreshStart = row.type === 'start' && (row.payload as { fresh?: unknown } | null)?.fresh === true
      if (run?.remoteLifecycle && row.type === 'start' && !isFreshStart
        && run.remoteLifecycle.lastPreparationAt === undefined && args.now >= run.remoteLifecycle.claimDeadlineAt) {
        await applyRemoteFact(ctx, run, { type: 'observe' }, args.now)
        neutralized.add(row.commandId)
      }
      if (run?.remoteLifecycle && !run.remoteLifecycle.coordinatorId && !['cancel', 'shutdown'].includes(row.type) && !neutralized.has(row.commandId)) break
      if (run?.remoteLifecycle && ['cancelling', 'completed', 'cancelled', 'failed'].includes(run.remoteLifecycle.phase) && !['cancel', 'shutdown', 'observe'].includes(row.type)) neutralized.add(row.commandId)
      if (run && !run.remoteLifecycle && row.type !== 'cancel' && (!['queued', 'running', 'waiting_for_approval'].includes(run.status) ||
        (run.leaseExpiresAt !== undefined && run.leaseExpiresAt <= args.now))) neutralized.add(row.commandId)
      claimable.push(row)
    }
    return await Promise.all(
      claimable.map(async (row) => {
        await ctx.db.patch(row._id, {
          status: 'claimed',
          claimedAt: args.now,
          claimExpiresAt: args.now + args.leaseMs,
          updatedAt: args.now,
        })
        const wireRow = clean(row)
        if (legacyLimitations.has(row.commandId)) {
          delete wireRow.attemptId
          delete wireRow.executionGeneration
        }
        return {
          ...wireRow,
          ...(neutralized.has(row.commandId)
            ? { type: 'shutdown', payload: { reason: 'This run is no longer active.' } }
            : {}),
          id: row.commandId,
          status: 'claimed',
          claimedAt: args.now,
          claimExpiresAt: args.now + args.leaseMs,
          updatedAt: args.now,
        }
      }),
    )
  },
})

// A host numbers the commands it receives per environment and rejects anything after a missing
// number, so a row that resolves without ever being delivered leaves a permanent hole in the
// stream. This floor tells the host the highest sequence it may skip: every row below the first
// still-open command is resolved ('acknowledged' or 'cancelled' — the only two terminal states a
// row reaches without further delivery). Any other status still owes the host a delivery.
export const commandResolutionFloorByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const openStatuses = ['pending', 'claimed', 'coordinator_pending'] as const
    const firstOpenRows = await Promise.all(openStatuses.map((status) =>
      ctx.db
        .query('agentRunCommands')
        .withIndex('by_environmentId_status_sequence', (q) =>
          q.eq('environmentId', args.environmentId).eq('status', status))
        .first()))
    const firstOpen = firstOpenRows.reduce((lowest, row) =>
      row && row.workspaceId === args.workspaceId && row.sequence < lowest ? row.sequence : lowest,
    Number.MAX_SAFE_INTEGER)
    if (firstOpen !== Number.MAX_SAFE_INTEGER) return firstOpen - 1
    const latest = await ctx.db
      .query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) => q.eq('environmentId', args.environmentId))
      .order('desc')
      .first()
    return latest ? latest.sequence : 0
  },
})

export const applyRemoteEventsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), sessionId: v.string(), events: v.array(v.object({ protocolVersion: v.number(), eventId: v.string(), environmentId: v.string(), runId: v.string(), sourceSequence: v.number(), type: v.string(), occurredAt: v.number(), execution: v.optional(v.object({ attemptId: v.string(), generation: v.number(), hostBootId: v.optional(v.string()) })), payload: anyObject })), maxEventsPerMinute: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db
      .query('agentRemoteSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique()
    if (
      !session ||
      session.workspaceId !== args.workspaceId ||
      session.environmentId !== args.environmentId
    )
      throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (
      !environment ||
      environment.workspaceId !== args.workspaceId ||
      environment.status === 'pending' ||
      environment.status === 'revoked'
    ) {
      throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    }
    if (args.events.length === 0) return { accepted: true, acknowledgedSequence: session.eventCursor, duplicate: true }
    if (args.events.length > MAX_EVENTS_PER_BATCH || jsonByteLength(args.events) > MAX_EVENT_BATCH_BYTES) {
      throw new Error('AGENT_EVENT_BATCH_TOO_LARGE')
    }
    if (
      args.events.some((event) => event.protocolVersion !== 1) ||
      new Set(args.events.map((event) => event.eventId)).size !==
        args.events.length
    ) {
      throw new Error('AGENT_EVENT_BATCH_INVALID')
    }
    const first = args.events[0]!.sourceSequence
    if (
      args.events.some((event, index) => event.sourceSequence !== first + index)
    )
      throw new Error('AGENT_EVENT_BATCH_NOT_CONTIGUOUS')
    if (
      args.events.some(
        (event) =>
          event.environmentId !== args.environmentId ||
          event.runId !== session.runId,
      )
    )
      throw new Error('AGENT_EVENT_SCOPE_MISMATCH')
    const last = args.events.at(-1)!.sourceSequence
    const run = await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_externalRunId', (q) =>
        q.eq('externalRunId', session.runId),
      )
      .unique()
    const storedMessage = run ? await ctx.db.get(run.assistantMessageId) : null
    const message = storedMessage ? await hydrateRemoteMessage(ctx, storedMessage) : null
    const duplicateResult = async () => {
      const request = args.events.find(event => event.type === 'native_start_requested')
      const admission = request && session.nativeStartAdmission && run?.remoteLifecycle?.phase === 'recovering'
        && run.remoteLifecycle.currentAttemptId === session.sessionId && args.now < run.remoteLifecycle.hardDeadlineAt
        ? await admitNativeStart(ctx, run, session, {payload: request.payload, execution: request.execution, now: args.now}) : undefined
      return {
        accepted: true as const, acknowledgedSequence: session.eventCursor, duplicate: true,
        ...(admission ? {nativeStartAdmission: admission} : {}),
        ...(run && message && ['completed', 'failed', 'cancelled'].includes(run.status)
          ? { terminal: terminalBilling(session.capabilitySnapshot, message.tokens, run.status as 'completed' | 'failed' | 'cancelled') } : {}),
      }
    }
    if (last <= session.eventCursor) return duplicateResult()
    const expected = session.eventCursor + 1
    if (first !== expected) {
      if (run) await ctx.db.patch(run._id, { streamStats: recordRejectedBatch(run.streamStats) })
      return { accepted: false, expectedSequence: expected }
    }
    if (args.maxEventsPerMinute !== undefined) {
      const windowStartedAt = Math.floor(args.now / 60_000) * 60_000
      const window = await ctx.db
        .query('agentEventRateWindows')
        .withIndex('by_environmentId_windowStartedAt', (q) =>
          q
            .eq('environmentId', args.environmentId)
            .eq('windowStartedAt', windowStartedAt),
        )
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
    const swallowStaleEvents = async (stale: 'stale_attempt' | 'stale_execution' | 'stale_terminal') => {
      await ctx.db.patch(session._id, { eventCursor: last, updatedAt: args.now })
      return { accepted: true as const, acknowledgedSequence: last, duplicate: false, stale }
    }
    const historical = Boolean(run.remoteLifecycle && run.remoteLifecycle.currentAttemptId !== session.sessionId
      && await acceptsNativeHistory(ctx, run, session, args.events, args.now))
    if (run.remoteLifecycle && run.remoteLifecycle.currentAttemptId !== session.sessionId && !historical) return swallowStaleEvents('stale_attempt')
    if (run.runner !== 'remote' || run.environmentId !== args.environmentId) throw new Error('AGENT_REMOTE_RUN_NOT_FOUND')
    if (!message || !storedMessage) throw new Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
    if (run.status === 'cancelled' && !run.remoteLifecycle && !session.stopConfirmedAt) {
      const beforeStop = args.events.slice(0, args.events.findIndex(event => event.type === 'cancelled') < 0
        ? args.events.length : args.events.findIndex(event => event.type === 'cancelled'))
      const checkpoints = beforeStop.filter(event => event.type === 'text_checkpoint' || event.type === 'text_delta')
      const snapshot = session.capabilitySnapshot as Record<string, unknown>
      const projection = projectRemoteAgentEvents({ content: message.content, parts: message.parts ?? [],
        environmentName: typeof snapshot.environmentName === 'string' ? snapshot.environmentName : environment.name,
        queueExpiresAt: args.now, runId: session.runId,
        events: [...checkpoints as AgentRemoteEvent[], { protocolVersion: 1, eventId: `cancel:${last}`,
          environmentId: args.environmentId, runId: session.runId, sourceSequence: last,
          occurredAt: args.now, type: 'cancelled', payload: {} }] })
      const storedProjection = storedMessage?.remoteTextStored
        ? await prepareRemoteMessageText(ctx, storedMessage, { content: projection.content, parts: conversationParts(projection.parts) })
        : { content: projection.content, parts: conversationParts(projection.parts), textChanged: false }
      const { textChanged, ...messageFields } = storedProjection
      const wroteMessage = !sameJson(storedMessage?.parts, storedProjection.parts) || storedMessage?.content !== storedProjection.content
        || !sameJson(storedMessage?.remoteTextStored, 'remoteTextStored' in storedProjection ? storedProjection.remoteTextStored : undefined)
      if (wroteMessage) {
        await ctx.db.patch(message._id, { ...messageFields, updatedAt: args.now })
      }
      if (wroteMessage || textChanged) {
        await ctx.db.insert('conversationEvents', { conversationId: run.conversationId, workspaceId: args.workspaceId,
          messageId: message._id, type: 'message.completed', userId: run.userId, createdAt: args.now })
      }
      await ctx.db.patch(session._id, { eventCursor: last, updatedAt: args.now,
        ...(args.events.some(event => event.type === 'cancelled') ? { stopConfirmedAt: args.now } : {}) })
      await ctx.db.patch(run._id, { streamStats: recordAcceptedBatch(run.streamStats, {
        events: args.events as AgentRemoteEvent[], bytes: jsonByteLength(args.events), now: args.now, wroteMessage,
      }) })
      return { accepted: true, acknowledgedSequence: last, duplicate: false }
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status) && !historical) {
      if (!isCompatibleTerminalAcknowledgement(run.status, args.events))
        return swallowStaleEvents('stale_terminal')
      await ctx.db.patch(session._id, {
        eventCursor: last,
        updatedAt: args.now,
      })
      return {
        accepted: true,
        acknowledgedSequence: last,
        duplicate: false,
        terminal: terminalBilling(
          session.capabilitySnapshot,
          message.tokens,
          terminalOutcome(run.status),
        ),
    }
    }
    const snapshot =
      session.capabilitySnapshot &&
      typeof session.capabilitySnapshot === 'object'
        ? (session.capabilitySnapshot as Record<string, unknown>)
        : {}
    const restoresNativeSession = !historical && (Boolean(snapshot.nativeRestoration) || run.remoteLifecycle?.cause === 'native_restoration')
    if (historical && !session.hostBootId && args.events.some(event =>
      !['session_preparing', 'native_start_requested', 'drive_sync', 'failed', 'cancelled', 'process_observation'].includes(event.type)))
      return swallowStaleEvents('stale_execution')
    if (restoresNativeSession && !session.nativeStartAdmission && args.events.some(event =>
      !['session_preparing', 'native_start_requested', 'drive_sync', 'failed'].includes(event.type)
      && !(event.type === 'process_observation' && event.payload.process === 'unknown'))) return swallowStaleEvents('stale_execution')
    if (restoresNativeSession) for (const event of args.events) {
      if (event.type === 'session_started' && !await nativeRestorationStarted(ctx, run, session, {
        remoteSessionId: event.payload.remoteSessionId, adapterId: event.payload.adapterId,
        restorationCommandId: event.payload.restorationCommandId, hostBootId: event.execution?.hostBootId,
      })) return swallowStaleEvents('stale_execution')
    }
    const adapters = Array.isArray(snapshot.adapters) ? snapshot.adapters as Array<{ id?: string; protocol?: string; recovery?: { interruptedTurnContinuation?: boolean; approvalRestoration?: boolean } }> : []
    const nativeAdapter = adapters.find(adapter => adapter.id === (snapshot.startPayload as { adapterId?: string } | undefined)?.adapterId && adapter.protocol === 'eve')
    const acceptsNativeReattachment = Boolean(!historical && nativeAdapter?.recovery?.interruptedTurnContinuation
      && (!run.remoteLifecycle?.approval || nativeAdapter.recovery.approvalRestoration)
      && args.events[0]?.type === 'process_observation' && args.events[0].payload.process === 'live'
      && args.events[0].payload.recoveryOutcome === 'attached_live')
    let acceptedBoot = acceptsNativeReattachment ? args.events[0]?.execution?.hostBootId : session.hostBootId
    if (run.remoteLifecycle) for (const event of args.events) {
      if (!event.execution || event.execution.attemptId !== session.sessionId
        || event.execution.generation !== (historical ? session.executionGeneration : run.remoteLifecycle.executionGeneration)
        || (acceptedBoot && acceptedBoot !== event.execution.hostBootId
          && event.type !== 'session_preparing'
          && !(event.type === 'process_observation' && event.payload.process === 'unknown'))) return swallowStaleEvents('stale_execution')
      // Replayed preparation from an earlier bridge may precede this receiver's first native event.
      // Preparation attests neither a provider process nor ownership of its boot identity.
      if (!acceptedBoot && event.type !== 'session_preparing'
        && !(event.type === 'process_observation' && event.payload.process === 'unknown')) acceptedBoot = event.execution.hostBootId
    }
    try {
      let content = message.content === `Waiting for ${typeof snapshot.environmentName === 'string' ? snapshot.environmentName : environment.name}` ? '' : message.content
      for (const event of args.events as AgentRemoteEvent[]) content = applyRemoteText(content, event)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'AGENT_TEXT_OFFSET_MISMATCH') throw error
      await ctx.db.patch(run._id, { streamStats: recordRejectedBatch(run.streamStats) })
      return { accepted: false, expectedSequence: session.eventCursor + 1 }
    }
    let nativeStartAdmission: NativeStartAdmission | undefined
    for (const event of args.events) if (!historical && event.type === 'native_start_requested') {
      nativeStartAdmission = await admitNativeStart(ctx, run, session, {payload: event.payload, execution: event.execution, now: args.now})
    }
    let canonicalRun = run
    const normalizedEvents: AgentRemoteEvent[] = []
    for (const event of args.events as AgentRemoteEvent[]) {
      if (event.type === 'approval_requested' || event.type === 'elicitation_requested') {
        const requestKey = typeof event.payload.requestKey === 'string' ? event.payload.requestKey : ''
        if (!requestKey) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
        // Sequential on purpose: requestKey dedup relies on this mutation's
        // read-your-writes — a parallel batch would miss same-batch duplicates.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const existing = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId).eq('requestKey', requestKey)).unique()
        if (!existing) {
          const options =
            event.type === 'approval_requested' &&
            Array.isArray(event.payload.options)
              ? event.payload.options
                  .map((option) =>
                    option && typeof option === 'object'
                      ? String((option as Record<string, unknown>).id ?? '')
                      : '',
                  )
                  .filter(Boolean)
            : ['accept', 'decline', 'cancel']
          if (options.length === 0) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
          await ctx.db.insert('agentApprovalRequests', { approvalId: `approval_${crypto.randomUUID()}`,
            workspaceId: args.workspaceId, runId: session.runId, remoteSessionId: session.sessionId,
            requestKey, kind: event.type === 'approval_requested' ? 'permission' : 'elicitation',
            prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'Agent request',
            options, payload: event.payload, requestedAt: event.occurredAt,
            ...(historical ? {resolution: {decision: 'approval_context_lost', resolvedByPrincipalId: 'system:isolated-source', resolvedAt: args.now}} : {}) })
        }
      }
      if (event.type === 'artifact') {
        const reference = typeof event.payload.uploadReference === 'string' ? event.payload.uploadReference : ''
        // Event order is significant for validation; keep lookups sequential.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
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
      normalizedEvents.push(run.remoteLifecycle && (event.type === 'approval_requested' || event.type === 'elicitation_requested')
        ? { ...event, payload: { ...event.payload, context: { ...(event.payload.context as Record<string, unknown> ?? {}),
          expiresAt: Math.min(args.now + 60 * 60_000, run.remoteLifecycle.hardDeadlineAt), machineCostContinues: environment.kind === 'overlay_cloud' } } } : event)
    }
    if (run.remoteLifecycle) for (const event of normalizedEvents) {
      const state = canonicalRun.remoteLifecycle as RemoteRunState
      if (historical) {
        const outcome = event.type === 'completed' ? 'completed' : event.type === 'failed' ? 'failed'
          : event.type === 'cancelled' ? 'cancelled' : event.type === 'approval_requested' || event.type === 'elicitation_requested' ? 'approval_context_lost' : undefined
        if (outcome) {
          const result = await applyRemoteFact(ctx, canonicalRun, {type: 'isolated_source', outcome}, args.now, {deferMessageProjection: true})
          if (result?.applied) canonicalRun = {...canonicalRun, remoteLifecycle: result.state}
        }
        continue
      }
      if (event.type === 'completed') for (const request of pendingRemoteApprovals(state)) {
        if (!request.decision) continue
        const delivered = await applyRemoteFact(ctx, canonicalRun, { type: 'decision_delivered', requestKey: request.requestKey }, args.now, { deferMessageProjection: true })
        if (delivered?.applied) canonicalRun = { ...canonicalRun, remoteLifecycle: delivered.state }
      }
      const fact = event.type === 'session_started' ? restoresNativeSession
        ? {type: 'recover' as const, recoveryOutcome: 'restored' as const, oldWriterStopped: true}
        : { type: 'started' as const }
        : event.type === 'session_preparing' || event.type === 'native_start_requested' ? {type: 'preparing' as const}
        : event.type === 'process_observation' && event.payload.process === 'live' && event.payload.recoveryOutcome === 'attached_live'
          ? { type: 'recover' as const, recoveryOutcome: 'attached_live' as const }
        : event.type === 'heartbeat' || event.type === 'process_observation' ? { type: 'health' as const, process: event.payload.process === 'live' ? 'live' as const : event.payload.process === 'lost' ? 'lost' as const : 'unknown' as const }
        : event.type === 'approval_requested' || event.type === 'elicitation_requested' ? {
          type: 'request' as const, requestKey: String(event.payload.requestKey),
          kind: event.type === 'approval_requested' ? 'permission' as const : 'elicitation' as const,
          expiresAt: Math.min(args.now + 60 * 60_000, state.hardDeadlineAt),
        } : event.type === 'drive_sync' && event.payload.state === 'saving' ? { type: 'finalize' as const }
        : event.type === 'completed' ? { type: 'complete' as const }
        : event.type === 'cancelled' ? { type: 'stopped' as const }
        : event.type === 'failed' ? { type: 'failure' as const }
        : { type: 'progress' as const }
      const result = await applyRemoteFact(ctx, canonicalRun, fact, args.now, { deferMessageProjection: true })
      if (result?.applied) canonicalRun = { ...canonicalRun, remoteLifecycle: result.state }
      if (event.execution?.hostBootId && event.type !== 'session_preparing'
        && !(event.type === 'process_observation' && event.payload.process === 'unknown')
        && (!session.hostBootId || acceptsNativeReattachment)) await ctx.db.patch(session._id, { hostBootId: event.execution.hostBootId })
    }
    const interruptedAt = nativeStartAdmission && !session.nativeStartAdmission
      ? run.remoteLifecycle?.providerStop?.observedAt : undefined
    const previousParts = Array.isArray(message.parts)
      ? (message.parts as unknown as Array<Record<string, unknown>>) : []
    const projection = projectRemoteAgentEvents({
      content: message.content,
      parts: interruptedAt === undefined ? previousParts : interruptRemoteAgentToolParts(previousParts, interruptedAt),
      events: normalizedEvents,
      environmentName: typeof snapshot.environmentName === 'string' ? snapshot.environmentName : 'connected environment',
      queueExpiresAt: typeof snapshot.queueExpiresAt === 'number' ? snapshot.queueExpiresAt : args.now,
      runId: session.runId,
    })
    // Cancellation fences outcome, not evidence of already-consumed usage.
    projection.tokens = { input: Math.max(message.tokens?.input ?? 0, projection.tokens.input),
      output: Math.max(message.tokens?.output ?? 0, projection.tokens.output) }
    if (canonicalRun.remoteLifecycle) {
      const state = canonicalRun.remoteLifecycle as RemoteRunState
      projection.runStatus = remoteRunCoarseStatus(state.phase)
      projection.sessionStatus = state.phase as typeof projection.sessionStatus
      projection.terminal = ['completed', 'cancelled', 'failed'].includes(state.phase)
      const parts = reconcileRemoteRequestParts(projection.parts, historical ? {...state, cause: 'approval_context_lost'} : state, args.now)
        .filter(part => part.type !== 'data-remote-agent-status')
      projection.parts = [...parts, { type: 'data-remote-agent-status', data: {
        environmentName: snapshot.environmentName, queueExpiresAt: state.claimDeadlineAt, runId: session.runId,
        hardDeadlineAt: state.hardDeadlineAt,
        state: state.phase, cause: state.cause, revision: state.revision,
        recoveryOutcome: state.recoveryOutcome,
      } }]
    }
    const providerStarted = !historical && (!run.remoteLifecycle || normalizedEvents.some(event => event.type === 'session_started'))
    await ctx.db.patch(session._id, historical ? {eventCursor: last, updatedAt: args.now} : {
      eventCursor: last, status: projection.sessionStatus,
      ...(projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
      ...(!session.startedAt && providerStarted ? { startedAt: args.now } : {}),
      ...(projection.terminal ? { endedAt: args.now } : {}), updatedAt: args.now,
    })
    const messageStatus = projection.runStatus === 'failed' ? 'error' : projection.terminal ? 'completed' : 'generating'
    const storedProjection = storedMessage?.remoteTextStored || normalizedEvents.some(event => event.type === 'text_delta')
      ? await prepareRemoteMessageText(ctx, storedMessage, { content: projection.content, parts: conversationParts(projection.parts) })
      : { content: projection.content, parts: conversationParts(projection.parts), textChanged: false }
    const { textChanged, ...messageFields } = storedProjection
    const wroteMessage = storedMessage?.content !== storedProjection.content || !sameJson(storedMessage?.parts ?? [], storedProjection.parts)
      || !sameJson(storedMessage?.remoteTextStored, 'remoteTextStored' in storedProjection ? storedProjection.remoteTextStored : undefined)
      || message.status !== messageStatus || !sameJson(message.tokens ?? { input: 0, output: 0 }, projection.tokens)
    await ctx.db.patch(run._id, {
      status: projection.runStatus,
      ...(!historical ? {liveness: recordRemoteRunLiveness(interruptedAt !== undefined && run.liveness
        ? {...run.liveness, openTools: [], stalled: false} : run.liveness, normalizedEvents, args.now, projection.terminal)} : {}),
      streamStats: recordAcceptedBatch(interruptedAt === undefined ? run.streamStats : settleInterruptedRemoteRunTools(run.streamStats, interruptedAt), {
        events: normalizedEvents, bytes: jsonByteLength(args.events), now: args.now, wroteMessage,
      }),
      ...(!historical && projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
      ...(!run.startedAt && providerStarted ? { startedAt: args.now } : {}),
      ...(projection.runStatus === 'completed' ? { completedAt: args.now } : {}),
      ...(projection.runStatus === 'failed' ? { failedAt: args.now, terminalError: projection.terminalError } : {}),
      ...(projection.runStatus === 'cancelled' ? { cancelledAt: args.now } : {}),
      ...(projection.terminal ? { metrics: { ...(run.metrics ?? {}), inputTokens: projection.tokens.input, outputTokens: projection.tokens.output } } : {}),
      ...(!projection.terminal && !historical ? { leaseExpiresAt: Math.min(
        args.now + REMOTE_RUN_LEASE_MS,
        typeof snapshot.hardExpiresAt === 'number' ? snapshot.hardExpiresAt : args.now + REMOTE_RUN_LEASE_MS,
      ) } : {}),
      updatedAt: args.now,
    })
    if (wroteMessage) {
      await ctx.db.patch(message._id, {
        ...messageFields,
        ...(projection.terminal || projection.tokens.input > 0 || projection.tokens.output > 0 ? { tokens: projection.tokens } : {}),
        status: projection.runStatus === 'failed' ? 'error' : projection.terminal ? 'completed' : 'generating',
        updatedAt: args.now,
      })
    }
    if (wroteMessage || textChanged) {
      await ctx.db.patch(run.conversationId, { lastModified: args.now, updatedAt: args.now })
      await ctx.db.insert('conversationEvents', {
        conversationId: run.conversationId, workspaceId: args.workspaceId, messageId: message._id,
        type: projection.runStatus === 'failed' ? 'message.failed' : projection.terminal ? 'message.completed' : 'message.delta',
        userId: run.userId, createdAt: args.now,
      })
    }
    if (projection.terminal) {
      if (run.remoteLifecycle) {
        const intentId = `finalize:${session.runId}:${run.remoteLifecycle.currentAttemptId}`
        const existing = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', intentId)).unique()
        if (!existing) await ctx.db.insert('agentRemoteRunIntents', { intentId, runId: session.runId, kind: 'finalize',
          revision: canonicalRun.remoteLifecycle!.revision, status: 'pending', createdAt: args.now, updatedAt: args.now })
      }
      const requests = await ctx.db.query('agentApprovalRequests')
        .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', args.workspaceId).eq('runId', session.runId)).take(100)
      await Promise.all(requests.filter((request) => !request.resolution).map((request) =>
        ctx.db.patch(request._id, { resolution: {
          decision: projection.runStatus === 'cancelled' ? 'cancelled' : projection.runStatus === 'failed' ? 'run_failed' : 'run_completed',
          resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
        } })))
      const commands = await ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId))
        .filter(q => q.eq(q.field('runId'), session.runId)).take(100)
      await Promise.all(commands.filter((command) => command.status === 'claimed' || command.status === 'acknowledged').map((command) =>
        ctx.db.patch(command._id, { status: 'acknowledged',
          acknowledgedAt: command.acknowledgedAt ?? args.now, claimExpiresAt: undefined, updatedAt: args.now })))
    }
    return { accepted: true, acknowledgedSequence: last, duplicate: false,
      ...(nativeStartAdmission && canonicalRun.remoteLifecycle?.phase === 'recovering'
        && canonicalRun.remoteLifecycle.cause === 'native_restoration' ? {nativeStartAdmission} : {}),
      ...(projection.terminal ? { terminal: terminalBilling(session.capabilitySnapshot, projection.tokens, terminalOutcome(projection.runStatus)) } : {}) }
  },
})

/** Counts an event batch the server refused before it could be applied (schema, size or scope), for QA readback. */
export const recordRemoteEventBatchRejectionByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments')
      .withIndex('by_environmentId', (q) => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return false
    const run = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_externalRunId', (q) => q.eq('externalRunId', args.runId)).unique()
    if (!run || run.runner !== 'remote' || run.environmentId !== args.environmentId) return false
    await ctx.db.patch(run._id, { streamStats: recordRejectedBatch(run.streamStats) })
    return true
  },
})

export const revokeEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db
      .query('agentEnvironments')
      .withIndex('by_environmentId', (q) =>
        q.eq('environmentId', args.environmentId),
      )
      .unique()
    if (!environment || environment.workspaceId !== args.workspaceId)
      return false
    if (environment.status === 'revoked') return true
    await ctx.db.patch(environment._id, { status: 'revoked', revokedAt: args.now, updatedAt: args.now })
    const [bindings, envCommands, credentials, envLeases] = await Promise.all([
      ctx.db.query('agentBindings').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_environmentId_expiresAt', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId).eq('environmentId', args.environmentId)).take(1_000),
    ])
    const activeRuns = await ctx.db.query('conversationAgentRuns').withIndex('by_environmentId_createdAt', q => q.eq('environmentId', args.environmentId)).take(1000)
    for (const run of activeRuns) if (run.remoteLifecycle && !['completed', 'cancelled', 'failed'].includes(run.remoteLifecycle.phase))
      await applyRemoteFact(ctx, run, { type: 'refuse', cause: 'authorization_revoked' }, args.now)
    await Promise.all([
      ...bindings.map((binding) => ctx.db.patch(binding._id, { enabled: false, updatedAt: args.now })),
      ...envCommands
        .filter((command) => command.status === 'pending' || command.status === 'claimed')
        .map((command) => ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: args.now, updatedAt: args.now })),
      ...credentials
        .filter((credential) => !credential.revokedAt)
        .map((credential) => ctx.db.patch(credential._id, { revokedAt: args.now })),
      ...envLeases
        .filter((lease) => !['released', 'cleanup_failed'].includes(lease.status))
        .map((lease) => ctx.db.patch(lease._id, { status: 'stopping', reservedUntil: args.now, cleanupAfter: args.now, updatedAt: args.now })),
    ])
    return true
  },
})

export const deleteWorkspaceDataByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const credentials = await ctx.db
      .query('agentEnvironmentCredentials')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    const credentialNonces = (
      await Promise.all(
        credentials.map((credential) =>
          ctx.db
            .query('agentEnvironmentCredentialNonces')
            .withIndex('by_credentialId_expiresAt', (q) =>
              q.eq('credentialId', credential.credentialId),
            )
            .collect(),
        ),
      )
    ).flat()
    const groups = await Promise.all([
      Promise.resolve(credentialNonces),
      Promise.resolve(credentials),
      ctx.db
        .query('agentEnvironmentProofChallenges')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentEnrollmentSessions')
        .withIndex('by_workspaceId_createdAt', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentApprovalRequests')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentArtifacts')
        .withIndex('by_workspaceId_environmentId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentRunCommands')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentEventRateWindows')
        .withIndex('by_workspaceId_windowStartedAt', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentWorkspacePolicyUsage')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentHarnessSessions')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentSandboxSettlements')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentRemoteSessions')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentSandboxLeases')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentBindings')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
      ctx.db
        .query('agentEnvironments')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect(),
    ])
    await Promise.all(groups.flat().map((row) => ctx.db.delete(row._id)))
    return true
  },
})

async function artifactPolicyUsage(
  ctx: MutationCtx,
  workspaceId: string,
  now: number,
) {
  const existing = await ctx.db
    .query('agentWorkspacePolicyUsage')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .unique()
  if (existing) return existing
  const statuses = ['pending_upload', 'scanning', 'clean', 'linked'] as const
  const groups = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query('agentArtifacts')
        .withIndex('by_workspaceId_status', (q) =>
          q.eq('workspaceId', workspaceId).eq('status', status),
        )
        .take(10_001),
    ),
  )
  if (groups.some((group) => group.length > 10_000))
    throw new Error('CONNECTED_AGENT_POLICY_USAGE_RECONCILIATION_REQUIRED')
  const activeArtifactBytes = groups
    .flat()
    .reduce((sum, artifact) => sum + artifact.size, 0)
  const _id = await ctx.db.insert('agentWorkspacePolicyUsage', {
    workspaceId,
    activeArtifactBytes,
    updatedAt: now,
  })
  const inserted = await ctx.db.get(_id)
  if (!inserted) throw new Error('CONNECTED_AGENT_POLICY_USAGE_UNAVAILABLE')
  return inserted
}

function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) {
  return (
    left.decision === right.decision &&
    left.resolvedByPrincipalId === right.resolvedByPrincipalId &&
    left.resolvedAt === right.resolvedAt
  )
}

function terminalBilling(
  snapshotValue: unknown,
  tokensValue: unknown,
  outcome: 'completed' | 'failed' | 'cancelled' | 'timeout',
) {
  const snapshot =
    snapshotValue && typeof snapshotValue === 'object'
      ? (snapshotValue as Record<string, unknown>)
      : {}
  const billing =
    snapshot.billing && typeof snapshot.billing === 'object'
      ? (snapshot.billing as Record<string, unknown>)
      : {}
  const tokens =
    tokensValue && typeof tokensValue === 'object'
      ? (tokensValue as Record<string, unknown>)
      : {}
  return {
    agentId: typeof billing.agentId === 'string' ? billing.agentId : '',
    conversationId: typeof billing.conversationId === 'string' ? billing.conversationId : '',
    environmentId: typeof billing.environmentId === 'string' ? billing.environmentId : '',
    forceFreeTierLimits: false,
    inputTokens: typeof tokens.input === 'number' ? tokens.input : 0,
    modelId:
      typeof billing.modelId === 'string' ? billing.modelId : 'openrouter/free',
    modelUsageBilling:
      billing.modelUsageBilling === 'overlay'
        ? ('overlay' as const)
        : ('byok' as const),
    memoryEnabled: billing.memoryEnabled === true,
    messageId: typeof billing.messageId === 'string' ? billing.messageId : '',
    operationId: typeof billing.operationId === 'string' ? billing.operationId : 'remote-agent',
    outcome,
    outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
    reservationId: typeof billing.reservationId === 'string' ? billing.reservationId : null,
    runId: typeof billing.runId === 'string' ? billing.runId : '',
    sandboxBilling:
      snapshot.sandboxBilling && typeof snapshot.sandboxBilling === 'object'
        ? (snapshot.sandboxBilling as Record<string, unknown>)
      : null,
    userId: typeof billing.userId === 'string' ? billing.userId : '',
    turnId: typeof billing.turnId === 'string' ? billing.turnId : '',
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
  args: { now: number; hostOfflineBefore: number; limit: number; settleBilling?: boolean; abandonEnvironmentId?: string },
) {
  const statuses = ['queued', 'running', 'waiting_for_approval'] as const
  const active = (
    await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query('conversationAgentRuns')
          .withIndex('by_runner_status_leaseExpiresAt', (q) =>
            q.eq('runner', 'remote').eq('status', status),
          )
      .take(args.limit),
      ),
    )
  )
    .flat()
    .slice(0, args.limit)
  const expiredRunIds: string[] = []
  const settlements = []
  const alerts: Array<Record<string, unknown>> = []
  const sweepResults = await Promise.all(active.map(async (run) => {
    if (run.remoteLifecycle) {
      await applyRemoteFact(ctx, run, { type: 'observe' }, args.now)
      return null
    }
    const session = run.externalRunId
      ? await currentRemoteAttempt(ctx, run.externalRunId!)
      : null
    const environment = session
      ? await ctx.db
          .query('agentEnvironments')
          .withIndex('by_environmentId', (q) =>
            q.eq('environmentId', session.environmentId),
          )
          .unique()
      : null
    // A queued run on a cloud machine is waiting for the machine to wake; its host is offline by definition, so the
    // queue's own expiry decides, not the offline check.
    const waitingForWake = environment?.kind === 'overlay_cloud' && run.status === 'queued'
    const offline = (environment?.lastSeenAt ?? 0) <= args.hostOfflineBefore && !waitingForWake
    // A cloud machine that was paused or restarted mid-run comes back with a host that knows nothing of the run, so
    // the host looks healthy while the run never finishes. Its events stop, which is how that is told apart from a
    // long run.
    const snapshot = session?.capabilitySnapshot as Record<string, unknown> | undefined
    const hardExpiresAt = typeof snapshot?.hardExpiresAt === 'number' ? snapshot.hardExpiresAt : run.leaseExpiresAt
    const healthyWait = !offline && session !== null && ['waiting_for_approval', 'waiting_for_input'].includes(session.status)
      && (hardExpiresAt ?? 0) > args.now && session.environmentId !== args.abandonEnvironmentId
    if (healthyWait) {
      await ctx.db.patch(run._id, { leaseExpiresAt: Math.min(args.now + REMOTE_RUN_LEASE_MS, hardExpiresAt!), updatedAt: args.now })
      return null
    }
    const abandoned = environment?.kind === 'overlay_cloud' && session !== null
      && (session.environmentId === args.abandonEnvironmentId
        || Math.max(session.updatedAt ?? 0, session.startedAt ?? 0) < args.now - ABANDONED_CLOUD_RUN_MS)
    if (!offline && !abandoned && (run.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > args.now) return null
    const message = await ctx.db.get(run.assistantMessageId)
    if (!session || !environment || !message || !run.externalRunId) return null
    const code = offline ? 'remote_host_offline' : abandoned ? 'remote_run_abandoned' : 'remote_run_timeout'
    const failureMessage = offline
      ? 'The connected environment disappeared.'
      : abandoned ? 'The agent\'s machine restarted before this run finished. Send the message again.' : 'The connected agent run timed out.'
    await Promise.all([
      ctx.db.patch(run._id, { status: 'failed', failedAt: args.now,
        terminalError: { code, message: failureMessage, retryable: true }, updatedAt: args.now }),
      ctx.db.patch(session._id, { status: 'failed', endedAt: args.now, updatedAt: args.now }),
      ctx.db.patch(message._id, { content: message.content || failureMessage,
        parts: conversationParts(recoveryParts(message.parts, run.externalRunId, environment.name, code, failureMessage, args.now)),
        status: 'error', updatedAt: args.now }),
    ])
    const [commands, requests] = await Promise.all([
      ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId))
        .filter(q => q.eq(q.field('runId'), run.externalRunId!)).take(100),
      ctx.db.query('agentApprovalRequests')
        .withIndex('by_workspaceId_runId', q => q.eq('workspaceId', session.workspaceId).eq('runId', run.externalRunId!)).take(100),
    ])
    await Promise.all([
      // Undelivered commands stay pending: the host's command numbers must stay contiguous, so the next poll hands
      // them over as shutdowns (see claimCommandsByServer) instead of leaving a gap.
      ...requests
        .filter((request) => !request.resolution)
        .map((request) => ctx.db.patch(request._id, { resolution: {
          decision: code, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
        } })),
      ctx.db.insert('conversationEvents', { conversationId: run.conversationId,
        workspaceId: session.workspaceId, messageId: message._id, type: 'message.failed', userId: run.userId, createdAt: args.now }),
    ])
    const settlement = terminalBilling(session.capabilitySnapshot, message.tokens, 'timeout')
    const runAlerts: Array<Record<string, unknown>> = [{
      code: offline ? 'offline_environment' : 'lease_expired',
      workspaceId: session.workspaceId,
      agentId: settlement.agentId || run.agentId,
      environmentId: session.environmentId,
      runId: run.externalRunId,
      remoteSessionId: session.sessionId,
      ...(settlement.reservationId ? { reservationId: settlement.reservationId } : {}),
      eventCursor: session.eventCursor,
    }]
    for (const command of commands) if (
      (command.status === 'pending' || command.status === 'claimed') && command.updatedAt <= args.now - 2 * 60_000
    ) runAlerts.push({
      code: 'stuck_command', workspaceId: command.workspaceId, environmentId: command.environmentId,
      runId: command.runId, commandId: command.commandId, ageMs: args.now - command.updatedAt,
    })
    for (const request of requests) if (!request.resolution && request.requestedAt <= args.now - 15 * 60_000) {
      runAlerts.push({
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
    return { runId: run.externalRunId, settlement, runAlerts }
  }))
  for (const result of sweepResults) {
    if (!result) continue
    expiredRunIds.push(result.runId)
    settlements.push(result.settlement)
    alerts.push(...result.runAlerts)
  }
  const [offlineEnvironments, staleOnlineEnvironments] = await Promise.all([
    ctx.db
      .query('agentEnvironments')
      .withIndex('by_status_lastSeenAt', (q) => q.eq('status', 'offline'))
      .take(args.limit),
    ctx.db
      .query('agentEnvironments')
      .withIndex('by_status_lastSeenAt', (q) =>
        q.eq('status', 'online').lte('lastSeenAt', args.hostOfflineBefore),
      )
      .take(args.limit),
  ])
  const alertedEnvironments = new Set(
    alerts.map((alert) => alert.environmentId).filter(Boolean),
  )
  for (const environment of [
    ...offlineEnvironments,
    ...staleOnlineEnvironments,
  ]) {
    // overlay_cloud environments have no heartbeat host — they read offline
    // whenever the managed sandbox is idle-stopped, which is normal.
    if (!environment.approvedAt || environment.revokedAt || environment.kind === 'overlay_cloud' || alertedEnvironments.has(environment.environmentId)) continue
    alerts.push({
      code: 'offline_environment', workspaceId: environment.workspaceId,
      environmentId: environment.environmentId,
      ...(environment.lastSeenAt === undefined ? {} : { ageMs: args.now - environment.lastSeenAt }),
    })
  }
  const oldCommands = (
    await Promise.all(
      (['pending', 'claimed'] as const).map((status) =>
        ctx.db
          .query('agentRunCommands')
          .withIndex('by_status_updatedAt', (q) =>
            q.eq('status', status).lte('updatedAt', args.now - 2 * 60_000),
          )
          .take(args.limit),
      ),
    )
  )
    .flat()
    .slice(0, args.limit)
  const alertedCommands = new Set(
    alerts.map((alert) => alert.commandId).filter(Boolean),
  )
  for (const command of oldCommands)
    if (!alertedCommands.has(command.commandId))
      alerts.push({
        code: 'stuck_command',
        workspaceId: command.workspaceId,
        environmentId: command.environmentId,
        runId: command.runId,
        commandId: command.commandId,
        ageMs: args.now - command.updatedAt,
  })
  const oldApprovals = await ctx.db.query('agentApprovalRequests')
    .withIndex('by_requestedAt', q => q.lte('requestedAt', args.now - 15 * 60_000)).take(args.limit)
  const alertedApprovals = new Set(alerts.map(alert => `${alert.remoteSessionId}:${alert.runId}`).filter(Boolean))
  const pendingOldApprovals = oldApprovals.filter((approval) =>
    !approval.resolution && !alertedApprovals.has(`${approval.remoteSessionId}:${approval.runId}`))
  const approvalSessions = await Promise.all(pendingOldApprovals.map((approval) =>
    ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', approval.remoteSessionId)).unique()))
  alerts.push(...pendingOldApprovals.map((approval, i) => {
    const session = approvalSessions[i]
    return {
      code: 'approval_age', workspaceId: approval.workspaceId,
      ...(session ? { environmentId: session.environmentId, eventCursor: session.eventCursor } : {}),
      runId: approval.runId, remoteSessionId: approval.remoteSessionId,
      ageMs: args.now - approval.requestedAt,
    }
  }))
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

function recoveryParts(
  value: unknown,
  runId: string,
  environmentName: string,
  code: string,
  message: string,
  resolvedAt: number,
) {
  const parts = Array.isArray(value)
    ? (value as Array<Record<string, unknown>>)
    : []
  return [
    ...parts
      .filter((part) => part.type !== 'data-remote-agent-status')
      .map((part) => {
        const data =
          part.data && typeof part.data === 'object'
            ? (part.data as Record<string, unknown>)
            : null
        return part.type === 'data-remote-agent-request' &&
          data?.state === 'pending'
          ? {
              ...part,
              data: {
                ...data,
                state: 'resolved',
                resolution: {
                  decision: code,
                  resolvedByPrincipalId: 'system:remote-supervisor',
                  resolvedAt,
                },
              },
            }
      : part
  }), {
    type: 'data-remote-agent-status', data: { runId, environmentName, queueExpiresAt: 0,
      state: 'recoverable', retryable: true,
      retryClass: code.includes('offline') ? 'host_offline' : code.includes('timeout') ? 'timeout' : 'transient', message },
  }]
}

/**
 * One-time repair: commands cancelled before the host acknowledged them (by the sweep, or by a host that rejected them
 * for a gap) leave holes in a cloud host's command numbers. Put them back to pending so the next poll delivers them as shutdowns and the host's numbering closes up.
 */
export const repairUndeliveredCancelledCommands = internalMutation({
  args: { environmentId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) => q.eq('environmentId', args.environmentId))
      .order('desc').take(300)
    let repaired = 0
    for (const row of rows) {
      if (row.status === 'cancelled' && row.acknowledgedAt === undefined) {
        await ctx.db.patch(row._id, { status: 'pending', claimExpiresAt: undefined, updatedAt: Date.now() })
        repaired += 1
      }
    }
    return { repaired }
  },
})


/**
 * Repairs an environment whose host has stopped accepting commands because commands were cancelled before they were
 * delivered (a hole in its command numbers: it rejects every later command with `command_sequence_gap`). Every command
 * after the last one the host acknowledged goes back to pending; delivery sends the ones whose run is over as shutdowns,
 * which the host accepts, so the host catches up in order and new commands are accepted again. Run once per wedged
 * environment: `npx convex run agents/connectedAgents:reopenUndeliveredCommands '{"environmentId":"..."}' --prod`.
 */
export const reopenUndeliveredCommands = internalMutation({
  args: { environmentId: v.string() },
  handler: async (ctx, args) => {
    const commands = await ctx.db.query('agentRunCommands')
      .withIndex('by_environmentId_sequence', (q) => q.eq('environmentId', args.environmentId))
      .collect()
    const lastAcknowledged = commands.filter((command) => command.status === 'acknowledged').reduce((max, command) => Math.max(max, command.sequence), 0)
    const toReopen = commands.filter((command) => command.sequence > lastAcknowledged && command.status !== 'pending')
    const now = Date.now()
    await Promise.all(toReopen.map((command) => ctx.db.patch(command._id, {
      status: 'pending', claimedAt: undefined, claimExpiresAt: undefined, updatedAt: now,
    })))
    return { lastAcknowledged, reopened: toReopen.map((command) => command.sequence) }
  },
})

/** The machine-time charge, recorded on the usage operation so it shows on the itemized usage list. */
function meterUsageFields(charge: { costCents: number; modelId?: string; durationSeconds?: number }) {
  return {
    cents: Math.max(0, charge.costCents),
    kind: 'sandbox' as const,
    ...(charge.modelId ? { modelId: charge.modelId } : {}),
    ...(charge.durationSeconds ? { usageSeconds: charge.durationSeconds } : {}),
  }
}

export const pendingRemoteFinalizationsByServer = query({
  args: { serverSecret: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const intents = await ctx.db.query('agentRemoteRunIntents').withIndex('by_kind_status_updatedAt', q => q.eq('kind', 'finalize').eq('status', 'pending')).take(100)
    const results = []
    for (const intent of intents) {
      if (intent.kind !== 'finalize') continue
      const session = await currentRemoteAttempt(ctx, intent.runId)
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', intent.runId)).unique()
      if (!session || !run || !['completed', 'failed', 'cancelled'].includes(run.status)) continue
      const message = await ctx.db.get(run.assistantMessageId)
      results.push({ intentId: intent.intentId, revision: intent.revision,
        terminal: terminalBilling(session.capabilitySnapshot, message?.tokens, terminalOutcome(run.status)) })
    }
    return results
  },
})

export const environmentHasActiveExecutionByServer = query({
  args: { serverSecret: v.string(), environmentId: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    for (const status of ['running', 'waiting_for_approval', 'waiting_for_input', 'recovering', 'needs_attention', 'cancelling']) {
      const sessions = await ctx.db.query('agentRemoteSessions').withIndex('by_environmentId_status', q => q.eq('environmentId', args.environmentId).eq('status', status)).take(100)
      if (sessions.some(session => Boolean(session.startedAt))) return true
    }
    return false
  },
})
