import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

export const threadSummaryValidator = v.object({
  rootMessageId: v.id('conversationMessages'), replyCount: v.object({ count: v.number(), capped: v.boolean() }),
  latestReplyComplete: v.boolean(),
  latestReply: v.union(v.null(), v.object({ id: v.id('conversationMessages'), content: v.string(), createdAt: v.number(),
    authorKind: v.union(v.literal('human'), v.literal('agent'), v.literal('model'), v.literal('system')),
    authorPrincipalId: v.optional(v.string()), importedAuthorName: v.optional(v.string()), clientNonce: v.optional(v.string()) })),
})

function replyTeaser(row: Doc<'conversationMessages'>) {
  return { id: row._id, content: row.content.slice(0, 140), createdAt: row.createdAt,
    authorKind: row.authorKind ?? (row.role === 'assistant' ? 'model' as const : 'human' as const),
    authorPrincipalId: row.authorPrincipalId && row.authorPrincipalId.length <= 240 ? row.authorPrincipalId : undefined,
    importedAuthorName: row.importedAuthorName?.slice(0, 240),
    clientNonce: row.clientNonce && row.clientNonce.length <= 256 ? row.clientNonce : undefined }
}

export async function readThreadSummaries(ctx: Pick<QueryCtx, 'db'>, conversationId: Id<'conversations'>, rootMessageIds: Id<'conversationMessages'>[]) {
  const roots = [...new Set(rootMessageIds)]
  const limit = Math.min(65, Math.floor(512 / Math.max(1, roots.length)))
  const summaries = []
  for (const rootMessageId of roots) {
    const root = await ctx.db.get(rootMessageId)
    if (!root || root.conversationId !== conversationId || root.threadRootMessageId || root.deletedAt !== undefined) continue
    const rows = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_threadRootMessageId_createdAt', q => q.eq('conversationId', conversationId).eq('threadRootMessageId', rootMessageId))
      .order('desc').take(limit)
    const capped = rows.length === limit
    const counted = capped ? rows.slice(0, -1) : rows
    const latest = rows.find(row => row.deletedAt === undefined)
    summaries.push({ rootMessageId, replyCount: { count: counted.filter(row => row.deletedAt === undefined).length, capped },
      latestReply: latest ? replyTeaser(latest) : null, latestReplyComplete: Boolean(latest) || !capped })
  }
  return summaries
}

export async function acknowledgedReplies(ctx: Pick<QueryCtx, 'db'>, conversationId: Id<'conversations'>, roots: Id<'conversationMessages'>[], nonces: string[]) {
  const acknowledged: string[] = []
  if (!roots.length) return acknowledged
  for (const nonce of new Set(nonces)) {
    const row = await ctx.db.query('conversationMessages').withIndex('by_conversationId_clientNonce', q => q.eq('conversationId', conversationId).eq('clientNonce', nonce)).first()
    if (row?.threadRootMessageId && roots.includes(row.threadRootMessageId)) acknowledged.push(nonce)
  }
  return acknowledged
}
