import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { startAgentTurnInTransaction } from '../collaboration/directMessages'
import { failUnclaimedNativeHarnessInTransaction } from '../harness/runs'

export const beginSurfaceTurn = mutation({
  args: {
    serverSecret: v.string(),
    turnId: v.string(),
    workflowRunId: v.string(),
    actorUserId: v.string(),
    workspaceId: v.string(),
    creatorPrincipalId: v.string(),
    agentId: v.string(),
    agentPrincipalId: v.string(),
    platform: v.literal('slack'),
    teamId: v.string(),
    channelId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    bindingId: v.string(),
    connectionId: v.string(),
    conversationId: v.id('conversations'),
    userContent: v.string(),
    importedAuthorName: v.optional(v.string()),
    importedAuthorEmail: v.optional(v.string()),
    importedAuthorStatus: v.optional(v.union(
      v.literal('member'), v.literal('invited'), v.literal('not_invited'),
    )),
    modelId: v.string(),
    placeholderTs: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.turnId !== `surface:slack:${args.bindingId}:${args.messageId}` || !args.workflowRunId) {
      throw new Error('Invalid surface turn identity')
    }

    const [connection, binding, agent, creator, conversation] = await Promise.all([
      ctx.db.query('surfaceConnections').withIndex('by_entityId', q => q.eq('id', args.connectionId)).unique(),
      ctx.db.query('surfaceBindings').withIndex('by_entityId', q => q.eq('id', args.bindingId)).unique(),
      ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique(),
      ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', args.creatorPrincipalId)).unique(),
      ctx.db.get(args.conversationId),
    ])
    if (!connection || connection.status !== 'active' || connection.platform !== 'slack'
      || connection.id !== args.connectionId || connection.workspaceId !== args.workspaceId
      || connection.externalTeamId !== args.teamId
      || !binding || binding.status !== 'active' || binding.connectionId !== connection.id
      || binding.agentId !== args.agentId || binding.channelId !== args.channelId
      || !agent || agent.workspaceId !== args.workspaceId || agent.archivedAt
      || agent.harness !== 'overlay' || agent.principalId !== args.agentPrincipalId
      || agent.createdByPrincipalId !== args.creatorPrincipalId
      || !creator || creator.type !== 'human' || creator.archivedAt
      || creator.workspaceId !== args.workspaceId || creator.userId !== args.actorUserId
      || !conversation || conversation.deletedAt || conversation.userId !== args.actorUserId
      || conversation.workspaceId !== args.workspaceId || conversation.conversationType !== 'channel'
      || conversation.createdByPrincipalId !== args.creatorPrincipalId
      || conversation.externalPlatform !== args.platform
      || conversation.externalChannelId !== args.channelId
      || conversation.externalThreadId !== args.threadId || conversation.surfaceBindingId !== args.bindingId) {
      throw new Error('Surface source or conversation authority changed')
    }

    const identity = args
    const existing = await ctx.db.query('surfaceTurnExecutions')
      .withIndex('by_turnId', q => q.eq('turnId', args.turnId))
      .unique()
    if (existing) {
      if (existing.actorUserId !== identity.actorUserId || existing.workspaceId !== identity.workspaceId
        || existing.creatorPrincipalId !== identity.creatorPrincipalId || existing.agentId !== identity.agentId
        || existing.agentPrincipalId !== identity.agentPrincipalId || existing.platform !== identity.platform
        || existing.teamId !== identity.teamId || existing.channelId !== identity.channelId
        || existing.threadId !== identity.threadId || existing.messageId !== identity.messageId
        || existing.bindingId !== identity.bindingId || existing.connectionId !== identity.connectionId
        || existing.conversationId !== args.conversationId) {
        throw new Error('Surface turn identity is already owned by a different source')
      }
      return { owner: existing.workflowRunId === args.workflowRunId ? 'same' as const : 'foreign' as const, execution: existing }
    }

    const userMessageQuery = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_clientNonce', q => (
        q.eq('conversationId', args.conversationId).eq('clientNonce', args.turnId)
      ))
      .unique()
    let userMessageId = userMessageQuery?._id
    if (userMessageQuery && (userMessageQuery.turnId !== args.turnId || userMessageQuery.role !== 'user'
      || userMessageQuery.content !== args.userContent || userMessageQuery.userId !== args.actorUserId)) {
      throw new Error('Imported surface message identity changed')
    }
    if (!userMessageId) {
      userMessageId = await ctx.db.insert('conversationMessages', {
        conversationId: args.conversationId,
        userId: args.actorUserId,
        authorKind: 'human',
        authorPrincipalId: args.creatorPrincipalId,
        importedAuthorName: args.importedAuthorName,
        importedAuthorEmail: args.importedAuthorEmail,
        importedAuthorStatus: args.importedAuthorStatus,
        turnId: args.turnId,
        role: 'user',
        mode: 'act',
        content: args.userContent,
        contentType: 'text',
        clientNonce: args.turnId,
        createdAt: Date.now(),
      })
    }

    const started = await startAgentTurnInTransaction(ctx, {
      actorUserId: args.actorUserId,
      agentId: args.agentId,
      authorPrincipalId: args.agentPrincipalId,
      initiatorPrincipalId: args.creatorPrincipalId,
      clientNonce: `${args.turnId}:assistant`,
      conversationId: args.conversationId,
      modelId: args.modelId,
      executionEngine: 'overlay_harness',
      turnId: args.turnId,
      userMessageId,
      workspaceId: args.workspaceId,
      serverSecret: args.serverSecret,
      harnessRunIdPrefix: 'workspace:',
    })
    const run = await ctx.db.get(started.runId)
    const harnessRunId = `workspace:${started.runId}`
    if (!run || run.mode !== 'room' || run.agentId !== args.agentId
      || run.agentPrincipalId !== args.agentPrincipalId || run.initiatorPrincipalId !== args.creatorPrincipalId
      || run.userMessageId !== userMessageId || run.harnessRunId !== harnessRunId
      || run.executionEngine !== 'overlay_harness' || run.workflowRunId) {
      throw new Error('Native surface delivery could not be admitted')
    }
    const now = Date.now()
    const executionId = await ctx.db.insert('surfaceTurnExecutions', {
      turnId: args.turnId,
      workflowRunId: args.workflowRunId,
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      creatorPrincipalId: args.creatorPrincipalId,
      agentId: args.agentId,
      agentPrincipalId: args.agentPrincipalId,
      platform: args.platform,
      teamId: args.teamId,
      channelId: args.channelId,
      threadId: args.threadId,
      messageId: args.messageId,
      bindingId: args.bindingId,
      connectionId: args.connectionId,
      conversationId: args.conversationId,
      agentRunId: started.runId,
      userMessageId,
      assistantMessageId: started.messageId,
      harnessRunId,
      placeholderTs: args.placeholderTs,
      createdAt: now,
      updatedAt: now,
    })
    return { owner: 'same' as const, execution: await ctx.db.get(executionId) }
  },
})

export const getSurfaceTurnExecutionByHarnessRunId = query({
  args: { serverSecret: v.string(), harnessRunId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('surfaceTurnExecutions')
      .withIndex('by_harnessRunId', q => q.eq('harnessRunId', args.harnessRunId))
      .unique()
  },
})

export const getSurfaceTurnExecutionByTurnId = query({
  args: { serverSecret: v.string(), turnId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('surfaceTurnExecutions')
      .withIndex('by_turnId', q => q.eq('turnId', args.turnId))
      .unique()
  },
})

export const failOwnedSurfaceTurn = mutation({
  args: {
    serverSecret: v.string(),
    turnId: v.string(),
    workflowRunId: v.string(),
    agentRunId: v.id('conversationAgentRuns'),
    assistantMessageId: v.id('conversationMessages'),
    failure: v.object({ code: v.string(), message: v.string(), retryable: v.boolean() }),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const execution = await ctx.db.query('surfaceTurnExecutions')
      .withIndex('by_turnId', q => q.eq('turnId', args.turnId))
      .unique()
    if (!execution || execution.workflowRunId !== args.workflowRunId
      || execution.agentRunId !== args.agentRunId
      || execution.assistantMessageId !== args.assistantMessageId) return { persisted: false }
    const run = await ctx.db.get(args.agentRunId)
    if (!run || run.userId !== execution.actorUserId || run.conversationId !== execution.conversationId
      || run.assistantMessageId !== execution.assistantMessageId || run.harnessRunId !== execution.harnessRunId
      || run.workflowRunId || run.status !== 'queued') return { persisted: false }

    const now = Date.now()
    const text = args.failure.message
    const message = await ctx.db.get(execution.assistantMessageId)
    if (!message || message.conversationId !== execution.conversationId
      || message.turnId !== execution.turnId || message.role !== 'assistant') return { persisted: false }
    if (!await failUnclaimedNativeHarnessInTransaction(ctx, {
      runId: execution.harnessRunId, actorUserId: execution.actorUserId,
      deliveryAgentRunId: execution.agentRunId, reason: text,
    })) return { persisted: false }
    const parts = (message.parts ?? []).filter(part =>
      part.type !== 'data-native-agent-approval' && part.type !== 'data-native-agent-input')
    const hasContentPart = parts.some(part => part.type === 'text')
    await ctx.db.patch(message._id, {
      ...(message.status === 'generating'
        ? {
            content: message.content || text,
            parts: hasContentPart ? parts : [...parts, { type: 'text' as const, text: message.content || text }],
            status: 'error' as const,
          }
        : { parts }),
      updatedAt: now,
    })
    await ctx.db.patch(run._id, {
      status: 'failed',
      workflowRunId: args.workflowRunId,
      failedAt: now,
      leaseExpiresAt: undefined,
      approval: undefined,
      inputRequest: undefined,
      terminalError: args.failure,
      updatedAt: now,
    })
    await ctx.db.patch(run.conversationId, { lastModified: now, updatedAt: now })
    return { persisted: true }
  },
})
