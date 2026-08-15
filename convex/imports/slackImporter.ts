import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { mutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import { recordConversationEvent } from '../collaboration/events'
import type { MutationCtx } from '../_generated/server'

type ActorResult = { principalId: string; membership: { status: string } }

async function requireActorForSlack(
  ctx: { db: MutationCtx['db'] },
  args: { actorUserId: string; workspaceId: string; serverSecret: string },
): Promise<ActorResult> {
  if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)
    )).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
    )).unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return { principalId: principal.principalId, membership }
}

function slugifyChannel(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 120)
}

/**
 * Find a channel slug that is free within the workspace, appending a short,
 * stable suffix (derived from the Slack channel id) if the base collides with a
 * different live conversation. Prevents imports from hard-failing on a slug
 * clash — a common case for DMs that share a generic title.
 */
async function findUniqueSlug(
  ctx: { db: MutationCtx['db'] },
  workspaceId: string,
  base: string,
  suffixSeed: string,
  excludeId: string | undefined,
): Promise<string> {
  const candidates = [base]
  if (suffixSeed) candidates.push(`${base}-${suffixSeed}`.slice(0, 120))
  for (const candidate of candidates) {
    if (!candidate) continue
    const clash = await ctx.db
      .query('conversations')
      .withIndex('by_workspaceId_channelSlug', (q) => (
        q.eq('workspaceId', workspaceId).eq('channelSlug', candidate)
      ))
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .first()
    if (!clash || clash._id === excludeId) return candidate
  }
  return `${base}-${suffixSeed}`.slice(0, 120)
}

/**
 * Create a workspace channel for a Slack import. The importer becomes the
 * initial moderator participant. Additional participants can be added later
 * via addSlackChannelParticipants once users accept invitations.
 */
export const createSlackChannel = mutation({
  args: {
    actorUserId: v.string(),
    workspaceId: v.string(),
    title: v.string(),
    clientId: v.string(),
    visibility: v.union(v.literal('public'), v.literal('private')),
    serverSecret: v.string(),
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    const actor = await requireActorForSlack(ctx, args)
    const now = Date.now()
    // Short, stable suffix from the Slack channel id (last segment of clientId)
    // used to disambiguate slugs when a base name collides.
    const suffixSeed = slugifyChannel((args.clientId.split(':').pop() ?? '').slice(-6))

    const baseSlug = slugifyChannel(args.title)
    if (!baseSlug) throw new Error('Channel name is required')

    // Resume support: if we already imported this Slack channel, reuse it —
    // self-healing along the way. A prior import may have left the conversation
    // soft-deleted (the user cleaned up and re-imported) or, from an older
    // importer, as a non-channel personal chat with no slug/visibility. Rather
    // than hard-fail, resurrect and upgrade it so the re-import succeeds and the
    // channel appears in the Channels tab.
    const existing = await ctx.db
      .query('conversations')
      .withIndex('by_userId_clientId', (q) => q.eq('userId', args.actorUserId).eq('clientId', args.clientId))
      .first()
    if (existing) {
      const isHealthyChannel =
        existing.deletedAt === undefined
        && existing.conversationType === 'channel'
        && Boolean(existing.channelSlug)
        && Boolean(existing.channelVisibility)
      if (!isHealthyChannel) {
        const slug = existing.conversationType === 'channel' && existing.channelSlug
          ? existing.channelSlug
          : await findUniqueSlug(ctx, args.workspaceId, baseSlug, suffixSeed, existing._id)
        await ctx.db.patch(existing._id, {
          deletedAt: undefined,
          conversationType: 'channel',
          channelVisibility: args.visibility,
          channelSlug: slug,
          createdByPrincipalId: existing.createdByPrincipalId ?? actor.principalId,
          // Legacy personal-chat rows kept the old "#name" title; refresh those.
          ...(existing.conversationType === 'channel' ? {} : { title: args.title }),
          updatedAt: now,
          lastModified: now,
        })
        // Ensure the importer is an active moderator participant.
        const participant = await ctx.db
          .query('conversationParticipants')
          .withIndex('by_conversationId_principalId', (q) => (
            q.eq('conversationId', existing._id).eq('principalId', actor.principalId)
          ))
          .first()
        if (!participant) {
          await ctx.db.insert('conversationParticipants', {
            conversationId: existing._id,
            workspaceId: args.workspaceId,
            principalId: actor.principalId,
            principalType: 'human',
            role: 'moderator',
            status: 'active',
            notificationLevel: 'all',
            joinedAt: now,
            updatedAt: now,
          })
        } else if (participant.status !== 'active') {
          await ctx.db.patch(participant._id, { status: 'active', updatedAt: now })
        }
      }
      return existing._id
    }

    // New channel: pick a collision-free slug rather than throwing on a clash.
    const slug = await findUniqueSlug(ctx, args.workspaceId, baseSlug, suffixSeed, undefined)

    const conversationId = await ctx.db.insert('conversations', {
      userId: args.actorUserId,
      workspaceId: args.workspaceId,
      conversationType: 'channel',
      createdByPrincipalId: actor.principalId,
      clientId: args.clientId,
      title: args.title,
      lastModified: now,
      updatedAt: now,
      createdAt: now,
      lastMode: 'act',
      askModelIds: [DEFAULT_MODEL_ID],
      actModelId: DEFAULT_MODEL_ID,
      channelSlug: slug,
      channelVisibility: args.visibility,
      isAutomation: false,
    })

    // Add importer as moderator
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      workspaceId: args.workspaceId,
      principalId: actor.principalId,
      principalType: 'human',
      role: 'moderator',
      status: 'active',
      notificationLevel: 'all',
      joinedAt: now,
      updatedAt: now,
    })

    await recordConversationEvent(ctx, {
      conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'conversation.created',
      payload: { conversationType: 'channel', source: 'slack' },
    })

    return conversationId
  },
})

/**
 * Find or list workspace principals by email(s). Used to map Slack users to
 * existing Overlay members so they can be added to imported channels.
 */
export const getWorkspacePrincipalsByEmail = query({
  args: {
    workspaceId: v.string(),
    emails: v.array(v.string()),
    serverSecret: v.string(),
  },
  returns: v.array(v.object({
    principalId: v.string(),
    userId: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.string(),
    membershipStatus: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const normalizedEmails = [...new Set(args.emails.map((e) => e.toLowerCase().trim()))].filter(Boolean)
    if (normalizedEmails.length === 0) return []

    const allPrincipals = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()

    const matches = allPrincipals.filter((p) =>
      p.email && normalizedEmails.includes(p.email.toLowerCase().trim()),
    )

    const results = []
    for (const p of matches) {
      const membership = await ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', p.principalId)
        ))
        .unique()
      results.push({
        principalId: p.principalId,
        userId: p.userId,
        email: p.email,
        displayName: p.displayName,
        membershipStatus: membership?.status,
      })
    }
    return results
  },
})

/**
 * Resolve the workspace-membership status of a set of emails (Slack authors).
 * Returns a status per email so imported messages can display whether their
 * author is an active member, has a pending invitation, or is not invited.
 */
export const resolveAuthorStatuses = query({
  args: {
    workspaceId: v.string(),
    emails: v.array(v.string()),
    serverSecret: v.string(),
  },
  returns: v.array(v.object({
    email: v.string(),
    status: v.union(v.literal('member'), v.literal('invited'), v.literal('not_invited')),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const emails = [...new Set(args.emails.map((e) => e.toLowerCase().trim()))].filter(Boolean)
    if (emails.length === 0) return []
    const emailSet = new Set(emails)

    // Active members: principals with a matching email and an active membership.
    const principals = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    const memberEmails = new Set<string>()
    for (const p of principals) {
      const email = p.email?.toLowerCase().trim()
      if (!email || p.archivedAt || !emailSet.has(email)) continue
      const membership = await ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', p.principalId)
        ))
        .unique()
      if (membership?.status === 'active') memberEmails.add(email)
    }

    // Pending invitations count as "invited".
    const invitedEmails = new Set<string>()
    for (const email of emails) {
      if (memberEmails.has(email)) continue
      const invitation = await ctx.db
        .query('workspaceInvitations')
        .withIndex('by_workspaceId_email_status', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('email', email).eq('status', 'pending')
        ))
        .first()
      if (invitation) invitedEmails.add(email)
    }

    return emails.map((email) => ({
      email,
      status: memberEmails.has(email)
        ? ('member' as const)
        : invitedEmails.has(email)
          ? ('invited' as const)
          : ('not_invited' as const),
    }))
  },
})

/**
 * Add existing workspace principals as members of an imported Slack channel.
 * Skips users who are not active members.
 */
export const addSlackChannelParticipants = mutation({
  args: {
    actorUserId: v.string(),
    workspaceId: v.string(),
    conversationId: v.id('conversations'),
    principalIds: v.array(v.string()),
    serverSecret: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const actor = await requireActorForSlack(ctx, args)

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.workspaceId !== args.workspaceId || conversation.deletedAt) {
      throw new Error('Channel not found')
    }

    const uniquePrincipalIds = [...new Set(args.principalIds)].filter(Boolean)
    let added = 0
    const now = Date.now()

    for (const principalId of uniquePrincipalIds) {
      if (principalId === actor.principalId) continue // Already the moderator

      const principal = await ctx.db
        .query('workspacePrincipals')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
        .filter((q) => q.eq(q.field('principalId'), principalId))
        .unique()
      if (!principal || principal.archivedAt || !principal.email) continue

      const membership = await ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', principalId)
        ))
        .unique()
      if (!membership || membership.status !== 'active') continue

      const existing = await ctx.db
        .query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) => (
          q.eq('conversationId', args.conversationId).eq('principalId', principalId)
        ))
        .unique()
      if (existing) continue

      await ctx.db.insert('conversationParticipants', {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        principalId,
        principalType: principal.type as 'human' | 'agent',
        role: 'member',
        status: 'active',
        notificationLevel: 'all',
        joinedAt: now,
        updatedAt: now,
      })
      added++
    }

    return added
  },
})
