import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

const OWNER_WAIT_STATUSES = new Set(['waiting_for_input', 'waiting_for_approval'])

/** The thread turn an automation run's message started, if it has started one. */
export async function threadAgentRunFor(
  ctx: Pick<QueryCtx, 'db'>,
  run: Doc<'automationRuns'>,
): Promise<Doc<'conversationAgentRuns'> | null> {
  if (!run.messageId || !run.conversationId) return null
  const startedAt = run.startedAt ?? run.createdAt
  const recent = await ctx.db.query('conversationAgentRuns')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', run.conversationId!).gte('createdAt', startedAt))
    .take(50)
  return recent.find(candidate => candidate.userMessageId === run.messageId) ?? null
}

/** A running automation run whose thread turn waits for its owner's answer or approval. */
export async function isWaitingForOwner(ctx: Pick<QueryCtx, 'db'>, run: Doc<'automationRuns'>): Promise<boolean> {
  if (run.status !== 'running') return false
  const agentRun = await threadAgentRunFor(ctx, run)
  return Boolean(agentRun && OWNER_WAIT_STATUSES.has(agentRun.status))
}
