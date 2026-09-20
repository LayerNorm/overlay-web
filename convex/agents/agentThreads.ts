import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'

type Ctx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

const threadView = v.object({
  conversationId: v.id('conversations'),
  title: v.string(),
  lastModified: v.number(),
  createdAt: v.number(),
  archivedAt: v.optional(v.number()),
  isMain: v.boolean(),
})

const agentAutomationView = v.object({
  automationId: v.id('automations'),
  name: v.string(),
  enabled: v.boolean(),
  conversationId: v.optional(v.id('conversations')),
  lastRunAt: v.optional(v.number()),
})

async function requireActorMembership(
  ctx: Ctx,
  args: { workspaceId: string; userId: string },
): Promise<Doc<'workspacePrincipals'>> {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('userId', args.userId)
    ))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
    ))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

async function requireAgentDefinition(
  ctx: Ctx,
  args: { workspaceId: string; agentId: string },
): Promise<Doc<'workspaceAgentDefinitions'>> {
  const agent = await ctx.db
    .query('workspaceAgentDefinitions')
    .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
    .unique()
  if (!agent || agent.workspaceId !== args.workspaceId) throw new Error('AGENT_NOT_FOUND')
  return agent
}

async function listThreadDocs(
  ctx: Ctx,
  args: { workspaceId: string; agentId: string; userId: string },
): Promise<Doc<'conversations'>[]> {
  const rows = await ctx.db
    .query('conversations')
    .withIndex('by_workspaceId_agentId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId)
    ))
    .collect()
  // Threads are per-user DM conversations: callers only ever see their own.
  // Automation-owned threads can carry agentId when the automation was
  // drafted inside an agent thread (attach marks them isAutomation). They
  // render as automation items under the agent, not as chat threads.
  return rows.filter((row) => !row.deletedAt && !row.isAutomation && row.userId === args.userId)
}

async function callerArchivedAt(
  ctx: Ctx,
  conversationId: Id<'conversations'>,
  principalId: string,
): Promise<number | undefined> {
  const participant = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_conversationId_principalId', (q) => (
      q.eq('conversationId', conversationId).eq('principalId', principalId)
    ))
    .unique()
  return participant?.archivedAt
}

async function insertThread(
  ctx: MutationCtx,
  args: { workspaceId: string; userId: string; title: string; dmIdentityKey?: string },
  actor: Doc<'workspacePrincipals'>,
  agent: Doc<'workspaceAgentDefinitions'>,
  agentPrincipal: Doc<'workspacePrincipals'>,
): Promise<Id<'conversations'>> {
  const now = Date.now()
  const conversationId = await ctx.db.insert('conversations', {
    userId: args.userId,
    workspaceId: args.workspaceId,
    conversationType: 'dm',
    createdByPrincipalId: actor.principalId,
    title: args.title,
    lastModified: now,
    updatedAt: now,
    createdAt: now,
    lastMode: 'act',
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
    agentId: agent.agentId,
    dmIdentityKey: args.dmIdentityKey,
  })
  const participants = [
    { principal: actor, role: 'moderator' as const },
    { principal: agentPrincipal, role: 'member' as const },
  ]
  for (const { principal, role } of participants) {
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      workspaceId: args.workspaceId,
      principalId: principal.principalId,
      principalType: principal.type as 'human' | 'agent',
      role,
      status: 'active',
      notificationLevel: 'all',
      joinedAt: now,
      updatedAt: now,
      lastReadAt: principal.principalId === actor.principalId ? now : undefined,
    })
  }
  await ctx.db.insert('workspaceResourceScopes', {
    workspaceId: args.workspaceId,
    resourceType: 'conversation',
    resourceId: conversationId,
    createdAt: now,
    updatedAt: now,
  })
  return conversationId
}

async function requireLiveAgent(
  ctx: Ctx,
  args: { workspaceId: string; agentId: string },
): Promise<{ agent: Doc<'workspaceAgentDefinitions'>; agentPrincipal: Doc<'workspacePrincipals'> }> {
  const agent = await requireAgentDefinition(ctx, args)
  if (agent.archivedAt) throw new Error('AGENT_ARCHIVED')
  const agentPrincipal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', agent.principalId))
    .unique()
  if (!agentPrincipal || agentPrincipal.archivedAt) throw new Error('AGENT_ARCHIVED')
  return { agent, agentPrincipal }
}

/**
 * Creates a fresh thread under an agent. Threads never share the
 * `dmIdentityKey` of the agent's primary DM, so every call produces a new
 * conversation; the main thread is whichever non-archived thread is oldest.
 */
export const createThreadByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.object({ conversationId: v.id('conversations'), title: v.string() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await requireActorMembership(ctx, args)
    const { agent, agentPrincipal } = await requireLiveAgent(ctx, args)
    const title = args.title?.trim().slice(0, 120) || 'New thread'
    const conversationId = await insertThread(
      ctx,
      { workspaceId: args.workspaceId, userId: args.userId, title },
      actor,
      agent,
      agentPrincipal,
    )
    return { conversationId, title }
  },
})

/**
 * Resolves the thread an agent opens into: the caller's main (oldest
 * surviving) thread when one exists; otherwise the agent's legacy singleton
 * DM adopted as the main thread; otherwise a fresh main thread that carries
 * the `dmIdentityKey` so DM-path lookups land on it too.
 */
export const resolveMainThreadByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    userId: v.string(),
  },
  returns: v.object({ conversationId: v.id('conversations'), title: v.string() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await requireActorMembership(ctx, args)
    const agent = await requireAgentDefinition(ctx, args)

    // Archived agents still resolve their existing main thread so history
    // stays viewable from the Archived tab; they just cannot adopt or create.
    const threads = await listThreadDocs(ctx, { ...args })
    const main = threads
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id)))[0]
    if (main) return { conversationId: main._id, title: main.title }
    const { agentPrincipal } = await requireLiveAgent(ctx, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
    })

    const dmIdentityKey = [actor.principalId, agent.principalId].sort().join(':')
    const legacyDm = await ctx.db
      .query('conversations')
      .withIndex('by_workspaceId_dmIdentityKey', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('dmIdentityKey', dmIdentityKey)
      ))
      .first()
    if (legacyDm
      && !legacyDm.deletedAt
      && !legacyDm.isAutomation
      && (!legacyDm.agentId || legacyDm.agentId === agent.agentId)) {
      if (!legacyDm.agentId) {
        await ctx.db.patch(legacyDm._id, { agentId: agent.agentId, updatedAt: Date.now() })
      }
      return { conversationId: legacyDm._id, title: legacyDm.title }
    }

    const conversationId = await insertThread(
      ctx,
      { workspaceId: args.workspaceId, userId: args.userId, title: agent.name, dmIdentityKey },
      actor,
      agent,
      agentPrincipal,
    )
    return { conversationId, title: agent.name }
  },
})

export const listThreadsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    userId: v.string(),
  },
  returns: v.array(threadView),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await requireActorMembership(ctx, args)
    const threads = await listThreadDocs(ctx, args)
    const liveThreads = threads.filter((thread) => !thread.deletedAt)
    const mainThreadId = liveThreads
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id)))[0]?._id
    const views = await Promise.all(threads.map(async (thread) => ({
      conversationId: thread._id,
      title: thread.title,
      lastModified: thread.lastModified,
      createdAt: thread.createdAt,
      archivedAt: await callerArchivedAt(ctx, thread._id, actor.principalId),
      isMain: thread._id === mainThreadId,
    })))
    return views.sort((a, b) => b.lastModified - a.lastModified)
  },
})

/**
 * Agents (live or archived) that own at least one thread the caller archived.
 * The Archived tab is their union with fully-archived agents.
 */
export const listArchivedAgentsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    userId: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await requireActorMembership(ctx, args)
    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId)
          .eq('principalId', actor.principalId)
          .eq('status', 'active')
      ))
      .collect()
    const agentIds = new Set<string>()
    for (const row of participantRows) {
      if (!row.archivedAt) continue
      const conversation = await ctx.db.get(row.conversationId)
      if (conversation?.agentId && !conversation.deletedAt && !conversation.isAutomation) {
        agentIds.add(conversation.agentId)
      }
    }
    return [...agentIds]
  },
})

export const listAutomationsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    userId: v.string(),
  },
  returns: v.array(agentAutomationView),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActorMembership(ctx, { workspaceId: args.workspaceId, userId: args.userId })
    const rows = await ctx.db
      .query('automations')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .collect()
    return rows
      .filter((row) => (
        !row.deletedAt
        && row.workspaceId === args.workspaceId
        && row.userId === args.userId
      ))
      .map((row) => ({
        automationId: row._id,
        name: row.name ?? row.title ?? 'Untitled automation',
        enabled: row.enabled !== false,
        conversationId: row.conversationId,
        lastRunAt: row.lastRunAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/**
 * Archives/unarchives a thread for the calling user. Archiving is
 * participant-scoped (matching the rest of the collaboration model): the
 * thread appears under the agent's Archived section for the archiver while
 * remaining intact for the agent and future unarchive.
 */
export const setThreadArchivedByServer = mutation({
  args: {
    serverSecret: v.string(),
    conversationId: v.id('conversations'),
    agentId: v.string(),
    userId: v.string(),
    archived: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation
      || !conversation.agentId
      || conversation.agentId !== args.agentId
      || conversation.isAutomation
      || conversation.deletedAt) {
      throw new Error('THREAD_NOT_FOUND')
    }
    const actor = await requireActorMembership(ctx, {
      workspaceId: conversation.workspaceId ?? '',
      userId: args.userId,
    })
    const participant = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => (
        q.eq('conversationId', args.conversationId).eq('principalId', actor.principalId)
      ))
      .unique()
    if (!participant || participant.status !== 'active') throw new Error('THREAD_ACCESS_DENIED')
    await ctx.db.patch(participant._id, {
      archivedAt: args.archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

/**
 * Deletes a thread's conversation. The agent must always keep one thread:
 * deleting the last surviving thread is refused. When the deleted thread was
 * the main (oldest) one, the next-oldest surviving thread becomes main by
 * derivation — no pointer needs to move.
 */
export const deleteThreadByServer = mutation({
  args: {
    serverSecret: v.string(),
    conversationId: v.id('conversations'),
    agentId: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation
      || !conversation.agentId
      || conversation.agentId !== args.agentId
      || conversation.isAutomation
      || conversation.deletedAt) {
      throw new Error('THREAD_NOT_FOUND')
    }
    const workspaceId = conversation.workspaceId
    if (!workspaceId) throw new Error('THREAD_NOT_FOUND')
    const actor = await requireActorMembership(ctx, { workspaceId, userId: args.userId })
    const participant = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => (
        q.eq('conversationId', args.conversationId).eq('principalId', actor.principalId)
      ))
      .unique()
    if (!participant && conversation.userId !== args.userId) throw new Error('THREAD_ACCESS_DENIED')

    const siblings = await listThreadDocs(ctx, {
      workspaceId,
      agentId: conversation.agentId,
      userId: args.userId,
    })
    const survivors = siblings.filter((thread) => thread._id !== args.conversationId)
    if (survivors.length === 0) {
      throw new Error('AGENT_LAST_THREAD')
    }
    const now = Date.now()
    await ctx.db.patch(args.conversationId, { deletedAt: now, updatedAt: now })
    return null
  },
})
