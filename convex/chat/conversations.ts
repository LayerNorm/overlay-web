import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { internalMutation, mutation, query } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
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
type MessageDeltaDoc = Doc<'conversationMessageDeltas'>
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

function mergeStreamingParts(existingParts: MessageParts, newParts: MessageParts) {
  let nextParts = existingParts
  for (const part of newParts) {
    const last = nextParts[nextParts.length - 1]
    if (
      part.type === 'reasoning' &&
      last?.type === 'reasoning' &&
      typeof part.text === 'string'
    ) {
      nextParts = [
        ...nextParts.slice(0, -1),
        {
          ...last,
          text: `${last.text ?? ''}${part.text}`,
          state: part.state ?? last.state,
        },
      ]
      continue
    }
    if (isToolInvocationPart(part)) {
      const incoming = part.toolInvocation
      const toolCallId = incoming.toolCallId
      if (toolCallId) {
        const existingIdx = nextParts.findIndex(
          (candidate) => isToolInvocationPart(candidate) && candidate.toolInvocation.toolCallId === toolCallId,
        )
        if (existingIdx >= 0) {
          const existing = nextParts[existingIdx]!
          if (isToolInvocationPart(existing)) {
            nextParts = [
              ...nextParts.slice(0, existingIdx),
              {
                type: 'tool-invocation' as const,
                toolInvocation: {
                  ...existing.toolInvocation,
                  ...incoming,
                  toolName:
                    incoming.toolName === 'unknown_tool'
                      ? existing.toolInvocation.toolName
                      : incoming.toolName,
                  toolInput: incoming.toolInput ?? existing.toolInvocation.toolInput,
                  toolOutput: incoming.toolOutput ?? existing.toolInvocation.toolOutput,
                },
              },
              ...nextParts.slice(existingIdx + 1),
            ]
            continue
          }
        }
      }
    }
    nextParts = [...nextParts, part]
  }
  return nextParts
}

function applyStreamingDeltas(message: MessageDoc, deltas: MessageDeltaDoc[]): MessageDoc {
  if (message.status !== 'generating' || deltas.length === 0) return message
  let content = message.content ?? ''
  let parts = Array.isArray(message.parts) ? message.parts : [{ type: 'text' as const, text: content }]
  for (const delta of deltas) {
    if (delta.textDelta) {
      content += delta.textDelta
      const last = parts[parts.length - 1]
      if (last?.type === 'text') {
        parts = [
          ...parts.slice(0, -1),
          { ...last, text: `${last.text ?? ''}${delta.textDelta}` },
        ]
      } else {
        parts = [...parts, { type: 'text', text: delta.textDelta }]
      }
    }
    if (delta.newParts?.length) {
      parts = mergeStreamingParts(parts, delta.newParts)
    }
  }
  return { ...message, content, parts }
}

async function getMessageDeltas(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  messageId: Id<'conversationMessages'>,
) {
  return await ctx.db
    .query('conversationMessageDeltas')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .order('asc')
    .collect()
}

async function deleteMessageDeltas(
  ctx: Pick<MutationCtx, 'db'>,
  messageId: Id<'conversationMessages'>,
) {
  const deltas = await getMessageDeltas(ctx, messageId)
  await deleteDeltaDocs(ctx, deltas)
  return deltas.length
}

async function deleteDeltaDocs(
  ctx: Pick<MutationCtx, 'db'>,
  deltas: MessageDeltaDoc[],
) {
  for (const delta of deltas) {
    await ctx.db.delete(delta._id)
  }
  return deltas.length
}

async function cleanupMessageDeltas(
  ctx: Pick<MutationCtx, 'db'>,
  cutoffMinutes = 60,
  limit = 1000,
) {
  const cutoff = Date.now() - cutoffMinutes * 60 * 1000
  const staleByAge = await ctx.db
    .query('conversationMessageDeltas')
    .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
    .take(limit)
  const scan = staleByAge.length > 0
    ? staleByAge
    : await ctx.db.query('conversationMessageDeltas').take(limit)
  let deleted = 0
  for (const delta of scan) {
    const message = await ctx.db.get(delta.messageId)
    if (delta.createdAt < cutoff || !message || message.status !== 'generating') {
      await ctx.db.delete(delta._id)
      deleted++
    }
  }
  return {
    deleted,
    scanned: scan.length,
    mode: staleByAge.length > 0 ? 'age' as const : 'orphan' as const,
  }
}

async function cleanupInactiveMessageDeltas(
  ctx: Pick<MutationCtx, 'db'>,
  limit = 1000,
) {
  const scan = await ctx.db.query('conversationMessageDeltas').take(limit)
  let deleted = 0
  for (const delta of scan) {
    const message = await ctx.db.get(delta.messageId)
    if (!message || message.status !== 'generating') {
      await ctx.db.delete(delta._id)
      deleted++
    }
  }
  return {
    deleted,
    scanned: scan.length,
    mode: 'inactive' as const,
  }
}

export const list = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, updatedSince, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const [all, automationConversationIds] = await Promise.all([
      ctx.db
        .query('conversations')
        .withIndex('by_userId_lastModified', (q) => q.eq('userId', userId))
        .order('desc')
        .take(200),
      getLinkedAutomationConversationIds(ctx, userId),
    ])
    return all
      .map(normalizeConversationDoc)
      .filter((c) => !c.projectId)
      .filter((c) => !c.isAutomation)
      .filter((c) => !automationConversationIds.has(c._id))
      .filter((c) => (updatedSince !== undefined ? c.updatedAt > updatedSince : true))
      .filter((c) => (includeDeleted ? true : !c.deletedAt))
      .slice(0, 100)
  },
})

export const listByProject = query({
  args: {
    projectId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, userId, accessToken, serverSecret, updatedSince, includeDeleted }) => {
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
      .sort((a, b) => (b.lastModified ?? b.createdAt) - (a.lastModified ?? a.createdAt))
  },
})

export const get = query({
  args: { conversationId: v.id('conversations'), userId: v.string(), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const conversation = await ctx.db.get(conversationId)
    return conversation?.userId === userId && !conversation.deletedAt
      ? normalizeConversationDoc(conversation)
      : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
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
  handler: async (ctx, { userId, accessToken, serverSecret, clientId, title, projectId, askModelIds, actModelId, lastMode, isAutomation }) => {
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
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    conversationId: v.id('conversations'),
    title: v.optional(v.string()),
    projectId: v.optional(v.string()),
    askModelIds: v.optional(v.array(v.string())),
    actModelId: v.optional(v.string()),
    lastMode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, conversationId, title, projectId, askModelIds, actModelId, lastMode }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
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
  args: { conversationId: v.id('conversations'), userId: v.string(), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
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
    const generating = messages.filter((message) => message.status === 'generating')
    if (generating.length === 0) return messages

    const hydrated = await Promise.all(generating.map(async (message) => {
      const deltas = await getMessageDeltas(ctx, message._id)
      return applyStreamingDeltas(message, deltas)
    }))
    const hydratedById = new Map(hydrated.map((message) => [message._id, message]))
    return messages.map((message) => hydratedById.get(message._id) ?? message)
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
    const generating = messages.filter((message) => message.status === 'generating')
    if (generating.length === 0) {
      return messages.map((message) => compactMessageForHistory(message, compactToolPayloads))
    }

    const hydrated = await Promise.all(generating.map(async (message) => {
      const deltas = await getMessageDeltas(ctx, message._id)
      return applyStreamingDeltas(message, deltas)
    }))
    const hydratedById = new Map(hydrated.map((message) => [message._id, message]))
    return messages.map((message) =>
      compactMessageForHistory(hydratedById.get(message._id) ?? message, compactToolPayloads)
    )
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
	          conversationId: args.conversationId,
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

export const startGeneratingMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    serverSecret: v.string(),
    turnId: v.string(),
    variantIndex: v.optional(v.number()),
    modelId: v.string(),
    mode: v.union(v.literal('ask'), v.literal('act')),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({ userId: args.userId, serverSecret: args.serverSecret })
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }

    const now = Date.now()
    const existing = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const match = existing.find(
      (message) => sameMessageVariant(message, {
        turnId: args.turnId,
        role: 'assistant',
        variantIndex: args.variantIndex,
        modelId: args.modelId,
      }),
    )
    const payload = {
      conversationId: args.conversationId,
      userId: args.userId,
      turnId: args.turnId,
      role: 'assistant' as const,
      mode: args.mode,
      content: '',
      contentType: 'text' as const,
      parts: [{ type: 'text', text: '' }],
      modelId: args.modelId,
      variantIndex: args.variantIndex,
      status: 'generating' as const,
      updatedAt: now,
      createdAt: match?.createdAt ?? now,
    }
    const id = match
      ? (await ctx.db.patch(match._id, payload), match._id)
      : await ctx.db.insert('conversationMessages', payload)
    await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    return id
  },
})

export const appendToGeneratingMessage = mutation({
  args: {
    messageId: v.id('conversationMessages'),
    textDelta: v.optional(v.string()),
    newParts: messageParts,
    serverSecret: v.string(),
  },
  handler: async (ctx, { messageId, textDelta, newParts, serverSecret }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    const message = await ctx.db.get(messageId)
    if (!message) throw new Error('Message not found')
    if (message.status !== 'generating') {
      return
    }

    if (!textDelta && !newParts?.length) return
    const now = Date.now()
    await ctx.db.insert('conversationMessageDeltas', {
      conversationId: message.conversationId,
      messageId,
      userId: message.userId,
      textDelta,
      newParts,
      createdAt: now,
    })
    await ctx.db.patch(messageId, { updatedAt: now })
    await ctx.db.patch(message.conversationId, { lastModified: now, updatedAt: now })
  },
})

export const appendGeneratingMessageDelta = appendToGeneratingMessage

export const finalizeGeneratingMessage = mutation({
  args: {
    messageId: v.id('conversationMessages'),
    content: v.string(),
    parts: v.array(messagePart),
    tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
    routedModelId: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error('Message not found')
    if (message.status !== 'generating') {
      return
    }
    const now = Date.now()
    await ctx.db.patch(args.messageId, {
      content: args.content,
      parts: args.parts,
      tokens: args.tokens,
      routedModelId: args.routedModelId,
      status: 'completed',
      updatedAt: now,
    })
    await deleteMessageDeltas(ctx, args.messageId)
    await ctx.db.patch(message.conversationId, { lastModified: now, updatedAt: now })
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

export const failGeneratingMessage = mutation({
  args: {
    messageId: v.id('conversationMessages'),
    errorText: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, { messageId, errorText, serverSecret }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    const message = await ctx.db.get(messageId)
    if (!message) throw new Error('Message not found')
    if (message.status !== 'generating') {
      return
    }
    const now = Date.now()
    const text = errorText?.trim() || 'Generation failed.'
    await ctx.db.patch(messageId, {
      content: text,
      parts: [{ type: 'text', text }],
      status: 'error',
      updatedAt: now,
    })
    await deleteMessageDeltas(ctx, messageId)
    await ctx.db.patch(message.conversationId, { lastModified: now, updatedAt: now })
  },
})

export const settleGeneratingMessagesForTurn = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    turnId: v.string(),
    status: v.union(v.literal('completed'), v.literal('error')),
    fallbackText: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.object({
    settledCount: v.number(),
  }),
  handler: async (ctx, args) => {
    await authorizeUserAccess({ userId: args.userId, serverSecret: args.serverSecret })
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }

    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const targets = messages.filter((message) =>
      message.role === 'assistant' &&
      message.status === 'generating' &&
      message.turnId === args.turnId
    )

    const now = Date.now()
    let settledCount = 0
    for (const message of targets) {
      const deltas = await getMessageDeltas(ctx, message._id)
      const hydrated = applyStreamingDeltas(message, deltas)
      const fallbackText = args.fallbackText?.trim() ||
        (args.status === 'error'
          ? 'Automation run failed before a final response was saved.'
          : 'Automation run finished before a final response was saved.')
      const content = hydrated.content?.trim() ? hydrated.content : fallbackText
      const hasVisiblePart = Array.isArray(hydrated.parts) && hydrated.parts.some((part) =>
        'text' in part && typeof part.text === 'string'
          ? part.text.trim().length > 0
          : true
      )
      const parts = hasVisiblePart ? hydrated.parts : [{ type: 'text' as const, text: content }]

      await ctx.db.patch(message._id, {
        content,
        parts,
        status: args.status,
        updatedAt: now,
      })
      await deleteDeltaDocs(ctx, deltas)
      settledCount++
    }

    if (settledCount > 0) {
      await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    }

    return { settledCount }
  },
})

export const finalizeStaleGeneratingMessages = mutation({
  args: {
    cutoffMinutes: v.optional(v.number()),
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, { cutoffMinutes, limit, serverSecret }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    const thresholdMs = (cutoffMinutes ?? 5) * 60 * 1000
    const cutoff = Date.now() - thresholdMs

    const stale = await ctx.db
      .query('conversationMessages')
      .withIndex('by_status_updatedAt', (q) =>
        q.eq('status', 'generating').lt('updatedAt', cutoff)
      )
      .take(limit ?? 50)

    let finalizedCount = 0
    let deletedDeltas = 0
    for (const message of stale) {
      const deltas = await getMessageDeltas(ctx, message._id)
      const hydrated = applyStreamingDeltas(message, deltas)
      const hasContent = (hydrated.content?.trim()?.length ?? 0) > 0
      const fallbackText = 'generation_interrupted_server_timeout'
      const content = hasContent ? hydrated.content : fallbackText
      const parts = Array.isArray(hydrated.parts) && hydrated.parts.length > 0
        ? hydrated.parts
        : [{ type: 'text' as const, text: content }]
      await ctx.db.patch(message._id, {
        content,
        parts,
        status: 'error',
        updatedAt: Date.now(),
      })
      deletedDeltas += await deleteDeltaDocs(ctx, deltas)
      finalizedCount++
    }

    return { finalizedCount, deletedDeltas, remaining: stale.length - finalizedCount }
  },
})

export const cleanupConversationMessageDeltas = mutation({
  args: {
    cutoffMinutes: v.optional(v.number()),
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, { cutoffMinutes, limit, serverSecret }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    return await cleanupMessageDeltas(ctx, cutoffMinutes ?? 60, limit ?? 1000)
  },
})

export const stopGeneratingMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.optional(v.id('conversationMessages')),
    partialContent: v.optional(v.string()),
    partialParts: messageParts,
    userId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, { conversationId, messageId, partialContent, partialParts, userId, serverSecret }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
      throw new Error('Unauthorized')
    }

    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_status_updatedAt', (q) =>
        q.eq('conversationId', conversationId).eq('status', 'generating')
      )
      .collect()

    const targets = messageId
      ? messages.filter((m) => m._id === messageId)
      : messages

    for (const message of targets) {
      const deltas = await getMessageDeltas(ctx, message._id)

      const hydrated = applyStreamingDeltas(message, deltas)
      const sentinel = '\n\n[Interrupted by user. Continue?]'
      const baseContent = typeof partialContent === 'string' ? partialContent : hydrated.content
      const finalContent = baseContent.trimEnd() + sentinel
      const baseParts =
        Array.isArray(partialParts) && partialParts.length > 0
          ? partialParts
          : Array.isArray(hydrated.parts)
            ? hydrated.parts
            : [{ type: 'text' as const, text: baseContent }]
      const finalParts = [...baseParts, { type: 'text' as const, text: sentinel }]

      await ctx.db.patch(message._id, {
        content: finalContent,
        parts: finalParts,
        status: 'completed',
        updatedAt: Date.now(),
      })

      await deleteDeltaDocs(ctx, deltas)

      await ctx.db.patch(conversationId, { lastModified: Date.now(), updatedAt: Date.now() })
    }

    return { stoppedCount: targets.length }
  },
})

export const runStaleGeneratingCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thresholdMs = 5 * 60 * 1000
    const cutoff = Date.now() - thresholdMs

    const stale = await ctx.db
      .query('conversationMessages')
      .withIndex('by_status_updatedAt', (q) =>
        q.eq('status', 'generating').lt('updatedAt', cutoff)
      )
      .take(50)

    let finalizedCount = 0
    let deletedDeltas = 0
    for (const message of stale) {
      const deltas = await getMessageDeltas(ctx, message._id)
      const hydrated = applyStreamingDeltas(message, deltas)
      const hasContent = (hydrated.content?.trim()?.length ?? 0) > 0
      const fallbackText = 'generation_interrupted_server_timeout'
      const content = hasContent ? hydrated.content : fallbackText
      const parts = Array.isArray(hydrated.parts) && hydrated.parts.length > 0
        ? hydrated.parts
        : [{ type: 'text' as const, text: content }]
      await ctx.db.patch(message._id, {
        content,
        parts,
        status: 'error',
        updatedAt: Date.now(),
      })
      deletedDeltas += await deleteDeltaDocs(ctx, deltas)
      finalizedCount++
    }

    return { finalizedCount, deletedDeltas }
  },
})

/**
 * Sweeps deltas that are no longer useful. Deltas are only needed while a stream is
 * actively in flight — once the message is completed/errored the client reads from
 * `parts`.
 */
export const runOrphanDeltaCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await cleanupInactiveMessageDeltas(ctx, 1000)
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
  handler: async (ctx) => {
    const thresholdMs = 60 * 60 * 1000
    const cutoff = Date.now() - thresholdMs
    const candidates = await ctx.db.query('conversations').collect()
    const targets = candidates
      .filter((conversation) => !conversation.deletedAt && conversation.createdAt < cutoff)
      .slice(0, 100)
    let deleted = 0
    for (const conversation of targets) {
      const firstMessage = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
        .first()
      if (firstMessage) continue
      // Defensive: drop any orphan deltas that point at this conversation.
      const deltas = await ctx.db
        .query('conversationMessageDeltas')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
        .collect()
      await deleteDeltaDocs(ctx, deltas)
      await ctx.db.delete(conversation._id)
      deleted++
    }
    return { deleted, scanned: targets.length }
  },
})

export const watchGeneratingMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.string(),
    compactToolPayloads: v.optional(v.boolean()),
  },
  handler: async (ctx, { conversationId, userId, accessToken, compactToolPayloads }) => {
    try {
      await authorizeUserAccess({ userId, accessToken })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) return []
    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_status_updatedAt', (q) =>
        q.eq('conversationId', conversationId).eq('status', 'generating')
      )
      .order('desc')
      .collect()
    const hydrated = await Promise.all(messages.map(async (message) => {
      const deltas = await getMessageDeltas(ctx, message._id)
      return applyStreamingDeltas(message, deltas)
    }))
    return hydrated.map((message) => compactMessageForHistory(message, compactToolPayloads))
  },
})

export const watchGeneratingMessageDeltas = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.string(),
    compactToolPayloads: v.optional(v.boolean()),
  },
  handler: async (ctx, { conversationId, userId, accessToken, compactToolPayloads }) => {
    try {
      await authorizeUserAccess({ userId, accessToken })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) return []
    const generatingMessages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_status_updatedAt', (q) =>
        q.eq('conversationId', conversationId).eq('status', 'generating')
      )
      .collect()
    if (generatingMessages.length === 0) return []
    const generatingIds = new Set(generatingMessages.map((message) => message._id))
    const deltas = await ctx.db
      .query('conversationMessageDeltas')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .collect()
    const filtered = deltas.filter((delta) => generatingIds.has(delta.messageId))
    if (!compactToolPayloads) return filtered
    return filtered.map((delta) => ({
      ...delta,
      newParts: Array.isArray(delta.newParts) ? compactPartsForHistory(delta.newParts) : delta.newParts,
    }))
  },
})

export const watchMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, { conversationId, userId, accessToken }) => {
    try {
      await authorizeUserAccess({ userId, accessToken })
    } catch {
      return []
    }
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.userId !== userId || conversation.deletedAt) return []
    return await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .collect()
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
