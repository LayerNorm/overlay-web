import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { internalMutation, mutation, query } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { applyStorageUsageDelta } from '../files/lib/storageQuota'

const generatedUiVariant = v.object({
  id: v.string(),
  label: v.string(),
  subject: v.optional(v.string()),
  body: v.string(),
})

const generatedUiData = v.union(
  v.object({
    version: v.literal(1),
    kind: v.literal('draft.text'),
    title: v.optional(v.string()),
    body: v.string(),
    format: v.optional(v.union(v.literal('plain'), v.literal('markdown'))),
  }),
  v.object({
    version: v.literal(1),
    kind: v.literal('draft.email'),
    subject: v.string(),
    body: v.string(),
    to: v.optional(v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    provider: v.optional(v.literal('gmail')),
    variants: v.optional(v.array(generatedUiVariant)),
  }),
  v.object({
    version: v.literal(1),
    kind: v.literal('connector.connect'),
    serviceName: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    connectUrl: v.optional(v.string()),
    connected: v.optional(v.boolean()),
  }),
)

/** Matches AI SDK UI parts we persist; `tool-invocation` restores tool chips after reload. */
const messagePart = v.union(
  v.object({
    type: v.literal('data'),
    id: v.string(),
    dataType: v.literal('overlay.generated_ui'),
    data: generatedUiData,
    transient: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal('tool-invocation'),
    toolInvocation: v.object({
      toolCallId: v.optional(v.string()),
      toolName: v.string(),
      state: v.optional(v.string()),
      toolInput: v.optional(v.any()),
      toolOutput: v.optional(v.any()),
    }),
  }),
  v.object({
    type: v.string(),
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    fileName: v.optional(v.string()),
    state: v.optional(v.string()),
  }),
)

const messageParts = v.optional(v.array(messagePart))

const agentRunStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('waiting_for_approval'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
)

const agentRunMetrics = v.object({
  firstTokenAt: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  providerCostMicros: v.optional(v.number()),
  workflowStepCount: v.optional(v.number()),
  workflowRetryCount: v.optional(v.number()),
  workflowObservedStorageBytes: v.optional(v.number()),
  toolCallCount: v.optional(v.number()),
  toolSuccessCount: v.optional(v.number()),
  toolFailureCount: v.optional(v.number()),
  toolRetryCount: v.optional(v.number()),
  browserDisconnectedAt: v.optional(v.number()),
  browserReconnectedAt: v.optional(v.number()),
  processFailureDetectedAt: v.optional(v.number()),
  processFailureRecoveredAt: v.optional(v.number()),
  cancellationRequestedAt: v.optional(v.number()),
  cancellationAcknowledgedAt: v.optional(v.number()),
  staleDetectedAt: v.optional(v.number()),
})

const ACTIVE_AGENT_RUN_STATUSES = new Set(['queued', 'running', 'waiting_for_approval'])
const AGENT_RUN_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  queued: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['waiting_for_approval', 'completed', 'failed', 'cancelled']),
  waiting_for_approval: new Set(['running', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

function assertAgentRunTransition(from: string, to: string): void {
  if (!AGENT_RUN_TRANSITIONS[from]?.has(to)) {
    throw new Error(`Invalid AgentRun transition: ${from} -> ${to}`)
  }
}

function isGeneratedUiPart(candidate: MessagePart): candidate is Extract<MessagePart, { dataType: 'overlay.generated_ui' }> {
  return candidate.type === 'data' && 'dataType' in candidate && candidate.dataType === 'overlay.generated_ui'
}

function clampAskModels(ids: string[]): string[] {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (uniq.length === 0) return [DEFAULT_MODEL_ID]
  return uniq.slice(0, 4)
}

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function normalizeConversationDoc<T extends {
  updatedAt?: number
  lastModified: number
  createdAt: number
}>(conversation: T): T & { updatedAt: number } {
  return {
    ...conversation,
    updatedAt: conversation.updatedAt ?? conversation.lastModified ?? conversation.createdAt,
  }
}

async function getLinkedAutomationConversationIds(
  ctx: Pick<QueryCtx, 'db'>,
  userId: string,
  projectId?: string,
): Promise<Set<string>> {
  const automations = projectId
    ? await ctx.db
      .query('automations')
      .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
      .collect()
    : await ctx.db
      .query('automations')
      .withIndex('by_userId_updatedAt', (q) => q.eq('userId', userId))
      .collect()
  const ids = new Set<string>()
  for (const automation of automations) {
    if (automation.userId !== userId || automation.deletedAt) continue
    if (automation.sourceConversationId) ids.add(automation.sourceConversationId)
    if (automation.conversationId) ids.add(automation.conversationId)
  }
  return ids
}

type MessageDoc = Doc<'conversationMessages'>
type MessagePart = NonNullable<MessageDoc['parts']>[number]
type MessageParts = NonNullable<MessageDoc['parts']>
const MAX_HISTORY_TOOL_VALUE_CHARS = 1000

function sameMessageVariant(
  message: MessageDoc,
  args: {
    turnId: string
    role: 'user' | 'assistant'
    variantIndex?: number
    modelId?: string
  },
): boolean {
  if (message.turnId !== args.turnId || message.role !== args.role) return false
  if ((message.variantIndex ?? 0) !== (args.variantIndex ?? 0)) return false
  if (args.role !== 'assistant') return true
  if (!message.modelId || !args.modelId) return true
  return message.modelId === args.modelId
}

function isToolInvocationPart(
  candidate: MessagePart,
): candidate is Extract<MessagePart, { toolInvocation: unknown }> {
  return 'toolInvocation' in candidate
}

function stringifyForHistory(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compactToolValueForHistory(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const serialized = stringifyForHistory(value)
  if (serialized.length <= MAX_HISTORY_TOOL_VALUE_CHARS) return value
  return {
    truncated: true,
    summary: `${serialized.slice(0, MAX_HISTORY_TOOL_VALUE_CHARS).trimEnd()}\n\n[truncated ${serialized.length - MAX_HISTORY_TOOL_VALUE_CHARS} chars for history]`,
  }
}

function compactPartsForHistory(parts: MessageParts): MessageParts {
  return parts.map((part) => {
    if (!isToolInvocationPart(part)) return part
    return {
      ...part,
      toolInvocation: {
        ...part.toolInvocation,
        toolInput: compactToolValueForHistory(part.toolInvocation.toolInput),
        toolOutput: compactToolValueForHistory(part.toolInvocation.toolOutput),
      },
    }
  })
}

function compactMessageForHistory(message: MessageDoc, compactToolPayloads?: boolean): MessageDoc {
  if (!compactToolPayloads || !Array.isArray(message.parts)) return message
  return {
    ...message,
    parts: compactPartsForHistory(message.parts),
  }
}

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    beforeLastModified: v.optional(v.number()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, updatedSince, includeDeleted, limit, beforeLastModified }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const pageLimit = Math.min(100, Math.max(1, Math.floor(limit ?? 100)))
    // Over-fetch by 3x to account for in-memory filters (projectId, isAutomation,
    // automation-linked, deletedAt, workspaceId).  This is still far less than
    // the previous take(200) → slice(100) pattern.
    const scanLimit = Math.min(300, Math.max(pageLimit * 3, 100))
    const [all, automationConversationIds] = await Promise.all([
      ctx.db
        .query('conversations')
        .withIndex('by_userId_lastModified', (q) => {
          const scoped = q.eq('userId', userId)
          return beforeLastModified !== undefined && Number.isFinite(beforeLastModified)
            ? scoped.lt('lastModified', beforeLastModified)
            : scoped
        })
        .order('desc')
        .take(scanLimit),
      getLinkedAutomationConversationIds(ctx, userId),
    ])
    return all
      .map(normalizeConversationDoc)
      .filter((c) => !c.projectId)
      .filter((c) => !c.isAutomation)
      .filter((c) => !automationConversationIds.has(c._id))
      .filter((c) => (updatedSince !== undefined ? c.updatedAt > updatedSince : true))
      .filter((c) => (includeDeleted ? true : !c.deletedAt))
      .filter((c) => (workspaceId !== undefined ? c.workspaceId === workspaceId : true))
      .slice(0, pageLimit)
  },
})

export const listByProject = query({
  args: {
    projectId: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, userId, workspaceId, accessToken, serverSecret, updatedSince, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const [conversations, automationConversationIds] = await Promise.all([
      ctx.db
        .query('conversations')
        .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
        .order('desc')
        .collect(),
      getLinkedAutomationConversationIds(ctx, userId, projectId),
    ])
    return conversations
      .map(normalizeConversationDoc)
      .filter((conversation) => conversation.userId === userId)
      .filter((conversation) => !conversation.isAutomation)
      .filter((conversation) => !automationConversationIds.has(conversation._id))
      .filter((conversation) => (updatedSince !== undefined ? conversation.updatedAt > updatedSince : true))
      .filter((conversation) => (includeDeleted ? true : !conversation.deletedAt))
      .filter((conversation) => (workspaceId !== undefined ? conversation.workspaceId === workspaceId : true))
      .sort((a, b) => (b.lastModified ?? b.createdAt) - (a.lastModified ?? a.createdAt))
  },
})

export const get = query({
  args: { conversationId: v.id('conversations'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const conversation = await ctx.db.get(conversationId)
    return conversation?.userId === userId && !conversation.deletedAt && (workspaceId === undefined || conversation.workspaceId === workspaceId)
      ? normalizeConversationDoc(conversation)
      : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    clientId: v.optional(v.string()),
    title: v.string(),
    projectId: v.optional(v.string()),
    askModelIds: v.optional(v.array(v.string())),
    actModelId: v.optional(v.string()),
    lastMode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
    isAutomation: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, clientId, title, projectId, askModelIds, actModelId, lastMode, isAutomation }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    if (clientId?.trim()) {
      const existing = await ctx.db
        .query('conversations')
        .withIndex('by_userId_clientId', (q) => q.eq('userId', userId).eq('clientId', clientId.trim()))
        .first()
      if (existing) {
        return existing._id
      }
    }
    if (projectId) {
      const project = await ctx.db.get(projectId as Id<'projects'>)
      if (!project || project.userId !== userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const ask = clampAskModels(askModelIds ?? [DEFAULT_MODEL_ID])
    const act = actModelId?.trim() || ask[0] || DEFAULT_MODEL_ID
    const now = Date.now()
    return await ctx.db.insert('conversations', {
      userId,
      workspaceId,
      clientId: clientId?.trim() || undefined,
      title,
      projectId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
      lastMode: lastMode ?? 'act',
      askModelIds: ask,
      actModelId: act,
      isAutomation: isAutomation ?? false,
    })
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    conversationId: v.id('conversations'),
    title: v.optional(v.string()),
    projectId: v.optional(v.string()),
    askModelIds: v.optional(v.array(v.string())),
    actModelId: v.optional(v.string()),
    lastMode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, conversationId, title, projectId, askModelIds, actModelId, lastMode }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt || (workspaceId !== undefined && conversation.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    if (projectId !== undefined && projectId !== null) {
      const project = await ctx.db.get(projectId as Id<'projects'>)
      if (!project || project.userId !== userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    const updates: Record<string, unknown> = { lastModified: now, updatedAt: now }
    if (title !== undefined) updates.title = title
    if (projectId !== undefined) updates.projectId = projectId || undefined
    if (askModelIds !== undefined) updates.askModelIds = clampAskModels(askModelIds)
    if (actModelId !== undefined) updates.actModelId = actModelId
    if (lastMode !== undefined) updates.lastMode = lastMode
    await ctx.db.patch(conversationId, updates)
  },
})

export const remove = mutation({
  args: { conversationId: v.id('conversations'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt || (workspaceId !== undefined && conversation.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    await ctx.db.patch(conversationId, {
      deletedAt: now,
      updatedAt: now,
      lastModified: now,
    })
  },
})

export const getMessages = query({
  args: { conversationId: v.id('conversations'), userId: v.string(), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      return []
    }
    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .collect()
    return messages
  },
})

export const getRecentMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
    beforeCreatedAt: v.optional(v.number()),
    compactToolPayloads: v.optional(v.boolean()),
  },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret, limit, beforeCreatedAt, compactToolPayloads }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      return []
    }

    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit ?? 10)))
    const boundedBeforeCreatedAt =
      beforeCreatedAt !== undefined && Number.isFinite(beforeCreatedAt)
        ? beforeCreatedAt
        : undefined
    const scanLimit = Math.min(500, Math.max(safeLimit * 12, 100))
    const recentScan = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_createdAt', (q) => {
        const scoped = q.eq('conversationId', conversationId)
        return boundedBeforeCreatedAt === undefined
          ? scoped
          : scoped.lt('createdAt', boundedBeforeCreatedAt)
      })
      .order('desc')
      .take(scanLimit)
    const selectedTurnIds: string[] = []
    for (const message of recentScan) {
      if (message.role !== 'user') continue
      const turnId = message.turnId?.trim() || message._id
      if (selectedTurnIds.includes(turnId)) continue
      selectedTurnIds.push(turnId)
      if (selectedTurnIds.length >= safeLimit) break
    }
    const selectedTurnIdSet = new Set(selectedTurnIds)
    const messages = recentScan
      .filter((message) => selectedTurnIdSet.has(message.turnId?.trim() || message._id))
      .sort((a, b) => a.createdAt - b.createdAt)
    return messages.map((message) => compactMessageForHistory(message, compactToolPayloads))
  },
})

export const getContextSummary = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    serverSecret: v.string(),
    scope: v.string(),
  },
  handler: async (ctx, { conversationId, userId, serverSecret, scope }) => {
    await authorizeUserAccess({ userId, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      return null
    }
    return await ctx.db
      .query('conversationContextSummaries')
      .withIndex('by_conversationId_scope', (q) =>
        q.eq('conversationId', conversationId).eq('scope', scope)
      )
      .first()
  },
})

export const upsertContextSummary = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    serverSecret: v.string(),
    scope: v.string(),
    summary: v.string(),
    summarizedThroughMessageId: v.optional(v.string()),
    summarizedThroughCreatedAt: v.optional(v.number()),
    sourceMessageCount: v.number(),
    sourceEstimatedTokens: v.number(),
    summaryEstimatedTokens: v.number(),
    contextWindow: v.number(),
    targetModelId: v.string(),
    summarizerModelId: v.string(),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({ userId: args.userId, serverSecret: args.serverSecret })
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    const existing = await ctx.db
      .query('conversationContextSummaries')
      .withIndex('by_conversationId_scope', (q) =>
        q.eq('conversationId', args.conversationId).eq('scope', args.scope)
      )
      .first()
    const payload = {
      conversationId: args.conversationId,
      userId: args.userId,
      scope: args.scope,
      summary: args.summary,
      summarizedThroughMessageId: args.summarizedThroughMessageId,
      summarizedThroughCreatedAt: args.summarizedThroughCreatedAt,
      sourceMessageCount: args.sourceMessageCount,
      sourceEstimatedTokens: args.sourceEstimatedTokens,
      summaryEstimatedTokens: args.summaryEstimatedTokens,
      contextWindow: args.contextWindow,
      targetModelId: args.targetModelId,
      summarizerModelId: args.summarizerModelId,
      updatedAt: now,
    }
    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return existing._id
    }
    return await ctx.db.insert('conversationContextSummaries', {
      ...payload,
      createdAt: now,
    })
  },
})

export const addMessage = mutation({
  args: {
    billingAccountId: v.optional(v.string()),
    billingActorUserId: v.optional(v.string()),
    billingSpendSubjectId: v.optional(v.string()),
    billingSpendSubjectKind: v.optional(v.union(v.literal('member'), v.literal('programmatic'))),
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    turnId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    mode: v.union(v.literal('ask'), v.literal('act')),
    content: v.string(),
    contentType: v.union(v.literal('text'), v.literal('image'), v.literal('video')),
    parts: messageParts,
    modelId: v.optional(v.string()),
    variantIndex: v.optional(v.number()),
    tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
    replyToTurnId: v.optional(v.string()),
    replySnippet: v.optional(v.string()),
    routedModelId: v.optional(v.string()),
    skipMemoryExtraction: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const existing = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const match = existing.find(
      (message) => sameMessageVariant(message, {
        turnId: args.turnId,
        role: args.role,
        variantIndex: args.variantIndex,
        modelId: args.modelId,
      }),
    )
    const now = Date.now()
    const payload = {
      conversationId: args.conversationId,
      userId: args.userId,
      turnId: args.turnId,
      role: args.role,
      mode: args.mode,
      content: args.content,
      contentType: args.contentType,
      parts: args.parts,
      modelId: args.modelId,
      variantIndex: args.variantIndex,
      tokens: args.tokens,
      replyToTurnId: args.replyToTurnId,
      replySnippet: args.replySnippet,
      routedModelId: args.routedModelId,
      status: 'completed' as const,
      updatedAt: now,
      createdAt: match?.createdAt ?? now,
    }
    const msgId = match
      ? (await ctx.db.patch(match._id, payload), match._id)
      : await ctx.db.insert('conversationMessages', payload)
    await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })

	    if (args.role === 'user' && args.skipMemoryExtraction !== true) {
	      try {
	        const subscription = await ctx.db
	          .query('subscriptions')
	          .withIndex('by_userId', (q) => q.eq('userId', args.userId))
	          .first()
	        const isPaid = subscription ? subscription.tier !== 'free' : false
	        const today = new Date().toISOString().split('T')[0]
	        let dailyUsage = await ctx.db
	          .query('dailyUsage')
	          .withIndex('by_userId_date', (q) => q.eq('userId', args.userId).eq('date', today))
	          .first()
	        if (!dailyUsage) {
	          const dailyUsageId = await ctx.db.insert('dailyUsage', {
	            userId: args.userId,
	            date: today,
	            askCount: 0,
	            agentCount: 0,
	            writeCount: 0,
	            transcriptionSeconds: 0,
	            memoryExtractionCount: 0,
	          })
	          dailyUsage = await ctx.db.get(dailyUsageId)
	        }
	        if ((dailyUsage?.memoryExtractionCount ?? 0) >= 120) {
	          return msgId
	        }
	        if (dailyUsage) {
	          await ctx.db.patch(dailyUsage._id, {
	            memoryExtractionCount: (dailyUsage.memoryExtractionCount ?? 0) + 1,
	          })
	        }

	        await ctx.scheduler.runAfter(0, internal.knowledge.memoryExtractorNode.extractFromTurn, {
	          billingAccountId: args.billingAccountId,
	          billingActorUserId: args.billingActorUserId,
	          billingSpendSubjectId: args.billingSpendSubjectId,
	          billingSpendSubjectKind: args.billingSpendSubjectKind,
	          conversationId: args.conversationId,
          workspaceId: conversation.workspaceId,
          turnId: args.turnId,
          userId: args.userId,
          isPaid,
        })
      } catch {
        // best-effort: extraction failure should not block message save
      }
    }

    return msgId
  },
})

export const startAgentRun = mutation({
  args: {
    conversationId: v.id('conversations'),
    leaseExpiresAt: v.optional(v.number()),
    mode: v.union(v.literal('chat'), v.literal('work')),
    modelId: v.string(),
    runner: v.union(v.literal('tool_loop'), v.literal('workflow')),
    serverSecret: v.string(),
    turnId: v.string(),
    userId: v.string(),
    userMessageId: v.id('conversationMessages'),
    variantIndex: v.optional(v.number()),
    workflowRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const conversation = await ctx.db.get(args.conversationId)
    const userMessage = await ctx.db.get(args.userMessageId)
    if (
      !conversation || conversation.userId !== args.userId || conversation.deletedAt ||
      !userMessage || userMessage.conversationId !== args.conversationId ||
      userMessage.userId !== args.userId || userMessage.turnId !== args.turnId ||
      userMessage.role !== 'user'
    ) {
      throw new Error('Unauthorized')
    }

    const existing = await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_turn_variant', (q) => q
        .eq('conversationId', args.conversationId)
        .eq('turnId', args.turnId)
        .eq('variantIndex', args.variantIndex))
      .unique()
    if (existing) return existing

    const now = Date.now()
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId,
      userId: args.userId,
      turnId: args.turnId,
      role: 'assistant',
      mode: 'act',
      content: '',
      contentType: 'text',
      parts: [{ type: 'text', text: '' }],
      modelId: args.modelId,
      variantIndex: args.variantIndex,
      status: 'generating',
      updatedAt: now,
      createdAt: now,
    })
    const runId = await ctx.db.insert('conversationAgentRuns', {
      conversationId: args.conversationId,
      turnId: args.turnId,
      userId: args.userId,
      userMessageId: args.userMessageId,
      assistantMessageId,
      mode: args.mode,
      runner: args.runner,
      status: 'queued',
      variantIndex: args.variantIndex,
      workflowRunId: args.workflowRunId,
      leaseExpiresAt: args.leaseExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    return await ctx.db.get(runId)
  },
})

export const transitionAgentRun = mutation({
  args: {
    approval: v.optional(v.object({
      token: v.string(),
      requestedAt: v.number(),
      requests: v.array(v.object({
        approvalId: v.string(),
        toolCallId: v.string(),
        toolName: v.string(),
        input: v.any(),
      })),
    })),
    leaseExpiresAt: v.optional(v.number()),
    runId: v.id('conversationAgentRuns'),
    serverSecret: v.string(),
    status: agentRunStatus,
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) throw new Error('Unauthorized')
    assertAgentRunTransition(run.status, args.status)
    const now = Date.now()
    await ctx.db.patch(run._id, {
      status: args.status,
      leaseExpiresAt: args.leaseExpiresAt ?? run.leaseExpiresAt,
      startedAt: args.status === 'running' ? (run.startedAt ?? now) : run.startedAt,
      approval: args.status === 'waiting_for_approval' ? args.approval : undefined,
      updatedAt: now,
    })
    return await ctx.db.get(run._id)
  },
})

export const attachAgentRunWorkflow = mutation({
  args: {
    runId: v.id('conversationAgentRuns'),
    serverSecret: v.string(),
    userId: v.string(),
    workflowRunId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) throw new Error('Unauthorized')
    if (run.workflowRunId && run.workflowRunId !== args.workflowRunId) {
      throw new Error('AgentRun is already attached to another workflow')
    }
    if (run.status !== 'queued' && run.status !== 'running') return run
    const now = Date.now()
    await ctx.db.patch(run._id, {
      workflowRunId: args.workflowRunId,
      status: 'running',
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    })
    return await ctx.db.get(run._id)
  },
})

export const completeAgentRun = mutation({
  args: {
    content: v.string(),
    parts: v.array(messagePart),
    routedModelId: v.optional(v.string()),
    runId: v.id('conversationAgentRuns'),
    serverSecret: v.string(),
    tokens: v.object({ input: v.number(), output: v.number() }),
    userId: v.string(),
    metrics: v.optional(agentRunMetrics),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) throw new Error('Unauthorized')
    if (!ACTIVE_AGENT_RUN_STATUSES.has(run.status)) return run
    assertAgentRunTransition(run.status, 'completed')
    const now = Date.now()
    const message = await ctx.db.get(run.assistantMessageId)
    if (message?.status === 'generating') {
      await ctx.db.patch(message._id, {
        content: args.content,
        parts: args.parts,
        routedModelId: args.routedModelId,
        tokens: args.tokens,
        status: 'completed',
        updatedAt: now,
      })
    }
    await ctx.db.patch(run._id, {
      status: 'completed',
      completedAt: now,
      leaseExpiresAt: undefined,
      metrics: { ...run.metrics, ...args.metrics },
      updatedAt: now,
    })
    await ctx.db.patch(run.conversationId, { lastModified: now, updatedAt: now })
    return await ctx.db.get(run._id)
  },
})

export const failAgentRun = mutation({
  args: {
    error: v.object({ code: v.string(), message: v.string(), retryable: v.boolean() }),
    errorText: v.string(),
    runId: v.id('conversationAgentRuns'),
    serverSecret: v.string(),
    userId: v.string(),
    metrics: v.optional(agentRunMetrics),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) throw new Error('Unauthorized')
    if (!ACTIVE_AGENT_RUN_STATUSES.has(run.status)) return run
    assertAgentRunTransition(run.status, 'failed')
    const now = Date.now()
    const message = await ctx.db.get(run.assistantMessageId)
    if (message?.status === 'generating') {
      await ctx.db.patch(message._id, {
        content: args.errorText,
        parts: [{ type: 'text', text: args.errorText }],
        status: 'error',
        updatedAt: now,
      })
    }
    await ctx.db.patch(run._id, {
      status: 'failed',
      failedAt: now,
      leaseExpiresAt: undefined,
      terminalError: args.error,
      metrics: { ...run.metrics, ...args.metrics },
      updatedAt: now,
    })
    await ctx.db.patch(run.conversationId, { lastModified: now, updatedAt: now })
    return await ctx.db.get(run._id)
  },
})

export const getLatestAgentRun = query({
  args: {
    conversationId: v.id('conversations'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const active: Doc<'conversationAgentRuns'>[] = []
    for (const status of ['queued', 'running', 'waiting_for_approval'] as const) {
      const run = await ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_conversationId_status_updatedAt', (q) => q
          .eq('conversationId', args.conversationId)
          .eq('status', status))
        .order('desc')
        .first()
      if (run) active.push(run)
    }
    if (active.length > 0) {
      return active.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    }
    return await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .order('desc')
      .first()
  },
})

export const recordAgentRunMetrics = mutation({
  args: {
    metrics: agentRunMetrics,
    runId: v.id('conversationAgentRuns'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) throw new Error('Unauthorized')
    await ctx.db.patch(run._id, {
      metrics: { ...run.metrics, ...args.metrics },
      updatedAt: Date.now(),
    })
    return await ctx.db.get(run._id)
  },
})

export const listAgentRunsForMetrics = query({
  args: {
    from: v.number(),
    limit: v.number(),
    serverSecret: v.string(),
    to: v.number(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    return await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_userId_createdAt', (q) => q
        .eq('userId', args.userId)
        .gte('createdAt', args.from)
        .lte('createdAt', args.to))
      .order('desc')
      .take(Math.min(3_001, Math.max(1, Math.floor(args.limit))))
  },
})

export const cancelAgentRuns = mutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.optional(v.id('conversationMessages')),
    partialContent: v.optional(v.string()),
    partialParts: v.optional(v.array(messagePart)),
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const runs = await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const activeRuns = runs.filter((run) =>
      ACTIVE_AGENT_RUN_STATUSES.has(run.status) &&
      (!args.messageId || run.assistantMessageId === args.messageId),
    )
    const now = Date.now()
    const sentinel = '\n\n[Interrupted by user. Continue?]'
    for (const run of activeRuns) {
      assertAgentRunTransition(run.status, 'cancelled')
      const message = await ctx.db.get(run.assistantMessageId)
      if (message?.status === 'generating') {
        const baseContent = args.partialContent ?? message.content
        const baseParts = args.partialParts?.length
          ? args.partialParts
          : message.parts ?? [{ type: 'text', text: baseContent }]
        await ctx.db.patch(message._id, {
          content: `${baseContent.trimEnd()}${sentinel}`,
          parts: [...baseParts, { type: 'text', text: sentinel }],
          status: 'completed',
          updatedAt: now,
        })
      }
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        cancelledAt: now,
        leaseExpiresAt: undefined,
        terminalError: {
          code: 'cancelled_by_user',
          message: 'The run was cancelled by the user.',
          retryable: true,
        },
        metrics: {
          ...run.metrics,
          cancellationRequestedAt: now,
        },
        updatedAt: now,
      })
    }
    if (activeRuns.length > 0) {
      await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    }
    return {
      cancelledRunIds: activeRuns.map((run) => run._id),
      cancelledWorkflowRunIds: activeRuns.flatMap((run) => run.workflowRunId ? [run.workflowRunId] : []),
      cancelledWorkflows: activeRuns.flatMap((run) => run.workflowRunId
        ? [{ agentRunId: run._id, workflowRunId: run.workflowRunId }]
        : []),
      stoppedCount: activeRuns.length,
    }
  },
})

export const updateMessageUiPart = mutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    partId: v.string(),
    data: generatedUiData,
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const message = await ctx.db.get(args.messageId)
    if (
      !message ||
      message.conversationId !== args.conversationId ||
      message.userId !== args.userId ||
      message.role !== 'assistant'
    ) {
      throw new Error('Message not found')
    }
    const parts = Array.isArray(message.parts) ? message.parts : []
    let changed = false
    const nextParts = parts.map((part) => {
      if (isGeneratedUiPart(part) && part.id === args.partId) {
        changed = true
        return {
          ...part,
          data: args.data,
        }
      }
      return part
    })
    if (!changed) throw new Error('Generated UI part not found')
    const now = Date.now()
    await ctx.db.patch(args.messageId, {
      parts: nextParts,
      updatedAt: now,
    })
    await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    return { success: true }
  },
})

export const expireToolLoopAgentRunLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const expired = []
    for (const status of ['queued', 'running', 'waiting_for_approval'] as const) {
      const remaining = 100 - expired.length
      if (remaining <= 0) break
      const rows = await ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_runner_status_leaseExpiresAt', (q) => q
          .eq('runner', 'tool_loop')
          .eq('status', status)
          .lt('leaseExpiresAt', now))
        .take(remaining)
      expired.push(...rows)
    }

    const errorText = 'Generation was interrupted because the chat process stopped before completion.'
    for (const run of expired) {
      if (!AGENT_RUN_TRANSITIONS[run.status]?.has('failed')) continue
      const message = await ctx.db.get(run.assistantMessageId)
      if (message?.status === 'generating') {
        await ctx.db.patch(message._id, {
          content: errorText,
          parts: [{ type: 'text', text: errorText }],
          status: 'error',
          updatedAt: now,
        })
      }
      await ctx.db.patch(run._id, {
        status: 'failed',
        failedAt: now,
        leaseExpiresAt: undefined,
        terminalError: {
          code: 'tool_loop_lease_expired',
          message: errorText,
          retryable: true,
        },
        metrics: {
          ...run.metrics,
          processFailureDetectedAt: now,
          staleDetectedAt: now,
        },
        updatedAt: now,
      })
      await ctx.db.patch(run.conversationId, { lastModified: now, updatedAt: now })
    }
    return { expiredCount: expired.length }
  },
})

/**
 * Removes conversations that were created but never received a single message. The chat
 * UI creates a conversation row optimistically when the user opens the new-chat surface;
 * if the user navigates away without sending anything, that row would otherwise sit in
 * the sidebar forever and waste storage. We only target conversations older than 1 hour
 * with zero `conversationMessages` rows, so any chat with even one user/assistant turn
 * is preserved.
 */
export const runEmptyConversationCleanup = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    complete: v.boolean(),
    skipped: v.boolean(),
  }),
  handler: async (ctx) => {
    const stateKey = 'empty-conversation-cleanup-v1'
    const now = Date.now()
    const thresholdMs = 60 * 60 * 1000
    const state = await ctx.db.query('maintenanceCursors')
      .withIndex('by_key', (q) => q.eq('key', stateKey))
      .unique()
    if (state?.nextRunAt && state.nextRunAt > now) {
      return { deleted: 0, scanned: 0, complete: true, skipped: true }
    }

    const cutoff = state?.cutoff && state.cutoff > 0
      ? state.cutoff
      : now - thresholdMs
    const page = await ctx.db.query('conversations')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .order('asc')
      .paginate({ cursor: state?.cursor ?? null, numItems: 50 })
    let deleted = 0
    for (const conversation of page.page) {
      if (conversation.deletedAt) continue
      const firstMessage = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
        .first()
      if (firstMessage) continue
      await ctx.db.delete(conversation._id)
      deleted++
    }

    const nextState = page.isDone
      ? { key: stateKey, cursor: undefined, cutoff: 0, nextRunAt: now + 6 * 60 * 60 * 1000, updatedAt: now }
      : { key: stateKey, cursor: page.continueCursor, cutoff, nextRunAt: undefined, updatedAt: now }
    if (state) await ctx.db.patch(state._id, nextState)
    else await ctx.db.insert('maintenanceCursors', nextState)

    return {
      deleted,
      scanned: page.page.length,
      complete: page.isDone,
      skipped: false,
    }
  },
})

export const watchMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { conversationId, userId, accessToken, limit }) => {
    try {
      await authorizeUserAccess({ userId, accessToken })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) return []
    // When a limit is provided, only watch the most recent N messages (the
    // "tail").  This prevents loading the entire transcript for long
    // conversations.  Older messages are loaded on demand via getRecentMessages.
    const messageLimit = limit !== undefined ? Math.min(500, Math.max(1, Math.floor(limit))) : undefined
    if (messageLimit !== undefined) {
      const recent = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', conversationId))
        .order('desc')
        .take(messageLimit)
      return recent.sort((a, b) => a.createdAt - b.createdAt)
    }
    return await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .collect()
  },
})

/**
 * Live subscription query for the latest AgentRun for a conversation.
 * Uses accessToken auth (same pattern as watchMessages) so the client can
 * subscribe via useQuery and get realtime updates without HTTP polling.
 */
export const watchAgentRun = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, { conversationId, userId, accessToken }) => {
    try {
      await authorizeUserAccess({ userId, accessToken })
    } catch {
      return null
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) return null

    // Check for active runs first (queued, running, waiting_for_approval).
    const activeStatuses = ['queued', 'running', 'waiting_for_approval'] as const
    const active: Doc<'conversationAgentRuns'>[] = []
    for (const status of activeStatuses) {
      const run = await ctx.db
        .query('conversationAgentRuns')
        .withIndex('by_conversationId_status_updatedAt', (q) => q
          .eq('conversationId', conversationId)
          .eq('status', status))
        .order('desc')
        .first()
      if (run) active.push(run)
    }
    if (active.length > 0) {
      return active.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    }
    // Fall back to the most recently created run (terminal state).
    return await ctx.db
      .query('conversationAgentRuns')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', conversationId))
      .order('desc')
      .first()
  },
})

/** Batch insert for Ask multi-model assistant variants (same turn). */
/** Remove one user turn and all associated assistant variants (same turnId), plus matching outputs. */
export const deleteTurn = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    turnId: v.string(),
  },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret, turnId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conv = await ctx.db.get(conversationId)
    if (!conv || conv.userId !== userId || conv.deletedAt) {
      throw new Error('Unauthorized')
    }
    const tid = turnId.trim()
    if (!tid) return { deletedMessages: 0, deletedOutputs: 0 }

    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .collect()

    let deletedMessages = 0
    for (const m of messages) {
      if (m.turnId === tid) {
        await ctx.db.delete(m._id)
        deletedMessages++
      }
    }

    const cid = conversationId as string
    const outputs = await ctx.db
      .query('outputs')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', cid))
      .collect()

    let deletedOutputs = 0
    for (const o of outputs) {
      if (o.turnId === tid && o.userId === userId) {
        if (o.storageId) {
          try {
            await ctx.storage.delete(o.storageId)
          } catch {
            // best-effort
          }
        }
        if (o.sizeBytes) {
          await applyStorageUsageDelta(ctx as never, userId, -o.sizeBytes)
        }
        await ctx.db.delete(o._id)
        deletedOutputs++
      }
    }

    const now = Date.now()
    await ctx.db.patch(conversationId, { lastModified: now, updatedAt: now })
    return { deletedMessages, deletedOutputs }
  },
})

export const addMessages = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    rows: v.array(v.object({
      turnId: v.string(),
      role: v.union(v.literal('user'), v.literal('assistant')),
      mode: v.union(v.literal('ask'), v.literal('act')),
      content: v.string(),
      contentType: v.union(v.literal('text'), v.literal('image'), v.literal('video')),
      parts: messageParts,
      modelId: v.optional(v.string()),
      variantIndex: v.optional(v.number()),
      tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
    })),
  },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret, rows }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    const ids: Id<'conversationMessages'>[] = []
    for (const row of rows) {
      const existing = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
        .collect()
      const match = existing.find(
        (message) => sameMessageVariant(message, {
          turnId: row.turnId,
          role: row.role,
          variantIndex: row.variantIndex,
          modelId: row.modelId,
        }),
      )
      const payload = {
        conversationId,
        userId,
        createdAt: match?.createdAt ?? now,
        updatedAt: now,
        status: 'completed' as const,
        ...row,
      }
      const id = match
        ? (await ctx.db.patch(match._id, payload), match._id)
        : await ctx.db.insert('conversationMessages', payload)
      ids.push(id)
    }
    await ctx.db.patch(conversationId, { lastModified: now, updatedAt: now })
    return ids
  },
})

function generateShareToken(): string {
  // 22 chars of base64url ≈ 132 bits of entropy.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const setShare = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    visibility: v.union(v.literal('private'), v.literal('public')),
  },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret, visibility }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    if (visibility === 'public') {
      const token = conversation.shareToken ?? generateShareToken()
      await ctx.db.patch(conversationId, {
        shareToken: token,
        shareVisibility: 'public',
        sharedAt: now,
        updatedAt: now,
      })
      return { token, visibility: 'public' as const }
    }
    // private: rotate token to invalidate any link still in circulation
    await ctx.db.patch(conversationId, {
      shareToken: generateShareToken(),
      shareVisibility: 'private',
      updatedAt: now,
    })
    return { token: null, visibility: 'private' as const }
  },
})

export const getPublicByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const conversation = await ctx.db
      .query('conversations')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', token))
      .first()
    if (!conversation || conversation.deletedAt || conversation.shareVisibility !== 'public') {
      return null
    }
    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
      .order('asc')
      .collect()
    return {
      _id: conversation._id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      sharedAt: conversation.sharedAt ?? conversation.createdAt,
      messages: messages
        .filter((m) => m.status !== 'generating')
        .map((m) => ({
          _id: m._id,
          role: m.role,
          mode: m.mode,
          content: m.content,
          contentType: m.contentType,
          parts: m.parts ?? null,
          modelId: m.modelId ?? null,
          variantIndex: m.variantIndex ?? 0,
          turnId: m.turnId,
          createdAt: m.createdAt,
        })),
    }
  },
})
