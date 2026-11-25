import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import {
  applyChiefIdentityPatch,
  archiveAgentRow,
  defaultChiefNameForUser,
  isRetiredSharedPersonalChief,
} from '../collaboration/agents'

/**
 * One-time moves for "The Personal Chief" (internal/plans/WORKSPACE_PERSONAL_SEPARATION_PLAN.md, P3). Both are
 * idempotent; run each with `dryRun: true` first (it only counts), then until `isDone`, passing `continueCursor` back.
 */

const pageArgs = {
  serverSecret: v.string(),
  dryRun: v.boolean(),
  cursor: v.optional(v.union(v.string(), v.null())),
  numItems: v.optional(v.number()),
}

/**
 * Retires the shared, workspace-visible copy of each personal chief (`chiefScope: 'workspace'`) that earlier versions
 * created for every member: archives it the normal way (membership suspended, so it can't be mentioned or invoked; it
 * leaves every room), and makes it visible only to its owner so the archived row and its threads aren't shown to
 * anyone else. Rows and threads are kept.
 */
export const retireSharedPersonalChiefsByServer = mutation({
  args: pageArgs,
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('workspaceAgentDefinitions')
      .paginate({ cursor: cursor ?? null, numItems: numItems ?? 100 })
    const now = Date.now()
    let retired = 0
    let alreadyRetired = 0
    let roomsLeft = 0
    for (const row of page.page) {
      if (row.deletedAt || !isRetiredSharedPersonalChief(row)) continue
      if (row.archivedAt && row.visibility === 'creator') {
        alreadyRetired++
        continue
      }
      retired++
      if (!row.archivedAt) {
        const participants = await ctx.db.query('conversationParticipants')
          .withIndex('by_workspaceId_principalId_status', (q) =>
            q.eq('workspaceId', row.workspaceId).eq('principalId', row.principalId).eq('status', 'active')).collect()
        for (const participant of participants) {
          const conversation = await ctx.db.get(participant.conversationId)
          if (conversation?.agentId !== row.agentId) roomsLeft++
        }
      }
      if (dryRun) continue
      if (!row.archivedAt) await archiveAgentRow(ctx, row, now)
      await ctx.db.patch(row._id, { visibility: 'creator', updatedAt: now })
    }
    return {
      scanned: page.page.length, retired, alreadyRetired, roomsLeft,
      isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/** Names earlier versions gave personal chiefs: "Overlay" (copied from an old default agent) or "<Name>’s Overlay". */
export function isOldPersonalChiefName(name: string) {
  const value = name.trim()
  return /^overlay$/i.test(value) || /[’']s Overlay$/i.test(value)
}

/**
 * Renames personal chiefs still called "Overlay" or "<Name>’s Overlay" to "<First name>’s Chief" ("Personal Chief"
 * without a name), and brings every personal chief's definition rows and principals in line with its identity. Names
 * people chose are kept.
 */
export const renamePersonalChiefsByServer = mutation({
  args: pageArgs,
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('personalChiefIdentities')
      .paginate({ cursor: cursor ?? null, numItems: numItems ?? 100 })
    const now = Date.now()
    const renamed: Array<{ userId: string; from: string; to: string }> = []
    let resynced = 0
    for (const identity of page.page) {
      const to = isOldPersonalChiefName(identity.name) ? await defaultChiefNameForUser(ctx, identity.userId) : identity.name
      if (to !== identity.name) {
        renamed.push({ userId: identity.userId, from: identity.name, to })
        if (!dryRun) await applyChiefIdentityPatch(ctx, { ownerUserId: identity.userId, name: to, now })
        continue
      }
      const rows = (await ctx.db.query('workspaceAgentDefinitions')
        .withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', identity.userId)).collect())
        .filter((row) => row.agentRole === 'personal_chief')
      const principals = await Promise.all(rows.map((row) => ctx.db.query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).unique()))
      const stale = rows.some((row) => row.name !== identity.name)
        || principals.some((principal) => principal && principal.displayName !== identity.name)
      if (!stale) continue
      resynced++
      if (!dryRun) await applyChiefIdentityPatch(ctx, { ownerUserId: identity.userId, now })
    }
    return {
      scanned: page.page.length, renamed, resynced,
      isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/**
 * Takes personal chiefs and creator-only agents out of channels they were added to when the channel was created
 * (`createChannel` used to add every active agent). They stay in their own threads and in DMs.
 */
export const removePersonalAgentsFromChannelsByServer = mutation({
  args: pageArgs,
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('workspaceAgentDefinitions')
      .paginate({ cursor: cursor ?? null, numItems: numItems ?? 100 })
    const now = Date.now()
    let agents = 0
    let removed = 0
    for (const row of page.page) {
      if (row.deletedAt || (row.agentRole !== 'personal_chief' && row.visibility !== 'creator')) continue
      const participants = await ctx.db.query('conversationParticipants')
        .withIndex('by_workspaceId_principalId_status', (q) =>
          q.eq('workspaceId', row.workspaceId).eq('principalId', row.principalId).eq('status', 'active')).collect()
      const conversations = await Promise.all(participants.map((participant) => ctx.db.get(participant.conversationId)))
      const inChannels = participants.filter((_, i) => conversations[i]?.conversationType === 'channel')
      if (inChannels.length === 0) continue
      agents++
      removed += inChannels.length
      if (dryRun) continue
      await Promise.all(inChannels.map((participant) => ctx.db.patch(participant._id, { status: 'removed', removedAt: now, updatedAt: now })))
    }
    return {
      scanned: page.page.length, agents, removed,
      isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})
