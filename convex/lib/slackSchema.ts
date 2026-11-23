import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Where an agent thread's requests come from (internal/develop/slack-integration.md). */
export const conversationOriginValidator = v.object({
  platform: v.literal('slack'),
  teamId: v.string(),
  channelId: v.string(),
  threadTs: v.string(),
  kind: v.union(v.literal('channel'), v.literal('dm')),
  channelName: v.optional(v.string()),
  permalink: v.optional(v.string()),
})

export const slackWhoCanAskValidator = v.union(v.literal('linked'), v.literal('everyone'), v.literal('specific'))
export const slackUnlinkedPeopleValidator = v.union(v.literal('link'), v.literal('channel'))
export const slackActionsValidator = v.union(v.literal('ask'), v.literal('allow'), v.literal('never'))
export const slackPersonAccessValidator = v.union(v.literal('allowed'), v.literal('blocked'))

export const slackTables = {
  /** A Slack workspace installed into an Overlay workspace. Bot tokens live encrypted in slackChatState. */
  slackInstallations: defineTable({
    workspaceId: v.string(),
    teamId: v.string(),
    teamName: v.string(),
    enterpriseId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    installedByUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  }).index('by_teamId', ['teamId'])
    .index('by_workspaceId', ['workspaceId']),

  /** A Slack user who proved, through Sign in with Slack, that they are this Overlay member. */
  slackIdentityLinks: defineTable({
    workspaceId: v.string(),
    teamId: v.string(),
    slackUserId: v.string(),
    slackUserName: v.optional(v.string()),
    userId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  }).index('by_teamId_slackUserId', ['teamId', 'slackUserId'])
    .index('by_workspaceId_userId', ['workspaceId', 'userId']),

  /** Who may ask Overlay in Slack and what it may do there. Absent means the defaults. */
  slackSettings: defineTable({
    workspaceId: v.string(),
    whoCanAsk: slackWhoCanAskValidator,
    unlinkedPeople: slackUnlinkedPeopleValidator,
    guests: v.boolean(),
    slackConnect: v.boolean(),
    actionsInChannels: slackActionsValidator,
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }).index('by_workspaceId', ['workspaceId']),

  /** A member on the Slack allow list (Only allowed people) or block list (Everyone except blocked). */
  slackPeopleAccess: defineTable({
    workspaceId: v.string(),
    userId: v.string(),
    access: slackPersonAccessValidator,
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }).index('by_workspaceId_userId', ['workspaceId', 'userId']),

  /** The Overlay thread that answers one person in one Slack thread. */
  slackThreads: defineTable({
    workspaceId: v.string(),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    userId: v.string(),
    conversationId: v.id('conversations'),
    createdAt: v.number(),
  }).index('by_teamId_channelId_threadTs_userId', ['teamId', 'channelId', 'threadTs', 'userId'])
    .index('by_conversationId', ['conversationId']),

  /** Chat SDK state: installations (encrypted), subscriptions, locks, dedupe keys, lists and queues. */
  slackChatState: defineTable({
    key: v.string(),
    value: v.any(),
    expiresAt: v.optional(v.number()),
  }).index('by_key', ['key'])
    .index('by_expiresAt', ['expiresAt']),
}
