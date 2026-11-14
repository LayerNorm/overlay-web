import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { recordConversationEvent } from '../collaboration/events'
import { syncExternalPrincipalId, syncTurnId } from '../../src/shared/sync/types'
import { providerValidator, syncInboundBatchValidator } from './validators'
import { SYNC_ECHO_RECHECK_MS, outboundEditEcho, outboundPostInFlight } from './outbox'

type Batch = {
  provider: 'slack' | 'teams'
  externalOrgId: string
  externalChannelId: string
  events: Array<
    | { kind: 'message.upsert'; externalMessageId: string; externalThreadId?: string; externalUserId: string; text: string; createdAt: number; editedAt?: number }
    | { kind: 'message.delete'; externalMessageId: string }
    | { kind: 'reaction.add' | 'reaction.remove'; externalMessageId: string; externalUserId: string; emoji: string }
  >
  authors: Array<{ externalUserId: string; displayName: string; email?: string; avatarUrl?: string; isBot?: boolean }>
}

type Identity = Doc<'syncIdentities'>
type AuthorStatus = 'member' | 'invited' | 'not_invited'

async function findLink(ctx: Pick<MutationCtx, 'db'>, provider: Batch['provider'], externalOrgId: string, externalChannelId: string) {
  return await ctx.db.query('syncChannelLinks')
    .withIndex('by_provider_externalOrgId_externalChannelId', q => q
      .eq('provider', provider).eq('externalOrgId', externalOrgId).eq('externalChannelId', externalChannelId))
    .unique()
}

async function findMapped(ctx: Pick<MutationCtx, 'db'>, provider: Batch['provider'], externalChannelId: string, externalMessageId: string) {
  return await ctx.db.query('syncMessageMap')
    .withIndex('by_provider_externalChannelId_externalMessageId', q => q
      .eq('provider', provider).eq('externalChannelId', externalChannelId).eq('externalMessageId', externalMessageId))
    .unique()
}

async function memberStatusByEmail(ctx: Pick<MutationCtx, 'db'>, workspaceId: string, email: string) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId))
    .filter(q => q.eq(q.field('email'), email))
    .first()
  if (principal && !principal.archivedAt && principal.type === 'human') {
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
      .unique()
    if (membership?.status === 'active') return { principalId: principal.principalId, status: 'member' as AuthorStatus }
  }
  const invitation = await ctx.db.query('workspaceInvitations')
    .withIndex('by_workspaceId_email_status', q => q.eq('workspaceId', workspaceId).eq('email', email).eq('status', 'pending'))
    .first()
  return { principalId: undefined, status: (invitation ? 'invited' : 'not_invited') as AuthorStatus }
}

/** Upserts the people in a batch and returns them by external user id with their membership status. */
async function upsertIdentities(ctx: MutationCtx, workspaceId: string, batch: Batch) {
  const now = Date.now()
  const resolved = new Map<string, { identity: Identity; status: AuthorStatus }>()
  for (const author of batch.authors) {
    const email = author.email?.toLowerCase().trim() || undefined
    const match = email ? await memberStatusByEmail(ctx, workspaceId, email) : { principalId: undefined, status: 'not_invited' as AuthorStatus }
    const existing = await ctx.db.query('syncIdentities')
      .withIndex('by_workspaceId_provider_externalUserId', q => q
        .eq('workspaceId', workspaceId).eq('provider', batch.provider).eq('externalUserId', author.externalUserId))
      .unique()
    const fields = {
      displayName: author.displayName,
      email,
      avatarUrl: author.avatarUrl,
      isBot: author.isBot,
      principalId: existing?.principalId ?? match.principalId,
      updatedAt: now,
    }
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert('syncIdentities', {
          workspaceId, provider: batch.provider, externalOrgId: batch.externalOrgId, externalUserId: author.externalUserId, ...fields,
        })
    const identity = (await ctx.db.get(id))!
    resolved.set(author.externalUserId, { identity, status: identity.principalId ? 'member' : match.status })
  }
  return resolved
}

async function identityFor(
  ctx: Pick<MutationCtx, 'db'>,
  resolved: Map<string, { identity: Identity; status: AuthorStatus }>,
  workspaceId: string,
  provider: Batch['provider'],
  externalUserId: string,
) {
  const known = resolved.get(externalUserId)
  if (known) return known
  const identity = await ctx.db.query('syncIdentities')
    .withIndex('by_workspaceId_provider_externalUserId', q => q
      .eq('workspaceId', workspaceId).eq('provider', provider).eq('externalUserId', externalUserId))
    .unique()
  return identity ? { identity, status: (identity.principalId ? 'member' : 'not_invited') as AuthorStatus } : null
}

/**
 * Applies one normalized batch to its linked Overlay channel. Every write is
 * keyed by the platform's message id, so retries, live/backfill overlap and
 * echoes of our own outbound posts never create duplicates. A new message from
 * someone whose Overlay post is still being sent waits until the post's id is
 * recorded, because it may be that post's echo.
 */
export async function applyInboundBatch(ctx: MutationCtx, batch: Batch) {
  const link = await findLink(ctx, batch.provider, batch.externalOrgId, batch.externalChannelId)
  if (!link || link.status === 'paused') return { applied: 0, skipped: batch.events.length }
  const conversation = await ctx.db.get(link.conversationId)
  if (!conversation || conversation.deletedAt) return { applied: 0, skipped: batch.events.length }
  const resolved = await upsertIdentities(ctx, link.workspaceId, batch)
  const now = Date.now()
  let applied = 0
  let latest = 0
  for (const event of batch.events) {
    const mapped = await findMapped(ctx, batch.provider, batch.externalChannelId, event.externalMessageId)
    if (event.kind === 'message.upsert') {
      if (mapped) {
        if (mapped.direction === 'outbound' && (!event.editedAt || await outboundEditEcho(ctx, mapped.messageId, now))) continue
        const message = await ctx.db.get(mapped.messageId)
        if (!message || message.deletedAt || message.content === event.text) continue
        await ctx.db.patch(message._id, {
          content: event.text,
          parts: [{ type: 'text', text: event.text }],
          editedAt: event.editedAt ?? now,
          editHistory: [...(message.editHistory ?? []), { content: message.content, editedAt: event.editedAt ?? now }],
          updatedAt: now,
        })
        applied += 1
        continue
      }
      if (await outboundPostInFlight(ctx, link, event.externalUserId, now)) {
        await ctx.scheduler.runAfter(SYNC_ECHO_RECHECK_MS, internal.sync.ingest.applyInboundInternal, { batch: { ...batch, events: [event], authors: [] } })
        continue
      }
      const author = await identityFor(ctx, resolved, link.workspaceId, batch.provider, event.externalUserId)
      const thread = event.externalThreadId && event.externalThreadId !== event.externalMessageId
        ? await findMapped(ctx, batch.provider, batch.externalChannelId, event.externalThreadId)
        : null
      const messageId = await ctx.db.insert('conversationMessages', {
        conversationId: link.conversationId,
        userId: conversation.userId,
        authorKind: 'human',
        ...(author?.identity.principalId
          ? { authorPrincipalId: author.identity.principalId }
          : {
              importedAuthorName: author?.identity.displayName ?? 'Unknown',
              ...(author?.identity.email ? { importedAuthorEmail: author.identity.email } : {}),
              importedAuthorStatus: author?.status ?? 'not_invited',
            }),
        turnId: syncTurnId(batch.provider, batch.externalChannelId, event.externalMessageId),
        role: 'user',
        mode: 'act',
        content: event.text,
        contentType: 'text',
        parts: [{ type: 'text', text: event.text }],
        ...(thread ? { threadRootMessageId: thread.messageId } : {}),
        ...(event.editedAt ? { editedAt: event.editedAt } : {}),
        status: 'completed',
        createdAt: event.createdAt,
        updatedAt: now,
      })
      await ctx.db.insert('syncMessageMap', {
        linkId: link._id,
        conversationId: link.conversationId,
        provider: batch.provider,
        externalChannelId: batch.externalChannelId,
        externalMessageId: event.externalMessageId,
        ...(event.externalThreadId ? { externalThreadId: event.externalThreadId } : {}),
        messageId,
        direction: 'inbound',
        createdAt: now,
      })
      await recordConversationEvent(ctx, {
        conversationId: link.conversationId,
        workspaceId: link.workspaceId,
        userId: conversation.userId,
        type: 'message.created',
        messageId,
      })
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMessageInternal, { messageId })
      latest = Math.max(latest, event.createdAt)
      applied += 1
      continue
    }
    if (!mapped) continue
    const message = await ctx.db.get(mapped.messageId)
    if (!message || message.deletedAt) continue
    if (event.kind === 'message.delete') {
      await ctx.db.patch(message._id, { content: '', parts: [], deletedAt: now, updatedAt: now })
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, { sourceKind: 'message', sourceId: message._id })
      applied += 1
      continue
    }
    const author = await identityFor(ctx, resolved, link.workspaceId, batch.provider, event.externalUserId)
    const principalId = author?.identity.principalId ?? syncExternalPrincipalId(batch.provider, event.externalUserId)
    const emoji = event.emoji.trim().slice(0, 32)
    if (!emoji) continue
    const existing = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_messageId_principalId_emoji', q => q.eq('messageId', message._id).eq('principalId', principalId).eq('emoji', emoji))
      .unique()
    if (event.kind === 'reaction.add' && !existing) {
      await ctx.db.insert('conversationMessageReactions', {
        conversationId: link.conversationId, messageId: message._id, workspaceId: link.workspaceId, principalId, emoji, createdAt: now,
      })
      applied += 1
    } else if (event.kind === 'reaction.remove' && existing) {
      await ctx.db.delete(existing._id)
      applied += 1
    }
  }
  const linkPatch: Partial<Doc<'syncChannelLinks'>> = { lastEventAt: now, updatedAt: now }
  await ctx.db.patch(link._id, linkPatch)
  if (latest > 0) {
    const lastModified = Math.max(conversation.lastModified, latest)
    await ctx.db.patch(conversation._id, { lastModified, updatedAt: now })
  }
  return { applied, skipped: batch.events.length - applied }
}

/** Server entry point for live events and history pages from the web server's adapters. */
export const applyInbound = mutation({
  args: { serverSecret: v.string(), batch: syncInboundBatchValidator },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    return await applyInboundBatch(ctx, args.batch)
  },
})

export const applyInboundInternal = internalMutation({
  args: { batch: syncInboundBatchValidator },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => await applyInboundBatch(ctx, args.batch),
})

/** Whether a platform message is already mapped, for echo suppression and history resume. */
export const isMapped = mutation({
  args: { serverSecret: v.string(), provider: providerValidator, externalChannelId: v.string(), externalMessageIds: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const found: string[] = []
    for (const id of args.externalMessageIds) {
      if (await findMapped(ctx, args.provider, args.externalChannelId, id)) found.push(id)
    }
    return found
  },
})

export type { Batch as SyncInboundBatchArgs }
export type SyncLinkId = Id<'syncChannelLinks'>
