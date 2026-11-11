import { v } from 'convex/values'
import { internal } from '../_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

const source = v.union(
  v.object({ kind: v.literal('activity'), id: v.id('workspaceNotifications') }),
  v.object({ kind: v.literal('approval'), id: v.id('agentApprovalRequests') }),
  v.object({ kind: v.literal('wait'), id: v.id('harnessWaits') }),
)
const target = v.object({ token: v.string(), userId: v.string(), updatedAt: v.number() })
type Target = { token: string; userId: string; updatedAt: number }
type Delivery = { title: string; body?: string; url: string; targets: Target[] }

async function recipient(
  ctx: QueryCtx,
  workspaceId: string,
  conversationId: Id<'conversations'>,
  userId: string,
  category: keyof Pick<
    Doc<'workspaceNotificationPreferences'>,
    'dmMessages' | 'mentions' | 'threadReplies' | 'reactions' | 'channelMessages'
  >,
) {
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined)
    return false
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) =>
      q.eq('workspaceId', workspaceId).eq('userId', userId),
    )
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) return false
  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId),
    )
    .unique()
  if (membership?.status !== 'active') return false
  const participant = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_conversationId_principalId', (q) =>
      q.eq('conversationId', conversationId).eq('principalId', principal.principalId),
    )
    .unique()
  const conversation = await ctx.db.get(conversationId)
  if (
    !conversation ||
    conversation.workspaceId !== workspaceId ||
    conversation.deletedAt !== undefined
  )
    return false
  if (
    participant &&
    (participant.status !== 'active' ||
      participant.removedAt !== undefined ||
      participant.archivedAt !== undefined ||
      participant.notificationLevel === 'muted')
  )
    return false
  if (!participant && conversation.userId !== userId) return false
  if (participant?.notificationLevel === 'mentions' && category !== 'mentions') return false
  const preferences = await ctx.db
    .query('workspaceNotificationPreferences')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId),
    )
    .unique()
  return !preferences || preferences[category] === 'banner'
}

export const pending = internalQuery({
  args: { source },
  handler: async (ctx, args): Promise<Delivery | null> => {
    let userId: string,
      conversationId: Id<'conversations'>,
      workspaceId: string,
      title: string,
      body: string | undefined
    let category: 'dmMessages' | 'mentions' | 'threadReplies' | 'reactions' | 'channelMessages' =
      'mentions'
    let threadRootMessageId: string | undefined
    let notificationType = 'mention'
    if (args.source.kind === 'activity') {
      const row = await ctx.db.get(args.source.id)
      if (!row || row.readAt !== undefined) return null
      const principal = await ctx.db
        .query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', row.recipientPrincipalId))
        .filter((q) => q.eq(q.field('workspaceId'), row.workspaceId))
        .unique()
      if (
        !principal?.userId ||
        principal.type !== 'human' ||
        principal.workspaceId !== row.workspaceId
      )
        return null
      const room = await ctx.db.get(row.conversationId)
      userId = principal.userId
      conversationId = row.conversationId
      workspaceId = row.workspaceId
      title = row.title
      body = row.body
      threadRootMessageId = row.threadRootMessageId
      notificationType = row.type === 'participant' ? 'message' : row.type
      category =
        row.type === 'mention'
          ? 'mentions'
          : row.type === 'reaction'
            ? 'reactions'
            : row.type === 'thread'
              ? 'threadReplies'
              : room?.conversationType === 'dm'
                ? 'dmMessages'
                : 'channelMessages'
    } else {
      let run: Doc<'conversationAgentRuns'> | null
      if (args.source.kind === 'approval') {
        const approval = await ctx.db.get(args.source.id)
        if (!approval || approval.resolution) return null
        run = await ctx.db
          .query('conversationAgentRuns')
          .withIndex('by_externalRunId', (q) => q.eq('externalRunId', approval.runId))
          .unique()
        title = approval.kind === 'permission' ? 'Approval needed' : 'Your input is needed'
      } else {
        const wait = await ctx.db.get(args.source.id)
        if (!wait || wait.resolvedAt !== undefined || wait.repliedAt !== undefined) return null
        const waitingRun = await ctx.db
          .query('harnessRuns')
          .withIndex('by_runId', (q) => q.eq('runId', wait.runId))
          .unique()
        const harness = waitingRun?.deliveryAgentRunId
          ? waitingRun
          : waitingRun
            ? await ctx.db
                .query('harnessRuns')
                .withIndex('by_runId', (q) => q.eq('runId', waitingRun.rootRunId))
                .unique()
            : null
        const id = harness?.deliveryAgentRunId
          ? ctx.db.normalizeId('conversationAgentRuns', harness.deliveryAgentRunId)
          : null
        run = id ? await ctx.db.get(id) : null
        title = wait.kind === 'approval' ? 'Approval needed' : 'Your input is needed'
      }
      if (!run || ['completed', 'failed', 'cancelled'].includes(run.status))
        return null
      const room = await ctx.db.get(run.conversationId)
      if (!room?.workspaceId) return null
      userId = run.userId
      conversationId = run.conversationId
      workspaceId = room.workspaceId
      body = 'An agent needs your attention.'
    }
    if (!(await recipient(ctx, workspaceId, conversationId, userId, category))) return null
    const room = await ctx.db.get(conversationId)
    const params = new URLSearchParams({ workspaceId })
    params.set('notificationType', notificationType)
    let path = `/${room?.conversationType === 'channel' ? 'channel' : room?.conversationType === 'dm' ? 'dm' : 'chat'}/${conversationId}`
    if (threadRootMessageId) {
      path = `/thread/${threadRootMessageId}`
      params.set('conversation', conversationId)
      params.set('type', room?.conversationType ?? 'dm')
    }
    const rows = await ctx.db
      .query('pushTokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return {
      title,
      body: body?.slice(0, 240),
      url: `${path}?${params}`,
      targets: rows
        .filter((row) => row.revokedAt === undefined)
        .map((row) => ({ token: row.expoToken, userId, updatedAt: row.updatedAt })),
    }
  },
})

export const revoke = internalMutation({
  args: { target },
  handler: async (ctx, { target: item }) => {
    const row = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('expoToken', item.token))
      .unique()
    if (
      row &&
      row.userId === item.userId &&
      row.updatedAt === item.updatedAt &&
      row.revokedAt === undefined
    )
      await ctx.db.patch(row._id, { revokedAt: Date.now() })
  },
})

type ExpoResult = { status?: string; id?: string; details?: { error?: string } }
async function expo(path: string, body: unknown): Promise<{ data?: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN
          ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Expo push request failed (${response.status})`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export const deliver = internalAction({
  args: { source },
  handler: async (ctx, args): Promise<void> => {
    const delivery = await ctx.runQuery(internal.notifications.push.pending, args)
    if (!delivery) return
    for (let i = 0; i < delivery.targets.length; i += 100) {
      const batch = delivery.targets.slice(i, i + 100)
      const result = await expo(
        'send',
        batch.map((item) => ({
          to: item.token,
          title: delivery.title,
          body: delivery.body,
          data: { url: delivery.url },
          channelId: 'default',
        })),
      )
      if (!Array.isArray(result.data) || result.data.length !== batch.length)
        throw new Error('Invalid Expo push tickets')
      const tickets: { id: string; target: Target }[] = []
      for (const [index, ticket] of (result.data as ExpoResult[]).entries()) {
        if (ticket.details?.error === 'DeviceNotRegistered')
          await ctx.runMutation(internal.notifications.push.revoke, { target: batch[index]! })
        else if (ticket.status === 'ok' && ticket.id)
          tickets.push({ id: ticket.id, target: batch[index]! })
      }
      if (tickets.length)
        await ctx.scheduler.runAfter(15 * 60_000, internal.notifications.push.receipts, {
          tickets,
          attempt: 0,
        })
    }
  },
})

export const receipts = internalAction({
  args: { tickets: v.array(v.object({ id: v.string(), target })), attempt: v.number() },
  handler: async (ctx, { tickets, attempt }): Promise<void> => {
    if (!tickets.length) return
    const result = await expo('getReceipts', { ids: tickets.map((ticket) => ticket.id) })
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))
      throw new Error('Invalid Expo push receipts')
    const receipts = result.data as Record<string, ExpoResult>
    const missing = []
    for (const ticket of tickets) {
      if (receipts[ticket.id]?.details?.error === 'DeviceNotRegistered')
        await ctx.runMutation(internal.notifications.push.revoke, { target: ticket.target })
      else if (!receipts[ticket.id]) missing.push(ticket)
    }
    if (missing.length && attempt < 2)
      await ctx.scheduler.runAfter(15 * 60_000, internal.notifications.push.receipts, {
        tickets: missing,
        attempt: attempt + 1,
      })
  },
})
