import { v } from 'convex/values'

export const providerValidator = v.union(v.literal('slack'), v.literal('teams'))

export const channelKindValidator = v.union(v.literal('public'), v.literal('private'), v.literal('shared'))

export const syncInboundEventValidator = v.union(
  v.object({
    kind: v.literal('message.upsert'),
    externalMessageId: v.string(),
    externalThreadId: v.optional(v.string()),
    externalUserId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  }),
  v.object({ kind: v.literal('message.delete'), externalMessageId: v.string() }),
  v.object({
    kind: v.union(v.literal('reaction.add'), v.literal('reaction.remove')),
    externalMessageId: v.string(),
    externalUserId: v.string(),
    emoji: v.string(),
  }),
)

export const syncExternalAuthorValidator = v.object({
  externalUserId: v.string(),
  displayName: v.string(),
  email: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  isBot: v.optional(v.boolean()),
})

export const syncInboundBatchValidator = v.object({
  provider: providerValidator,
  externalOrgId: v.string(),
  externalChannelId: v.string(),
  events: v.array(syncInboundEventValidator),
  authors: v.array(syncExternalAuthorValidator),
})
