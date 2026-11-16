import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { assertNativeThreadWritable } from '../lib/nativeThreadCompatibility'
import { hydrateRemoteMessages } from '../lib/remoteMessageText'
import { ACTIVE_AGENT_RUN_STATUSES } from '../../src/shared/agents/agent-run'
import { createAgentThread } from './agentThreads'

const MAX_BRANCH_MESSAGES = 500
const ACTIVE_RUN_STATUSES = new Set<string>(ACTIVE_AGENT_RUN_STATUSES)

type TurnArgs = {
  workspaceId: string
  agentId: string
  userId: string
  conversationId: Id<'conversations'>
  messageId: Id<'conversationMessages'>
}

/** The caller's own agent thread and the main-transcript message the action targets. */
async function requireOwnThreadMessage(ctx: MutationCtx, args: TurnArgs) {
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation
    || conversation.workspaceId !== args.workspaceId
    || conversation.agentId !== args.agentId
    || conversation.userId !== args.userId
    || conversation.conversationType !== 'dm'
    || conversation.isAutomation
    || conversation.deletedAt) {
    throw new Error('THREAD_NOT_FOUND')
  }
  const message = await ctx.db.get(args.messageId)
  if (!message
    || message.conversationId !== conversation._id
    || message.threadRootMessageId
    || message.deletedAt) {
    throw new Error('MESSAGE_NOT_FOUND')
  }
  return { conversation, message }
}

/**
 * The person's message that started an agent reply. A started turn records it on
 * its run; a reply that failed to start has no run, so its turn id
 * (`agent_<messageId>_<agentId>`) names the message instead.
 */
async function resolveTurnTrigger(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
  message: Doc<'conversationMessages'>,
): Promise<Doc<'conversationMessages'> | null> {
  if (message.authorKind === 'human') return message
  const run = await ctx.db.query('conversationAgentRuns')
    .withIndex('by_assistantMessageId', q => q.eq('assistantMessageId', message._id)).unique()
  if (run?.userMessageId) return await ctx.db.get(run.userMessageId)
  const prefix = 'agent_'
  const suffix = `_${conversation.agentId}`
  if (!message.turnId?.startsWith(prefix) || !message.turnId.endsWith(suffix)) return null
  const triggerId = ctx.db.normalizeId('conversationMessages', message.turnId.slice(prefix.length, -suffix.length))
  return triggerId ? await ctx.db.get(triggerId) : null
}

/**
 * Removes one exchange from an agent thread, the way deleting a turn works in a
 * chat: the person's message and every agent reply to it. Refuses while a reply
 * is still being written, because the run would keep writing into a deleted row.
 */
export async function deleteAgentThreadTurn(ctx: MutationCtx, args: TurnArgs) {
  const { conversation, message } = await requireOwnThreadMessage(ctx, args)
  const trigger = await resolveTurnTrigger(ctx, conversation, message)
  const replies = trigger
    ? await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_turnId_role', q => q
        .eq('conversationId', conversation._id)
        .eq('turnId', `agent_${trigger._id}_${conversation.agentId}`)
        .eq('role', 'assistant'))
      .collect()
    : []
  const rows = [
    ...(trigger && trigger.conversationId === conversation._id && !trigger.deletedAt ? [trigger] : []),
    ...replies.filter(reply => !reply.deletedAt),
  ]
  if (!rows.some(row => row._id === message._id)) rows.push(message)
  await assertNativeThreadWritable(ctx, conversation)
  for (const row of rows) {
    if (row.status === 'generating') throw new Error('TURN_IN_PROGRESS')
    const run = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_assistantMessageId', q => q.eq('assistantMessageId', row._id)).unique()
    if (run && ACTIVE_RUN_STATUSES.has(run.status)) throw new Error('TURN_IN_PROGRESS')
  }
  const now = Date.now()
  for (const row of rows) {
    await ctx.db.patch(row._id, { content: '', parts: [], deletedAt: now, updatedAt: now })
    await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
      sourceKind: 'message',
      sourceId: row._id,
    })
  }
  return { deletedMessageIds: rows.map(row => row._id) }
}

/**
 * Starts a new thread with the same agent holding a copy of this thread's main
 * transcript up to and including the chosen message, like branching a chat.
 * Side-thread replies, deleted rows and replies still being written are left out.
 */
export async function branchAgentThread(ctx: MutationCtx, args: TurnArgs) {
  const { conversation, message } = await requireOwnThreadMessage(ctx, args)
  const rows = await ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', conversation._id))
    .order('asc').take(MAX_BRANCH_MESSAGES + 1)
  const lastIndex = rows.findIndex(row => row._id === message._id)
  if (lastIndex < 0) throw new Error(rows.length > MAX_BRANCH_MESSAGES ? 'BRANCH_TOO_LONG' : 'MESSAGE_NOT_FOUND')
  const kept = rows.slice(0, lastIndex + 1).filter(row => (
    !row.threadRootMessageId
    && !row.deletedAt
    && row.status !== 'generating'
    && (row.authorKind === 'human' || row.authorKind === 'agent')
  ))
  const branch = await createAgentThread(ctx, {
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    userId: args.userId,
    title: `${conversation.title.trim() || 'Thread'} branch`,
  })
  const now = Date.now()
  for (const row of await hydrateRemoteMessages(ctx, kept)) {
    const parts = row.parts?.filter(part => part.type === 'text' || part.type === 'file')
    const content = row.content?.trim() || (row.authorKind === 'agent' ? '[Response]' : '[Message]')
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId: branch.conversationId,
      userId: args.userId,
      authorKind: row.authorKind,
      authorPrincipalId: row.authorPrincipalId,
      turnId: row.turnId,
      role: row.role,
      mode: row.mode ?? 'act',
      content,
      contentType: row.contentType ?? 'text',
      parts: parts?.length ? parts : [{ type: 'text', text: content }],
      modelId: row.modelId,
      replyToTurnId: row.replyToTurnId,
      replySnippet: row.replySnippet,
      status: 'completed',
      createdAt: row.createdAt,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMessageInternal, { messageId })
  }
  await ctx.db.patch(branch.conversationId, { lastModified: now, updatedAt: now })
  return branch
}
