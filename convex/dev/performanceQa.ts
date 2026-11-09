import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'
import { seedPreviewWorkspace } from './previewWorkspace'
import { createHarnessSnapshot } from '../../packages/overlay-agent-runtime/src/harness-state'

const PREFIX = 'preview-performance-v1'
const STEPS = 80
const INTERVAL_MS = 150
const MODEL = 'openrouter/free'
const streamText = (step: number) => Array.from({ length: step }, (_, index) =>
  `Synthetic stream paragraph ${index + 1}. This deterministic text does not call a model.\n\n`).join('')
const historyText = (kind: string, index: number, count: number) => index === count - 1
  ? `Performance ${kind} final sentinel`
  : `Synthetic ${kind} message ${index + 1}.\n\n${'Variable-height benchmark paragraph.\n\n'.repeat(1 + index % 7)}`
const tickReference = makeFunctionReference<'mutation', {
  conversationId: Id<'conversations'>; generation: number; step: number
}>('dev/performanceQa:tick')

function identity() {
  requirePreviewDeployment()
  const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
  const email = process.env.PREVIEW_LOGIN_EMAIL?.trim()
  if (!userId?.startsWith('user_') || !email) throw new Error('Configure the sandbox preview login identity before seeding')
  return { userId, email, workspaceId: `preview-qa-team-${userId}` }
}

/** Explicit synthetic histories. No provider, worker or workflow is started. */
export const init = internalMutation({
  args: {},
  handler: async ctx => {
    const owner = identity()
    await seedPreviewWorkspace(ctx, owner)
    const personalA = await history(ctx, owner, 'personal-a', 50)
    const personalB = await history(ctx, owner, 'personal-b', 50)
    const stream = await history(ctx, owner, 'stream', 2)
    const dm = await history(ctx, owner, 'dm', 1000)
    const agent = await history(ctx, owner, 'agent', 1024)
    return { workspaceId: owner.workspaceId, personalA, personalB, stream, dm, agent }
  },
})

async function history(ctx: MutationCtx, owner: ReturnType<typeof identity>, kind: string, count: number) {
  const clientId = `${PREFIX}-${kind}`
  const existing = await ctx.db.query('conversations')
    .withIndex('by_userId_clientId', q => q.eq('userId', owner.userId).eq('clientId', clientId)).unique()
  if (existing) {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId',
      q => q.eq('conversationId', existing._id).eq('principalId', `${owner.workspaceId}-owner`)).unique()
    if (existing.workspaceId !== owner.workspaceId || existing.deletedAt !== undefined || participant?.archivedAt !== undefined) {
      throw new Error('Performance fixture changed; inspect before reuse')
    }
    const messages = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', existing._id)).take(count + 1)
    if (messages.length !== count || messages.some((message, index) => message.deletedAt !== undefined
      || message.clientNonce !== `${clientId}-message-${index}`
      || (kind !== 'stream' && message.content !== historyText(kind, index, count)))) {
      throw new Error('Performance fixture history changed; inspect before reuse')
    }
    return existing._id
  }
  const now = Date.now()
  const ownerPrincipal = `${owner.workspaceId}-owner`
  const agentId = `${owner.workspaceId}-performance-agent`
  const agentPrincipal = `${agentId}-principal`
  if (kind === 'agent') {
    await ctx.db.insert('workspacePrincipals', {
      principalId: agentPrincipal, workspaceId: owner.workspaceId, type: 'agent', agentId,
      displayName: 'Performance Agent', createdByPrincipalId: ownerPrincipal, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `${agentId}:membership`, workspaceId: owner.workspaceId, principalId: agentPrincipal,
      role: 'member', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId, principalId: agentPrincipal, workspaceId: owner.workspaceId, name: 'Performance Agent',
      instructions: 'Synthetic historical fixture. Do not execute model tasks during performance QA.',
      harness: 'overlay', modelId: MODEL, allowedToolIds: [], invocationPolicy: 'mention', visibility: 'creator',
      createdByPrincipalId: ownerPrincipal, avatarColor: 'blue', avatarShape: 'round', teamIds: [], roomCount: 0,
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: owner.workspaceId, resourceType: 'agent', resourceId: agentId, createdAt: now, updatedAt: now,
    })
  }
  const room = kind === 'dm' || kind === 'agent'
  const conversationId = await ctx.db.insert('conversations', {
    userId: owner.userId, workspaceId: owner.workspaceId, clientId, title: `Performance ${kind}`,
    conversationType: room ? 'dm' : 'personal', ...(kind === 'agent' ? { agentId } : {}),
    createdByPrincipalId: ownerPrincipal, lastMode: 'act', askModelIds: [MODEL], actModelId: MODEL,
    createdAt: now, updatedAt: now, lastModified: now,
  })
  if (room) {
    for (const [principalId, principalType] of [
      [ownerPrincipal, 'human'],
      [kind === 'agent' ? agentPrincipal : `${owner.workspaceId}-member`, kind === 'agent' ? 'agent' : 'human'],
    ] as const) {
      await ctx.db.insert('conversationParticipants', {
        conversationId, workspaceId: owner.workspaceId, principalId, principalType,
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
      })
    }
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: owner.workspaceId, resourceType: 'conversation', resourceId: conversationId, createdAt: now, updatedAt: now,
    })
  }
  for (let index = 0; index < count; index++) {
    const assistant = kind !== 'dm' && index % 2 === 1
    const createdAt = now - (count - index) * 60_000
    await ctx.db.insert('conversationMessages', {
      conversationId, userId: owner.userId, turnId: `${clientId}-${Math.floor(index / (kind === 'dm' ? 1 : 2))}`,
      mode: 'act', role: assistant ? 'assistant' : 'user', contentType: 'text', status: 'completed',
      content: historyText(kind, index, count),
      ...(room ? {
        authorKind: assistant ? 'agent' as const : 'human' as const,
        authorPrincipalId: assistant ? agentPrincipal : kind === 'dm' && index % 2 ? `${owner.workspaceId}-member` : ownerPrincipal,
      } : {}),
      ...(kind === 'dm' && index % 20 === 0 ? {
        parts: [{ type: 'file', url: '/assets/overlay-logo.png', mediaType: 'image/png', fileName: 'Synthetic benchmark image.png' }],
      } : {}),
      clientNonce: `${clientId}-message-${index}`, createdAt, updatedAt: createdAt,
    })
  }
  return conversationId
}

async function streamScope(ctx: MutationCtx, conversationId: Id<'conversations'>) {
  const owner = identity()
  const conversation = await ctx.db.get(conversationId)
  if (!conversation || conversation.userId !== owner.userId || conversation.workspaceId !== owner.workspaceId
    || conversation.clientId !== `${PREFIX}-stream` || conversation.deletedAt !== undefined) {
    throw new Error('Not the configured performance stream fixture')
  }
  const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId',
    q => q.eq('conversationId', conversationId).eq('principalId', `${owner.workspaceId}-owner`)).unique()
  if (participant?.archivedAt !== undefined) throw new Error('Performance stream fixture is archived')
  const messages = await ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', conversationId)).order('asc').take(3)
  if (messages.length !== 2 || messages[0]?.role !== 'user' || messages[1]?.role !== 'assistant'
    || messages.some((message, index) => message.deletedAt !== undefined || message.userId !== owner.userId
      || message.clientNonce !== `${PREFIX}-stream-message-${index}`)) throw new Error('Performance stream history changed')
  return { ...owner, user: messages[0]!, assistant: messages[1]!, runId: `${PREFIX}:${conversationId}` }
}

/** Reuses two fixed rows so repeat runs have identical transcript and sidebar sizes. */
export const startStreaming = internalMutation({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, { conversationId }) => {
    const scope = await streamScope(ctx, conversationId)
    const previous = await ctx.db.query('harnessPublicStreams').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    if (scope.assistant.status === 'generating' || previous?.active) throw new Error('Performance fixture is already streaming')
    const generation = (previous?.executionGeneration ?? 0) + 1
    const workflowRunId = `${scope.runId}:${generation}`
    const now = Date.now()
    const delivery = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_turn_variant', q => q.eq('conversationId', conversationId).eq('turnId', scope.assistant.turnId)).unique()
    const runFields = { status: 'running' as const, workflowRunId, harnessRunId: scope.runId, updatedAt: now }
    const deliveryId = delivery?._id ?? await ctx.db.insert('conversationAgentRuns', {
      ...runFields, conversationId, turnId: scope.assistant.turnId, userId: scope.userId,
      userMessageId: scope.user._id, assistantMessageId: scope.assistant._id,
      mode: 'chat', runner: 'workflow', executionEngine: 'overlay_harness', createdAt: now,
    })
    if (delivery) await ctx.db.patch(delivery._id, { ...runFields, completedAt: undefined })
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    const snapshot = createHarnessSnapshot({ runId: scope.runId, goal: 'Replay the synthetic public-stream fixture.',
      constraints: [], policy: { actorUserId: scope.userId, workspaceId: scope.workspaceId,
        allowedToolIds: [], requiresPlan: false, deadlineAt: now + 60_000,
        maxCostMicros: 0, maxParallelChildren: 1, maxDepth: 1, publicStreamVersion: 1 } }, now)
    const metadataJson = JSON.stringify({ ...snapshot, workflowRunId, executionGeneration: generation,
      modelReservation: { id: 'model:0', maxCostMicros: 0, dispatch: { modelId: MODEL, billingReservationId: null } } })
    if (run) await ctx.db.patch(run._id, { metadataJson, updatedAt: now })
    else await ctx.db.insert('harnessRuns', {
      runId: scope.runId, rootRunId: scope.runId, actorUserId: scope.userId, deliveryAgentRunId: deliveryId,
      activeDescendantCount: 0, sourceJson: JSON.stringify({ conversationId }),
      admissionJson: JSON.stringify({ runId: scope.runId, goal: snapshot.goal, constraints: [], policy: snapshot.policy,
        source: { conversationId }, deliveryAgentRunId: deliveryId }), metadataJson,
      createdAt: now, updatedAt: now,
    })
    const fields = { runId: scope.runId, workflowRunId, executionGeneration: generation, receiptId: 'model:0',
      invocation: 0, conversationId, assistantMessageId: scope.assistant._id, nextSequence: 0, lastSequence: -1,
      lastText: '', nextSegmentIndex: 1, visibleCharacters: 0, truncated: false, active: true, updatedAt: now }
    if (previous) await ctx.db.patch(previous._id, fields)
    else await ctx.db.insert('harnessPublicStreams', fields)
    const segment = await ctx.db.query('harnessPublicStreamSegments').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    const segmentFields = { runId: scope.runId, workflowRunId, executionGeneration: generation, receiptId: 'model:0',
      segmentIndex: 0, firstSequence: 0, lastSequence: -1, text: '', updatedAt: now }
    if (segment) await ctx.db.patch(segment._id, segmentFields)
    else await ctx.db.insert('harnessPublicStreamSegments', { ...segmentFields, createdAt: now })
    await ctx.db.patch(scope.assistant._id, { content: '', status: 'generating', publicStreamCheckpoint: undefined, updatedAt: now })
    await ctx.scheduler.runAfter(INTERVAL_MS, tickReference, { conversationId, generation, step: 1 })
    return { conversationId, generation }
  },
})

export const tick = internalMutation({
  args: { conversationId: v.id('conversations'), generation: v.number(), step: v.number() },
  handler: async (ctx, { conversationId, generation, step }) => {
    const scope = await streamScope(ctx, conversationId)
    if (!Number.isSafeInteger(step) || step < 1 || step > STEPS) throw new Error('Invalid performance stream step')
    const stream = await ctx.db.query('harnessPublicStreams').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    if (!stream?.active || stream.executionGeneration !== generation || scope.assistant.status !== 'generating'
      || stream.nextSequence !== step - 1) return
    const now = Date.now()
    const text = streamText(step)
    const segment = await ctx.db.query('harnessPublicStreamSegments').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    if (!segment) throw new Error('Performance stream segment missing')
    await ctx.db.patch(segment._id, { text, lastSequence: step - 1, updatedAt: now })
    await ctx.db.patch(stream._id, { nextSequence: step, lastSequence: step - 1, lastText: text,
      visibleCharacters: text.length, active: step < STEPS, updatedAt: now })
    if (step < STEPS) {
      await ctx.scheduler.runAfter(INTERVAL_MS, tickReference, { conversationId, generation, step: step + 1 })
      return
    }
    await ctx.db.patch(scope.assistant._id, { content: text, status: 'completed', updatedAt: now })
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', scope.runId)).unique()
    if (run) await ctx.db.patch(run._id, { metadataJson: JSON.stringify({ ...JSON.parse(run.metadataJson),
      status: 'completed', modelReservation: undefined, updatedAt: now }), updatedAt: now })
    const delivery = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_turn_variant', q => q.eq('conversationId', conversationId).eq('turnId', scope.assistant.turnId)).unique()
    if (delivery) await ctx.db.patch(delivery._id, { status: 'completed', completedAt: now, updatedAt: now })
  },
})
