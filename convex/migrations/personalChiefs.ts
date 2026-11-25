import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import {
  applyChiefIdentityPatch,
  archiveAgentRow,
  ensureWorkspaceChiefs,
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
    let threadsMoved = 0
    let automationsMoved = 0
    let leftBehind = 0
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
      const moved = await moveToOwnChief(ctx, row, dryRun, now)
      threadsMoved += moved.threads
      automationsMoved += moved.automations
      leftBehind += moved.skipped
      if (dryRun) continue
      if (!row.archivedAt) await archiveAgentRow(ctx, row, now)
      await ctx.db.patch(row._id, { visibility: 'creator', updatedAt: now })
    }
    return {
      scanned: page.page.length, retired, alreadyRetired, roomsLeft, threadsMoved, automationsMoved, leftBehind,
      isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/**
 * Hands the shared copy's threads and automations to chiefs their people can still open, so history stays readable and
 * automations keep running with their saved thread. The owner's own threads and personal automations go to the owner's
 * private Personal Chief (created if needed); everything else (other members' threads and automations, workspace
 * automations) goes to the workspace chief. An automation's thread always follows the automation. In an archived
 * workspace nothing moves, and an owner who left or is now a guest keeps their own threads and personal automations on
 * the archived copy; both are counted.
 */
async function moveToOwnChief(ctx: MutationCtx, shared: Doc<'workspaceAgentDefinitions'>, dryRun: boolean, now: number) {
  const threads = await ctx.db.query('conversations')
    .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', shared.workspaceId).eq('agentId', shared.agentId)).collect()
  const automations = (await ctx.db.query('automations')
    .withIndex('by_agentId', (q) => q.eq('agentId', shared.agentId)).collect())
    .filter((automation) => automation.workspaceId === shared.workspaceId)
  const none = { threads: 0, automations: 0, skipped: 0 }
  if (threads.length === 0 && automations.length === 0) return none
  const skipAll = { threads: 0, automations: 0, skipped: threads.length + automations.length }
  const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', shared.workspaceId)).unique()
  const workspaceChief = (await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', shared.workspaceId)).collect())
    .find((row) => row.agentRole === 'workspace_chief' && !row.deletedAt && !row.archivedAt)
  if (workspace?.status !== 'active' || !workspaceChief) return skipAll

  const owner = shared.chiefOwnerUserId ? (await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', shared.workspaceId)).take(5_000))
    .find((principal) => principal.type === 'human' && principal.userId === shared.chiefOwnerUserId) : undefined
  const membership = owner ? await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', shared.workspaceId).eq('principalId', owner.principalId))
    .unique() : null
  const ownerEligible = Boolean(owner && membership?.status === 'active' && membership.role !== 'guest')

  // Where each thread and automation goes: 'own' (owner's private chief), 'workspace', or null (left behind).
  // Another member's personal automation used the copy because it was workspace-visible; the workspace chief is the
  // chief they can still use.
  const automationTarget = (automation: Doc<'automations'>): 'own' | 'workspace' | null => {
    if (automation.scope === 'workspace' || automation.userId !== shared.chiefOwnerUserId) return 'workspace'
    return ownerEligible ? 'own' : null
  }
  const byThread = new Map(automations.flatMap((automation) => automation.conversationId ? [[automation.conversationId, automation] as const] : []))
  const threadTarget = (thread: Doc<'conversations'>): 'own' | 'workspace' | null => {
    const automation = byThread.get(thread._id)
    if (automation) return automationTarget(automation)
    if (thread.userId === shared.chiefOwnerUserId) return ownerEligible ? 'own' : null
    return 'workspace'
  }
  const plan = {
    threads: threads.map((thread) => [thread, threadTarget(thread)] as const),
    automations: automations.map((automation) => [automation, automationTarget(automation)] as const),
  }
  const moved = plan.threads.filter(([, target]) => target).length
  const movedAutomations = plan.automations.filter(([, target]) => target).length
  const counts = { threads: moved, automations: movedAutomations, skipped: threads.length + automations.length - moved - movedAutomations }
  if (dryRun) return counts

  const needsOwn = [...plan.threads, ...plan.automations].some(([, target]) => target === 'own')
  const own = needsOwn && owner && shared.chiefOwnerUserId
    ? (await ensureWorkspaceChiefs(ctx, {
        workspaceId: shared.workspaceId, actorUserId: shared.chiefOwnerUserId, actorPrincipalId: owner.principalId, includePersonal: true, now,
      })).find((chief) => chief.agentRole === 'personal_chief')
    : undefined
  const chiefFor = (target: 'own' | 'workspace' | null) =>
    target === 'own' ? own : target === 'workspace' ? workspaceChief : undefined
  for (const [thread, target] of plan.threads) {
    const chief = chiefFor(target)
    if (!chief) continue
    await ctx.db.patch(thread._id, { agentId: chief.agentId, updatedAt: now })
    const seat = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', thread._id).eq('principalId', shared.principalId)).unique()
    const existing = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', thread._id).eq('principalId', chief.principalId)).unique()
    if (seat && !existing) await ctx.db.patch(seat._id, { principalId: chief.principalId, updatedAt: now })
  }
  for (const [automation, target] of plan.automations) {
    const chief = chiefFor(target)
    if (chief) await ctx.db.patch(automation._id, { agentId: chief.agentId, updatedAt: now })
  }
  return counts
}

/**
 * Whether `name` is one earlier versions generated for this person: "Overlay" (copied from an old default agent) or
 * "<owner name>’s Overlay" built from their account name, a display name, their email or their user ID. A name the
 * person typed, even one ending in "’s Overlay", is not.
 */
export async function isOldPersonalChiefName(ctx: MutationCtx, userId: string, name: string) {
  const value = name.trim()
  if (/^overlay$/i.test(value)) return true
  if (!/[’']s Overlay$/.test(value)) return false
  const account = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', userId)).first()
  const principals = await ctx.db.query('workspacePrincipals').withIndex('by_userId', (q) => q.eq('userId', userId)).collect()
  const owners = [
    [account?.firstName, account?.lastName].filter(Boolean).join(' ').trim(),
    account?.name?.trim(),
    account?.email?.trim(),
    userId,
    ...principals.filter((principal) => principal.type === 'human').map((principal) => principal.displayName.trim()),
  ].filter((owner): owner is string => Boolean(owner))
  return owners.some((owner) => value === `${owner}’s Overlay` || value === `${owner}'s Overlay`)
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
      const to = await isOldPersonalChiefName(ctx, identity.userId, identity.name) ? await defaultChiefNameForUser(ctx, identity.userId) : identity.name
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
