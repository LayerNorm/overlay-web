import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { v } from 'convex/values'
import {
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
  nativeRunRetiredError,
} from '../../src/shared/agents/native-run-retirement'

type ReadContext = Pick<QueryCtx, 'db'>
type Budget = { runs: number; roots: number }
export const nativeThreadCompatibilityValidator = v.union(v.object({ readOnly: v.literal(false) }),
  v.object({ readOnly: v.literal(true), code: v.literal(NATIVE_RUN_RETIRED_CODE), message: v.literal(NATIVE_RUN_RETIRED_MESSAGE) }))

function isConversationThread(conversation: Doc<'conversations'>): boolean {
  return (conversation.conversationType ?? 'personal') === 'personal'
    || Boolean(conversation.agentId || conversation.externalPlatform)
    || (conversation.conversationType === 'dm'
      && (!conversation.dmIdentityKey || conversation.dmIdentityKey.split(':').length <= 2))
}

async function findThreadRoot(
  ctx: ReadContext,
  conversationId: Id<'conversations'>,
  messageId: Id<'conversationMessages'>,
  budget?: Budget,
): Promise<Id<'conversationMessages'> | undefined> {
  const visited = new Set<string>()
  let current = messageId
  while (true) {
    if (budget && budget.roots-- <= 0) return undefined
    if (visited.has(current)) throw new Error('INVALID_THREAD_ROOT')
    visited.add(current)
    const message = await ctx.db.get(current)
    if (!message || message.conversationId !== conversationId) throw new Error('INVALID_THREAD_ROOT')
    if (!message.threadRootMessageId) return current
    current = message.threadRootMessageId
  }
}

export async function isNativeThreadReadOnly(
  ctx: ReadContext,
  conversation: Doc<'conversations'>,
  threadRootMessageId?: Id<'conversationMessages'>,
  budget?: Budget,
): Promise<boolean> {
  const wholeConversation = isConversationThread(conversation)
  // A new top-level message in a shared room starts a new task, not an old thread.
  if (!wholeConversation && !threadRootMessageId) return false
  const threadRoot = !wholeConversation && threadRootMessageId
    ? await findThreadRoot(ctx, conversation._id, threadRootMessageId, budget) : undefined
  if (!wholeConversation && threadRootMessageId && !threadRoot) return true
  const queries = [
    ctx.db.query('conversationAgentRuns')
      .withIndex('by_conversationId_runner_executionEngine', q => q
        .eq('conversationId', conversation._id).eq('runner', 'tool_loop')),
    ctx.db.query('conversationAgentRuns')
      .withIndex('by_conversationId_runner_executionEngine', q => q
        .eq('conversationId', conversation._id).eq('runner', 'workflow').eq('executionEngine', undefined)),
  ]
  for (const query of queries) {
    const runs = budget ? await query.take(Math.max(0, budget.runs) + 1) : query
    for await (const run of runs) {
      if (budget && budget.runs-- <= 0) return true
      if (wholeConversation || run.userMessageId === threadRoot || run.assistantMessageId === threadRoot) return true
      if (budget && budget.roots-- <= 0) return true
      const trigger = await ctx.db.get(run.userMessageId)
      if (trigger?.conversationId !== conversation._id || !trigger.threadRootMessageId) continue
      const root = await findThreadRoot(ctx, conversation._id, trigger._id, budget)
      if (!root || root === threadRoot) return true
    }
  }
  return false
}

export async function assertNativeThreadWritable(
  ctx: ReadContext,
  conversation: Doc<'conversations'>,
  threadRootMessageId?: Id<'conversationMessages'>,
): Promise<void> {
  if (await isNativeThreadReadOnly(ctx, conversation, threadRootMessageId)) throw nativeRunRetiredError()
}

export async function nativeThreadCompatibility(
  ctx: ReadContext,
  conversation: Doc<'conversations'>,
  threadRootMessageId?: Id<'conversationMessages'>,
  budget?: Budget,
) {
  return await isNativeThreadReadOnly(ctx, conversation, threadRootMessageId, budget ? { ...budget } : undefined)
    ? { readOnly: true, code: NATIVE_RUN_RETIRED_CODE, message: NATIVE_RUN_RETIRED_MESSAGE } as const
    : { readOnly: false as const }
}
