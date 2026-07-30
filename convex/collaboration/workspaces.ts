import { v } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

const MAX_DIRECTORY_ROWS = 500

const workspaceKind = v.union(v.literal('personal'), v.literal('organization'))
const workspaceStatus = v.union(v.literal('active'), v.literal('archived'))
const principalKind = v.union(v.literal('human'), v.literal('agent'), v.literal('service'))
const membershipRole = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('guest'),
)
const invitationRole = v.union(
  v.literal('admin'),
  v.literal('member'),
  v.literal('guest'),
)
const membershipStatus = v.union(v.literal('active'), v.literal('suspended'))
const invitationStatus = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('expired'),
  v.literal('cancelled'),
  v.literal('replaced'),
)
const guestStatus = v.union(
  v.literal('pending'),
  v.literal('active'),
  v.literal('expired'),
  v.literal('revoked'),
)
const guestAccessRole = v.union(v.literal('viewer'), v.literal('editor'))

const workspaceValidator = v.object({
  workspaceId: v.string(),
  kind: workspaceKind,
  name: v.string(),
  slug: v.string(),
  status: workspaceStatus,
  createdByPrincipalId: v.optional(v.string()),
  personalOwnerUserId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})

const principalValidator = v.object({
  principalId: v.string(),
  workspaceId: v.string(),
  type: principalKind,
  userId: v.optional(v.string()),
  agentId: v.optional(v.string()),
  serviceId: v.optional(v.string()),
  displayName: v.string(),
  email: v.optional(v.string()),
  createdByPrincipalId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})

const membershipValidator = v.object({
  workspaceId: v.string(),
  principalId: v.string(),
  role: membershipRole,
  status: membershipStatus,
  invitedByPrincipalId: v.optional(v.string()),
  joinedAt: v.number(),
  updatedAt: v.number(),
})

const invitationValidator = v.object({
  invitationId: v.string(),
  workspaceId: v.string(),
  email: v.string(),
  role: invitationRole,
  status: invitationStatus,
  invitedByPrincipalId: v.string(),
  expiresAt: v.number(),
  acceptedByPrincipalId: v.optional(v.string()),
  acceptedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
  replacedByInvitationId: v.optional(v.string()),
  replacedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const teamValidator = v.object({
  teamId: v.string(),
  workspaceId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  createdByPrincipalId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})

const teamMembershipValidator = v.object({
  workspaceId: v.string(),
  teamId: v.string(),
  principalId: v.string(),
  principalType: v.union(v.literal('human'), v.literal('agent')),
  addedByPrincipalId: v.optional(v.string()),
  createdAt: v.number(),
})

const resourceGuestValidator = v.object({
  resourceGuestId: v.string(),
  workspaceId: v.string(),
  resourceType: v.string(),
  resourceId: v.string(),
  principalId: v.string(),
  accessRole: guestAccessRole,
  status: guestStatus,
  grantedByPrincipalId: v.string(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const resourceScopeValidator = v.object({
  workspaceId: v.string(),
  resourceType: v.string(),
  resourceId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const workspaceAccessValidator = v.object({
  workspace: workspaceValidator,
  principal: principalValidator,
  membership: membershipValidator,
})

export const ensurePersonalWorkspaceByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    principalId: v.string(),
    membershipId: v.string(),
    userId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    workspaceName: v.string(),
    now: v.number(),
  },
  returns: workspaceAccessValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('workspaces')
      .withIndex('by_personalOwnerUserId', (q) => q.eq('personalOwnerUserId', args.userId))
      .unique()
    if (existing) {
      const access = await requireHumanAccess(ctx, existing, args.userId, true)
      return access
    }

    await requireUnusedId(ctx, 'workspace', args.workspaceId)
    await requireUnusedId(ctx, 'principal', args.principalId)
    await requireUnusedId(ctx, 'membership', args.membershipId)
    const now = args.now
    const workspace = await insertAndRead(ctx, 'workspaces', {
      workspaceId: args.workspaceId,
      kind: 'personal',
      name: requiredName(args.workspaceName, 'Workspace'),
      slug: `personal-${slugify(args.workspaceId)}`,
      status: 'active',
      createdByPrincipalId: args.principalId,
      personalOwnerUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    })
    const principal = await insertAndRead(ctx, 'workspacePrincipals', {
      principalId: args.principalId,
      workspaceId: args.workspaceId,
      type: 'human',
      userId: args.userId,
      displayName: args.displayName.trim(),
      email: optionalEmail(args.email),
      createdAt: now,
      updatedAt: now,
    })
    const membership = await insertAndRead(ctx, 'workspaceMemberships', {
      membershipId: args.membershipId,
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
    return {
      workspace: workspaceValue(workspace),
      principal: principalValue(principal),
      membership: membershipValue(membership),
    }
  },
})

export const createOrganizationByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    principalId: v.string(),
    membershipId: v.string(),
    creatorUserId: v.string(),
    creatorDisplayName: v.string(),
    creatorEmail: v.optional(v.string()),
    name: v.string(),
    slug: v.optional(v.string()),
    now: v.number(),
  },
  returns: workspaceAccessValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireUnusedId(ctx, 'workspace', args.workspaceId)
    await requireUnusedId(ctx, 'principal', args.principalId)
    await requireUnusedId(ctx, 'membership', args.membershipId)
    const now = args.now
    const slug = slugify(args.slug ?? args.name)
    const duplicateSlug = await ctx.db.query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
    if (duplicateSlug) throw new Error('WORKSPACE_SLUG_ALREADY_EXISTS')
    const workspace = await insertAndRead(ctx, 'workspaces', {
      workspaceId: args.workspaceId,
      kind: 'organization',
      name: requiredName(args.name, 'Workspace'),
      slug,
      status: 'active',
      createdByPrincipalId: args.principalId,
      createdAt: now,
      updatedAt: now,
    })
    const principal = await insertAndRead(ctx, 'workspacePrincipals', {
      principalId: args.principalId,
      workspaceId: args.workspaceId,
      type: 'human',
      userId: args.creatorUserId,
      displayName: requiredName(args.creatorDisplayName, 'Principal'),
      email: optionalEmail(args.creatorEmail),
      createdAt: now,
      updatedAt: now,
    })
    const membership = await insertAndRead(ctx, 'workspaceMemberships', {
      membershipId: args.membershipId,
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
    const generalChannelId = await ctx.db.insert('conversations', {
      userId: args.creatorUserId,
      workspaceId: args.workspaceId,
      conversationType: 'channel',
      createdByPrincipalId: args.principalId,
      title: 'general',
      lastModified: now,
      updatedAt: now,
      createdAt: now,
      lastMode: 'act',
      askModelIds: ['moonshotai/kimi-k2.6'],
      actModelId: 'moonshotai/kimi-k2.6',
      channelSlug: 'general',
      channelVisibility: 'public',
      channelTopic: 'Company-wide announcements and conversation',
    })
    await ctx.db.insert('conversationParticipants', {
      conversationId: generalChannelId,
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      principalType: 'human',
      role: 'moderator',
      status: 'active',
      notificationLevel: 'all',
      joinedAt: now,
      updatedAt: now,
      lastReadAt: now,
    })
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: args.workspaceId,
      resourceType: 'conversation',
      resourceId: generalChannelId,
      createdAt: now,
      updatedAt: now,
    })
    return {
      workspace: workspaceValue(workspace),
      principal: principalValue(principal),
      membership: membershipValue(membership),
    }
  },
})

export const listForUserByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(workspaceAccessValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principals = await ctx.db.query('workspacePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(MAX_DIRECTORY_ROWS)
    const accesses = await Promise.all(principals.map(async (principal) => {
      const [workspace, membership] = await Promise.all([
        getWorkspace(ctx, principal.workspaceId),
        ctx.db.query('workspaceMemberships')
          .withIndex('by_workspaceId_principalId', (q) =>
            q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId))
          .unique(),
      ])
      if (!workspace || !membership || membership.status !== 'active') return null
      return {
        workspace: workspaceValue(workspace),
        principal: principalValue(principal),
        membership: membershipValue(membership),
      }
    }))
    return accesses
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) =>
        Number(right.workspace.kind === 'personal') - Number(left.workspace.kind === 'personal')
        || left.workspace.name.localeCompare(right.workspace.name))
  },
})

export const getWorkspaceByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.union(workspaceValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const workspace = await getWorkspace(ctx, args.workspaceId)
    return workspace ? workspaceValue(workspace) : null
  },
})

export const getAuthorizedWorkspaceByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    userId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.union(workspaceAccessValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const workspace = await getWorkspace(ctx, args.workspaceId)
    if (!workspace || (workspace.status === 'archived' && !args.includeArchived)) return null
    return await findHumanAccess(ctx, workspace, args.userId, false)
  },
})

export const resolveActiveWorkspaceByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.union(workspaceAccessValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const preference = await ctx.db.query('workspaceUserPreferences')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    if (preference) {
      const workspace = await getWorkspace(ctx, preference.activeWorkspaceId)
      if (workspace?.status === 'active') {
        const access = await findHumanAccess(ctx, workspace, args.userId, false)
        if (access) return access
      }
    }

    const principals = await ctx.db.query('workspacePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(MAX_DIRECTORY_ROWS)
    for (const principal of principals) {
      const workspace = await getWorkspace(ctx, principal.workspaceId)
      if (!workspace || workspace.status !== 'active') continue
      const membership = await getMembershipForPrincipal(ctx, workspace.workspaceId, principal.principalId)
      if (!membership || membership.status !== 'active') continue
      await upsertActivePreference(ctx, args.userId, workspace.workspaceId)
      return {
        workspace: workspaceValue(workspace),
        principal: principalValue(principal),
        membership: membershipValue(membership),
      }
    }
    return null
  },
})

export const switchActiveWorkspaceByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    userId: v.string(),
    now: v.number(),
  },
  returns: workspaceAccessValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const workspace = await requireActiveWorkspace(ctx, args.workspaceId)
    const access = await requireHumanAccess(ctx, workspace, args.userId, false)
    await upsertActivePreference(ctx, args.userId, workspace.workspaceId, args.now)
    return access
  },
})

export const createPrincipalByServer = mutation({
  args: {
    serverSecret: v.string(),
    principalId: v.string(),
    workspaceId: v.string(),
    type: principalKind,
    userId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    displayName: v.string(),
    email: v.optional(v.string()),
    createdByPrincipalId: v.optional(v.string()),
    now: v.number(),
  },
  returns: principalValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    if (args.createdByPrincipalId) {
      await requirePrincipal(ctx, args.workspaceId, args.createdByPrincipalId)
    }
    await requireUnusedId(ctx, 'principal', args.principalId)
    const subjectId = requirePrincipalSubject(args)
    const existing = args.type === 'human'
      ? await ctx.db.query('workspacePrincipals')
        .withIndex('by_workspaceId_userId', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('userId', subjectId))
        .unique()
      : args.type === 'agent'
        ? await ctx.db.query('workspacePrincipals')
          .withIndex('by_workspaceId_agentId', (q) =>
            q.eq('workspaceId', args.workspaceId).eq('agentId', subjectId))
          .unique()
        : await ctx.db.query('workspacePrincipals')
          .withIndex('by_workspaceId_serviceId', (q) =>
            q.eq('workspaceId', args.workspaceId).eq('serviceId', subjectId))
          .unique()
    if (existing) throw new Error('WORKSPACE_PRINCIPAL_SUBJECT_ALREADY_EXISTS')
    const now = args.now
    return principalValue(await insertAndRead(ctx, 'workspacePrincipals', {
      principalId: args.principalId,
      workspaceId: args.workspaceId,
      type: args.type,
      userId: args.userId,
      agentId: args.agentId,
      serviceId: args.serviceId,
      displayName: requiredName(args.displayName, 'Principal'),
      email: optionalEmail(args.email),
      createdByPrincipalId: args.createdByPrincipalId,
      createdAt: now,
      updatedAt: now,
    }))
  },
})

export const updatePrincipalByServer = mutation({
  args: {
    serverSecret: v.string(),
    principalId: v.string(),
    workspaceId: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: principalValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principal = await requirePrincipal(ctx, args.workspaceId, args.principalId)
    const patch = {
      ...(args.displayName === undefined
        ? {}
        : { displayName: requiredName(args.displayName, 'Principal') }),
      ...(args.email === undefined ? {} : { email: optionalEmail(args.email) }),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(principal._id, patch)
    return principalValue({ ...principal, ...patch })
  },
})

export const getPrincipalByServer = query({
  args: { serverSecret: v.string(), principalId: v.string() },
  returns: v.union(principalValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principal = await getPrincipal(ctx, args.principalId)
    return principal ? principalValue(principal) : null
  },
})

export const getHumanPrincipalByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), userId: v.string() },
  returns: v.union(principalValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('userId', args.userId))
      .unique()
    return principal?.type === 'human' ? principalValue(principal) : null
  },
})

export const listPrincipalsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    includeArchived: v.boolean(),
    type: v.optional(principalKind),
  },
  returns: v.array(principalValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const principals = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(MAX_DIRECTORY_ROWS)
    return principals
      .filter((principal) =>
        (args.includeArchived || principal.archivedAt === undefined)
        && (!args.type || principal.type === args.type))
      .map(principalValue)
  },
})

export const archivePrincipalByServer = mutation({
  args: { serverSecret: v.string(), principalId: v.string(), now: v.number() },
  returns: v.object({ archived: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principal = await getPrincipal(ctx, args.principalId)
    if (!principal) return { archived: false }
    if (principal.archivedAt !== undefined) return { archived: true }
    const membership = await getMembershipForPrincipal(
      ctx,
      principal.workspaceId,
      principal.principalId,
    )
    if (membership?.role === 'owner' && membership.status === 'active') {
      await requireAnotherActiveOwner(ctx, principal.workspaceId, principal.principalId)
    }
    if (membership?.status === 'active') {
      await ctx.db.patch(membership._id, { status: 'suspended', updatedAt: args.now })
    }
    await ctx.db.patch(principal._id, { archivedAt: args.now, updatedAt: args.now })
    return { archived: true }
  },
})

export const inviteByServer = mutation({
  args: {
    serverSecret: v.string(),
    invitationId: v.string(),
    workspaceId: v.string(),
    email: v.string(),
    role: invitationRole,
    invitedByPrincipalId: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  returns: invitationValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.invitedByPrincipalId)
    await requireUnusedId(ctx, 'invitation', args.invitationId)
    const email = requiredEmail(args.email)
    const duplicate = await ctx.db.query('workspaceInvitations')
      .withIndex('by_workspaceId_email_status', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('email', email).eq('status', 'pending'))
      .first()
    if (duplicate && duplicate.expiresAt > args.now) {
      await ctx.db.patch(duplicate._id, {
        status: 'replaced',
        replacedByInvitationId: args.invitationId,
        replacedAt: args.now,
        updatedAt: args.now,
      })
    }
    if (duplicate && duplicate.expiresAt <= args.now) {
      await ctx.db.patch(duplicate._id, { status: 'expired', updatedAt: args.now })
    }
    if (args.expiresAt <= args.now) throw new Error('WORKSPACE_INVITATION_EXPIRY_INVALID')
    const now = args.now
    return invitationValue(await insertAndRead(ctx, 'workspaceInvitations', {
      invitationId: args.invitationId,
      workspaceId: args.workspaceId,
      email,
      role: args.role,
      status: 'pending',
      invitedByPrincipalId: args.invitedByPrincipalId,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    }))
  },
})

export const acceptInvitationByServer = mutation({
  args: {
    serverSecret: v.string(),
    invitationId: v.string(),
    principalId: v.string(),
    membershipId: v.string(),
    userId: v.string(),
    email: v.string(),
    displayName: v.string(),
    now: v.number(),
  },
  returns: workspaceAccessValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const invitation = await getInvitation(ctx, args.invitationId)
    if (!invitation) throw new Error('WORKSPACE_INVITATION_NOT_FOUND')
    if (invitation.status !== 'pending') throw new Error(`WORKSPACE_INVITATION_${invitation.status.toUpperCase()}`)
    const now = args.now
    if (invitation.expiresAt <= now) {
      await ctx.db.patch(invitation._id, { status: 'expired', updatedAt: now })
      throw new Error('WORKSPACE_INVITATION_EXPIRED')
    }
    if (requiredEmail(args.email) !== invitation.email) {
      throw new Error('WORKSPACE_INVITATION_EMAIL_MISMATCH')
    }
    const workspace = await requireActiveWorkspace(ctx, invitation.workspaceId)
    let principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) =>
        q.eq('workspaceId', workspace.workspaceId).eq('userId', args.userId))
      .unique()
    if (!principal) {
      await requireUnusedId(ctx, 'principal', args.principalId)
      principal = await insertAndRead(ctx, 'workspacePrincipals', {
        principalId: args.principalId,
        workspaceId: workspace.workspaceId,
        type: 'human',
        userId: args.userId,
        displayName: requiredName(args.displayName, 'Principal'),
        email: invitation.email,
        createdAt: now,
        updatedAt: now,
      })
    }
    let membership = await getMembershipForPrincipal(ctx, workspace.workspaceId, principal.principalId)
    if (membership) {
      if (membership.role === 'owner' && membership.status === 'active') {
        await requireAnotherActiveOwner(ctx, workspace.workspaceId, membership.principalId)
      }
      await ctx.db.patch(membership._id, {
        role: invitation.role,
        status: 'active',
        updatedAt: now,
      })
      membership = {
        ...membership,
        role: invitation.role,
        status: 'active',
        updatedAt: now,
      }
    } else {
      await requireUnusedId(ctx, 'membership', args.membershipId)
      membership = await insertAndRead(ctx, 'workspaceMemberships', {
        membershipId: args.membershipId,
        workspaceId: workspace.workspaceId,
        principalId: principal.principalId,
        role: invitation.role,
        status: 'active',
        invitedByPrincipalId: invitation.invitedByPrincipalId,
        joinedAt: now,
        updatedAt: now,
      })
    }
    const publicChannels = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) => (
        q.eq('workspaceId', workspace.workspaceId).eq('conversationType', 'channel')
      )).filter((q) => q.and(
        q.eq(q.field('channelVisibility'), 'public'),
        q.eq(q.field('deletedAt'), undefined),
      )).collect()
    for (const channel of publicChannels) {
      const existingParticipant = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) => (
          q.eq('conversationId', channel._id).eq('principalId', principal.principalId)
        )).unique()
      const role = invitation.role === 'admin' ? 'moderator' : 'member'
      if (existingParticipant) {
        await ctx.db.patch(existingParticipant._id, {
          role,
          status: 'active',
          removedAt: undefined,
          archivedAt: undefined,
          updatedAt: now,
        })
      } else {
        await ctx.db.insert('conversationParticipants', {
          conversationId: channel._id,
          workspaceId: workspace.workspaceId,
          principalId: principal.principalId,
          principalType: 'human',
          role,
          status: 'active',
          notificationLevel: 'all',
          joinedAt: now,
          updatedAt: now,
        })
      }
    }
    await ctx.db.patch(invitation._id, {
      status: 'accepted',
      acceptedByPrincipalId: principal.principalId,
      acceptedAt: now,
      updatedAt: now,
    })
    return {
      workspace: workspaceValue(workspace),
      principal: principalValue(principal),
      membership: membershipValue(membership),
    }
  },
})

export const replaceInvitationByServer = mutation({
  args: {
    serverSecret: v.string(),
    invitationId: v.string(),
    replacementInvitationId: v.string(),
    workspaceId: v.string(),
    invitedByPrincipalId: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  returns: invitationValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await getInvitation(ctx, args.invitationId)
    if (!existing || existing.workspaceId !== args.workspaceId) {
      throw new Error('WORKSPACE_INVITATION_NOT_FOUND')
    }
    if (existing.status !== 'pending') {
      throw new Error(`WORKSPACE_INVITATION_${existing.status.toUpperCase()}`)
    }
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.invitedByPrincipalId)
    await requireUnusedId(ctx, 'invitation', args.replacementInvitationId)
    if (args.expiresAt <= args.now) throw new Error('WORKSPACE_INVITATION_EXPIRY_INVALID')
    const now = args.now
    const replacement = await insertAndRead(ctx, 'workspaceInvitations', {
      invitationId: args.replacementInvitationId,
      workspaceId: existing.workspaceId,
      email: existing.email,
      role: existing.role,
      status: 'pending',
      invitedByPrincipalId: args.invitedByPrincipalId,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(existing._id, {
      status: 'replaced',
      replacedByInvitationId: replacement.invitationId,
      replacedAt: now,
      updatedAt: now,
    })
    return invitationValue(replacement)
  },
})

export const cancelInvitationByServer = mutation({
  args: {
    serverSecret: v.string(),
    invitationId: v.string(),
    workspaceId: v.string(),
    cancelledByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: invitationValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const invitation = await getInvitation(ctx, args.invitationId)
    if (!invitation || invitation.workspaceId !== args.workspaceId) {
      throw new Error('WORKSPACE_INVITATION_NOT_FOUND')
    }
    await requirePrincipal(ctx, invitation.workspaceId, args.cancelledByPrincipalId)
    if (invitation.status !== 'pending') {
      throw new Error(`WORKSPACE_INVITATION_${invitation.status.toUpperCase()}`)
    }
    const now = args.now
    await ctx.db.patch(invitation._id, {
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    })
    return invitationValue({
      ...invitation,
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    })
  },
})

export const listInvitationsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    status: v.optional(invitationStatus),
  },
  returns: v.array(invitationValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const invitations = await ctx.db.query('workspaceInvitations')
      .withIndex('by_workspaceId_createdAt', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(MAX_DIRECTORY_ROWS)
    return invitations
      .map((row) => invitationValueWithExpiry(row))
      .filter((row) => !args.status || row.status === args.status)
  },
})

export const getInvitationByServer = query({
  args: { serverSecret: v.string(), invitationId: v.string() },
  returns: v.union(invitationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const invitation = await getInvitation(ctx, args.invitationId)
    return invitation ? invitationValueWithExpiry(invitation) : null
  },
})

export const expireInvitationsByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.object({ expired: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.workspaceId) await requireWorkspace(ctx, args.workspaceId)
    const pending = args.workspaceId
      ? await ctx.db.query('workspaceInvitations')
        .withIndex('by_workspaceId_status_expiresAt', (q) =>
          q.eq('workspaceId', args.workspaceId!).eq('status', 'pending').lte('expiresAt', args.now))
        .take(MAX_DIRECTORY_ROWS)
      : await ctx.db.query('workspaceInvitations')
        .withIndex('by_status_expiresAt', (q) =>
          q.eq('status', 'pending').lte('expiresAt', args.now))
        .take(MAX_DIRECTORY_ROWS)
    for (const invitation of pending) {
      await ctx.db.patch(invitation._id, { status: 'expired', updatedAt: args.now })
    }
    return { expired: pending.length }
  },
})

export const listMembersByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.array(v.object({
    principal: principalValidator,
    membership: membershipValidator,
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const memberships = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(MAX_DIRECTORY_ROWS)
    const entries = await Promise.all(memberships.map(async (membership) => {
      const principal = await getPrincipal(ctx, membership.principalId)
      if (!principal || principal.workspaceId !== args.workspaceId) return null
      return {
        principal: principalValue(principal),
        membership: membershipValue(membership),
      }
    }))
    return entries.filter((value): value is NonNullable<typeof value> => value !== null)
  },
})

export const getMembershipByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), principalId: v.string() },
  returns: v.union(membershipValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const membership = await getMembershipForPrincipal(ctx, args.workspaceId, args.principalId)
    return membership ? membershipValue(membership) : null
  },
})

export const listMembershipsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    status: v.optional(membershipStatus),
  },
  returns: v.array(membershipValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const rows = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(MAX_DIRECTORY_ROWS)
    return rows
      .filter((row) => !args.status || row.status === args.status)
      .map(membershipValue)
  },
})

export const addMemberByServer = mutation({
  args: {
    serverSecret: v.string(),
    membershipId: v.string(),
    workspaceId: v.string(),
    principalId: v.string(),
    role: membershipRole,
    status: membershipStatus,
    invitedByPrincipalId: v.optional(v.string()),
  },
  returns: membershipValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.principalId)
    if (args.invitedByPrincipalId) {
      await requirePrincipal(ctx, args.workspaceId, args.invitedByPrincipalId)
    }
    const existing = await getMembershipForPrincipal(ctx, args.workspaceId, args.principalId)
    if (existing) throw new Error('WORKSPACE_MEMBERSHIP_ALREADY_EXISTS')
    await requireUnusedId(ctx, 'membership', args.membershipId)
    const now = Date.now()
    return membershipValue(await insertAndRead(ctx, 'workspaceMemberships', {
      membershipId: args.membershipId,
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      role: args.role,
      status: args.status,
      invitedByPrincipalId: args.invitedByPrincipalId,
      joinedAt: now,
      updatedAt: now,
    }))
  },
})

export const updateMemberByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    principalId: v.string(),
    role: v.optional(membershipRole),
    status: v.optional(membershipStatus),
    now: v.number(),
  },
  returns: membershipValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const membership = await getMembershipForPrincipal(ctx, args.workspaceId, args.principalId)
    if (!membership) throw new Error('WORKSPACE_MEMBERSHIP_NOT_FOUND')
    const nextRole = args.role ?? membership.role
    const nextStatus = args.status ?? membership.status
    if (
      membership.role === 'owner'
      && membership.status === 'active'
      && (nextRole !== 'owner' || nextStatus !== 'active')
    ) {
      await requireAnotherActiveOwner(ctx, args.workspaceId, membership.principalId)
    }
    if (nextRole === 'owner') {
      const principal = await requirePrincipal(ctx, args.workspaceId, membership.principalId)
      if (principal.type !== 'human') throw new Error('WORKSPACE_OWNER_MUST_BE_HUMAN')
    }
    const patch = { role: nextRole, status: nextStatus, updatedAt: args.now }
    await ctx.db.patch(membership._id, patch)
    return membershipValue({ ...membership, ...patch })
  },
})

export const removeMemberByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    principalId: v.string(),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const membership = await getMembershipForPrincipal(ctx, args.workspaceId, args.principalId)
    if (!membership) throw new Error('WORKSPACE_MEMBERSHIP_NOT_FOUND')
    if (membership.role === 'owner' && membership.status === 'active') {
      await requireAnotherActiveOwner(ctx, args.workspaceId, membership.principalId)
    }
    await ctx.db.delete(membership._id)
    return { removed: true }
  },
})

export const transferOwnershipByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    fromPrincipalId: v.string(),
    toPrincipalId: v.string(),
    now: v.number(),
  },
  returns: v.object({
    previousOwner: membershipValidator,
    owner: membershipValidator,
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    const previousOwner = await getMembershipForPrincipal(
      ctx,
      args.workspaceId,
      args.fromPrincipalId,
    )
    const owner = await getMembershipForPrincipal(ctx, args.workspaceId, args.toPrincipalId)
    if (!previousOwner || previousOwner.role !== 'owner' || previousOwner.status !== 'active') {
      throw new Error('WORKSPACE_OWNER_REQUIRED')
    }
    if (!owner || owner.status !== 'active') throw new Error('WORKSPACE_TRANSFER_TARGET_INVALID')
    const targetPrincipal = await requirePrincipal(ctx, args.workspaceId, args.toPrincipalId)
    if (targetPrincipal.type !== 'human') throw new Error('WORKSPACE_TRANSFER_TARGET_NOT_HUMAN')
    if (previousOwner._id === owner._id) {
      return {
        previousOwner: membershipValue(previousOwner),
        owner: membershipValue(owner),
      }
    }
    const now = args.now
    await ctx.db.patch(owner._id, { role: 'owner', updatedAt: now })
    await ctx.db.patch(previousOwner._id, { role: 'admin', updatedAt: now })
    return {
      previousOwner: membershipValue({ ...previousOwner, role: 'admin', updatedAt: now }),
      owner: membershipValue({ ...owner, role: 'owner', updatedAt: now }),
    }
  },
})

export const archiveByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    archivedByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: workspaceValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const workspace = await requireWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.archivedByPrincipalId)
    if (workspace.status === 'archived') return workspaceValue(workspace)
    const now = args.now
    await ctx.db.patch(workspace._id, { status: 'archived', archivedAt: now, updatedAt: now })
    return workspaceValue({
      ...workspace,
      status: 'archived',
      archivedAt: now,
      updatedAt: now,
    })
  },
})

/**
 * Permanent erasure is intentionally separate from the user-facing archive
 * operation. Only already-archived organization workspaces may be purged.
 */
export const purgeArchivedWorkspaceByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
  },
  returns: v.object({ deletedRows: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const workspace = await requireWorkspace(ctx, args.workspaceId)
    if (workspace.kind !== 'organization' || workspace.status !== 'archived') {
      throw new Error('WORKSPACE_ARCHIVE_REQUIRED')
    }
    let deletedRows = 0
    const deleteRows = async (
      rows: Array<{ _id: Parameters<typeof ctx.db.delete>[0] }>,
    ) => {
      for (const row of rows) {
        await ctx.db.delete(row._id)
        deletedRows += 1
      }
    }
    const teams = await ctx.db.query('workspaceTeams')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    for (const team of teams) {
      await deleteRows(await ctx.db.query('workspaceTeamMemberships')
        .withIndex('by_teamId', (q) => q.eq('teamId', team.teamId))
        .collect())
    }
    const workspaceConversations = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    for (const conversation of workspaceConversations) {
      await deleteRows(await ctx.db.query('conversationMessageReactions')
        .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', conversation._id))
        .collect())
      await deleteRows(await ctx.db.query('conversationPins')
        .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', conversation._id))
        .collect())
      const savedMessages = await ctx.db.query('conversationSavedMessages').collect()
      await deleteRows(savedMessages.filter((row) => row.conversationId === conversation._id))
      await deleteRows(await ctx.db.query('conversationMessages')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
        .collect())
      await ctx.db.delete(conversation._id)
      deletedRows += 1
    }
    await deleteRows(await ctx.db.query('workspaceResourceGuests')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('workspaceResourceScopes')
      .withIndex('by_workspaceId_resource', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('workspacePresence')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('workspaceNotifications')
      .withIndex('by_workspaceId_recipientPrincipalId_createdAt', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('workspaceInvitations')
      .withIndex('by_workspaceId_createdAt', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    await deleteRows(teams)
    await deleteRows(await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect())
    const preferences = await ctx.db.query('workspaceUserPreferences').collect()
    await deleteRows(preferences.filter((row) => row.activeWorkspaceId === args.workspaceId))
    await ctx.db.delete(workspace._id)
    deletedRows += 1
    return { deletedRows }
  },
})

export const createTeamByServer = mutation({
  args: {
    serverSecret: v.string(),
    teamId: v.string(),
    workspaceId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    createdByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: teamValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.createdByPrincipalId)
    await requireUnusedId(ctx, 'team', args.teamId)
    const name = requiredName(args.name, 'Team')
    const duplicate = await ctx.db.query('workspaceTeams')
      .withIndex('by_workspaceId_name', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('name', name))
      .first()
    if (duplicate) throw new Error('WORKSPACE_TEAM_NAME_ALREADY_EXISTS')
    const now = args.now
    return teamValue(await insertAndRead(ctx, 'workspaceTeams', {
      teamId: args.teamId,
      workspaceId: args.workspaceId,
      name,
      description: optionalText(args.description),
      createdByPrincipalId: args.createdByPrincipalId,
      createdAt: now,
      updatedAt: now,
    }))
  },
})

export const updateTeamByServer = mutation({
  args: {
    serverSecret: v.string(),
    teamId: v.string(),
    workspaceId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: teamValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const team = await requireTeam(ctx, args.workspaceId, args.teamId)
    const patch = {
      ...(args.name === undefined ? {} : { name: requiredName(args.name, 'Team') }),
      ...(args.description === undefined ? {} : { description: optionalText(args.description) }),
      updatedAt: Date.now(),
    }
    if (patch.name && patch.name !== team.name) {
      const nextName = patch.name
      const duplicate = await ctx.db.query('workspaceTeams')
        .withIndex('by_workspaceId_name', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('name', nextName))
        .first()
      if (duplicate && duplicate._id !== team._id) {
        throw new Error('WORKSPACE_TEAM_NAME_ALREADY_EXISTS')
      }
    }
    await ctx.db.patch(team._id, patch)
    return teamValue({ ...team, ...patch })
  },
})

export const deleteTeamByServer = mutation({
  args: { serverSecret: v.string(), teamId: v.string(), workspaceId: v.string() },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const team = await requireTeam(ctx, args.workspaceId, args.teamId)
    const memberships = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_teamId', (q) => q.eq('teamId', args.teamId))
      .take(MAX_DIRECTORY_ROWS + 1)
    if (memberships.length > MAX_DIRECTORY_ROWS) {
      throw new Error('WORKSPACE_TEAM_TOO_LARGE_TO_DELETE')
    }
    for (const membership of memberships) await ctx.db.delete(membership._id)
    await ctx.db.delete(team._id)
    return { removed: true }
  },
})

export const listTeamsByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.array(v.object({
    team: teamValidator,
    memberships: v.array(teamMembershipValidator),
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const teams = await ctx.db.query('workspaceTeams')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(MAX_DIRECTORY_ROWS)
    return await Promise.all(teams.map(async (team) => ({
      team: teamValue(team),
      memberships: (await ctx.db.query('workspaceTeamMemberships')
        .withIndex('by_teamId', (q) => q.eq('teamId', team.teamId))
        .take(MAX_DIRECTORY_ROWS))
        .map(teamMembershipValue),
    })))
  },
})

export const getTeamByServer = query({
  args: { serverSecret: v.string(), teamId: v.string() },
  returns: v.union(teamValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const team = await getTeam(ctx, args.teamId)
    return team ? teamValue(team) : null
  },
})

export const listTeamsOnlyByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    includeArchived: v.boolean(),
  },
  returns: v.array(teamValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const teams = await ctx.db.query('workspaceTeams')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(MAX_DIRECTORY_ROWS)
    return teams
      .filter((team) => args.includeArchived || team.archivedAt === undefined)
      .map(teamValue)
  },
})

export const archiveTeamByServer = mutation({
  args: { serverSecret: v.string(), teamId: v.string(), now: v.number() },
  returns: v.object({ archived: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const team = await getTeam(ctx, args.teamId)
    if (!team) return { archived: false }
    if (team.archivedAt === undefined) {
      await ctx.db.patch(team._id, { archivedAt: args.now, updatedAt: args.now })
    }
    return { archived: true }
  },
})

export const listTeamMembersByServer = query({
  args: { serverSecret: v.string(), teamId: v.string() },
  returns: v.array(teamMembershipValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const team = await getTeam(ctx, args.teamId)
    if (!team) return []
    const rows = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_teamId', (q) => q.eq('teamId', args.teamId))
      .take(MAX_DIRECTORY_ROWS)
    return rows.map(teamMembershipValue)
  },
})

export const addTeamPrincipalByServer = mutation({
  args: {
    serverSecret: v.string(),
    teamMembershipId: v.string(),
    workspaceId: v.string(),
    teamId: v.string(),
    principalId: v.string(),
    principalType: v.union(v.literal('human'), v.literal('agent')),
    addedByPrincipalId: v.optional(v.string()),
    now: v.number(),
  },
  returns: teamMembershipValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireTeam(ctx, args.workspaceId, args.teamId)
    const principal = await requirePrincipal(ctx, args.workspaceId, args.principalId)
    if (args.addedByPrincipalId) {
      await requirePrincipal(ctx, args.workspaceId, args.addedByPrincipalId)
    }
    if (principal.type === 'service') throw new Error('WORKSPACE_TEAM_PRINCIPAL_TYPE_INVALID')
    if (principal.type !== args.principalType) {
      throw new Error('WORKSPACE_TEAM_PRINCIPAL_TYPE_MISMATCH')
    }
    await requireUnusedId(ctx, 'teamMembership', args.teamMembershipId)
    const existing = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_teamId_principalId', (q) =>
        q.eq('teamId', args.teamId).eq('principalId', args.principalId))
      .unique()
    if (existing) return teamMembershipValue(existing)
    return teamMembershipValue(await insertAndRead(ctx, 'workspaceTeamMemberships', {
      teamMembershipId: args.teamMembershipId,
      workspaceId: args.workspaceId,
      teamId: args.teamId,
      principalId: args.principalId,
      principalType: principal.type,
      addedByPrincipalId: args.addedByPrincipalId,
      createdAt: args.now,
    }))
  },
})

export const removeTeamPrincipalByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    teamId: v.string(),
    principalId: v.string(),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireTeam(ctx, args.workspaceId, args.teamId)
    const membership = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_teamId_principalId', (q) =>
        q.eq('teamId', args.teamId).eq('principalId', args.principalId))
      .unique()
    if (!membership || membership.workspaceId !== args.workspaceId) return { removed: false }
    await ctx.db.delete(membership._id)
    return { removed: true }
  },
})

export const createResourceGuestByServer = mutation({
  args: {
    serverSecret: v.string(),
    resourceGuestId: v.string(),
    workspaceId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    principalId: v.string(),
    accessRole: guestAccessRole,
    status: v.union(v.literal('pending'), v.literal('active')),
    expiresAt: v.optional(v.number()),
    grantedByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: resourceGuestValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.principalId)
    await requirePrincipal(ctx, args.workspaceId, args.grantedByPrincipalId)
    await requireUnusedId(ctx, 'resourceGuest', args.resourceGuestId)
    if (args.expiresAt !== undefined && args.expiresAt <= args.now) {
      throw new Error('WORKSPACE_RESOURCE_GUEST_EXPIRY_INVALID')
    }
    const now = args.now
    return resourceGuestValue(await insertAndRead(ctx, 'workspaceResourceGuests', {
      resourceGuestId: args.resourceGuestId,
      workspaceId: args.workspaceId,
      resourceType: requiredName(args.resourceType, 'Resource type'),
      resourceId: requiredName(args.resourceId, 'Resource'),
      principalId: args.principalId,
      accessRole: args.accessRole,
      status: args.status,
      expiresAt: args.expiresAt,
      grantedByPrincipalId: args.grantedByPrincipalId,
      createdAt: now,
      updatedAt: now,
    }))
  },
})

export const bindResourceByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    now: v.number(),
  },
  returns: resourceScopeValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    const resourceType = requiredName(args.resourceType, 'Resource type')
    const resourceId = requiredName(args.resourceId, 'Resource')
    const existing = await ctx.db.query('workspaceResourceScopes')
      .withIndex('by_resource', (q) =>
        q.eq('resourceType', resourceType).eq('resourceId', resourceId))
      .unique()
    if (existing) {
      if (existing.workspaceId !== args.workspaceId) {
        throw new Error('WORKSPACE_RESOURCE_SCOPE_CONFLICT')
      }
      await ctx.db.patch(existing._id, { updatedAt: args.now })
      return {
        workspaceId: existing.workspaceId,
        resourceType: existing.resourceType,
        resourceId: existing.resourceId,
        createdAt: existing.createdAt,
        updatedAt: args.now,
      }
    }
    return resourceScopeValue(await insertAndRead(ctx, 'workspaceResourceScopes', {
      workspaceId: args.workspaceId,
      resourceType,
      resourceId,
      createdAt: args.now,
      updatedAt: args.now,
    }))
  },
})

export const getResourceWorkspaceByServer = query({
  args: {
    serverSecret: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
  },
  returns: v.union(resourceScopeValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('workspaceResourceScopes')
      .withIndex('by_resource', (q) =>
        q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId))
      .unique()
    if (!row) return null
    return {
      workspaceId: row.workspaceId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
    }
  },
})

export const revokeResourceGuestByServer = mutation({
  args: {
    serverSecret: v.string(),
    resourceGuestId: v.string(),
    workspaceId: v.string(),
    revokedByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: resourceGuestValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const guest = await ctx.db.query('workspaceResourceGuests')
      .withIndex('by_resourceGuestId', (q) => q.eq('resourceGuestId', args.resourceGuestId))
      .unique()
    if (!guest || guest.workspaceId !== args.workspaceId) {
      throw new Error('WORKSPACE_RESOURCE_GUEST_NOT_FOUND')
    }
    await requirePrincipal(ctx, guest.workspaceId, args.revokedByPrincipalId)
    if (guest.status === 'revoked') return resourceGuestValue(guest)
    const now = args.now
    await ctx.db.patch(guest._id, { status: 'revoked', revokedAt: now, updatedAt: now })
    return resourceGuestValue({
      ...guest,
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    })
  },
})

export const listResourceGuestsByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
  },
  returns: v.array(resourceGuestValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireWorkspace(ctx, args.workspaceId)
    const rows = args.resourceType && args.resourceId
      ? await ctx.db.query('workspaceResourceGuests')
        .withIndex('by_workspaceId_resource', (q) =>
          q.eq('workspaceId', args.workspaceId)
            .eq('resourceType', args.resourceType!)
            .eq('resourceId', args.resourceId!))
        .take(MAX_DIRECTORY_ROWS)
      : await ctx.db.query('workspaceResourceGuests')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
        .take(MAX_DIRECTORY_ROWS)
    return rows
      .filter((row) =>
        (!args.resourceType || row.resourceType === args.resourceType)
        && (!args.resourceId || row.resourceId === args.resourceId))
      .map(resourceGuestValueWithExpiry)
  },
})

export const getResourceGuestByServer = query({
  args: { serverSecret: v.string(), resourceGuestId: v.string() },
  returns: v.union(resourceGuestValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const guest = await ctx.db.query('workspaceResourceGuests')
      .withIndex('by_resourceGuestId', (q) => q.eq('resourceGuestId', args.resourceGuestId))
      .unique()
    return guest ? resourceGuestValueWithExpiry(guest) : null
  },
})

type DatabaseReader = QueryCtx['db'] | MutationCtx['db']

async function getWorkspace(ctx: { db: DatabaseReader }, workspaceId: string) {
  return await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .unique()
}

async function requireWorkspace(ctx: { db: DatabaseReader }, workspaceId: string) {
  const workspace = await getWorkspace(ctx, workspaceId)
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
  return workspace
}

async function requireActiveWorkspace(ctx: { db: DatabaseReader }, workspaceId: string) {
  const workspace = await requireWorkspace(ctx, workspaceId)
  if (workspace.status !== 'active') throw new Error('WORKSPACE_ARCHIVED')
  return workspace
}

async function getPrincipal(ctx: { db: DatabaseReader }, principalId: string) {
  return await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', principalId))
    .unique()
}

async function requirePrincipal(
  ctx: { db: DatabaseReader },
  workspaceId: string,
  principalId: string,
) {
  const principal = await getPrincipal(ctx, principalId)
  if (!principal || principal.workspaceId !== workspaceId) {
    throw new Error('WORKSPACE_PRINCIPAL_NOT_FOUND')
  }
  return principal
}

async function getMembershipForPrincipal(
  ctx: { db: DatabaseReader },
  workspaceId: string,
  principalId: string,
) {
  return await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', workspaceId).eq('principalId', principalId))
    .unique()
}

async function findHumanAccess(
  ctx: { db: DatabaseReader },
  workspace: Doc<'workspaces'>,
  userId: string,
  includeSuspended: boolean,
) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) =>
      q.eq('workspaceId', workspace.workspaceId).eq('userId', userId))
    .unique()
  if (!principal) return null
  const membership = await getMembershipForPrincipal(ctx, workspace.workspaceId, principal.principalId)
  if (!membership || (!includeSuspended && membership.status !== 'active')) return null
  return {
    workspace: workspaceValue(workspace),
    principal: principalValue(principal),
    membership: membershipValue(membership),
  }
}

async function requireHumanAccess(
  ctx: { db: DatabaseReader },
  workspace: Doc<'workspaces'>,
  userId: string,
  includeSuspended: boolean,
) {
  const access = await findHumanAccess(ctx, workspace, userId, includeSuspended)
  if (!access) throw new Error('WORKSPACE_ACCESS_DENIED')
  return access
}

async function requireTeam(
  ctx: { db: DatabaseReader },
  workspaceId: string,
  teamId: string,
) {
  const team = await getTeam(ctx, teamId)
  if (!team || team.workspaceId !== workspaceId) throw new Error('WORKSPACE_TEAM_NOT_FOUND')
  return team
}

async function getTeam(ctx: { db: DatabaseReader }, teamId: string) {
  return await ctx.db.query('workspaceTeams')
    .withIndex('by_teamId', (q) => q.eq('teamId', teamId))
    .unique()
}

async function getInvitation(ctx: { db: DatabaseReader }, invitationId: string) {
  return await ctx.db.query('workspaceInvitations')
    .withIndex('by_invitationId', (q) => q.eq('invitationId', invitationId))
    .unique()
}

async function requireAnotherActiveOwner(
  ctx: { db: DatabaseReader },
  workspaceId: string,
  excludedPrincipalId: string,
) {
  const owners = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_role_status', (q) =>
      q.eq('workspaceId', workspaceId).eq('role', 'owner').eq('status', 'active'))
    .take(2)
  if (!owners.some((owner) => owner.principalId !== excludedPrincipalId)) {
    throw new Error('WORKSPACE_LAST_OWNER_REQUIRED')
  }
}

async function upsertActivePreference(
  ctx: Pick<MutationCtx, 'db'>,
  userId: string,
  activeWorkspaceId: string,
  now = Date.now(),
) {
  const existing = await ctx.db.query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
  const updatedAt = now
  if (existing) {
    await ctx.db.patch(existing._id, { activeWorkspaceId, updatedAt })
  } else {
    await ctx.db.insert('workspaceUserPreferences', { userId, activeWorkspaceId, updatedAt })
  }
}

type IdKind =
  | 'workspace'
  | 'principal'
  | 'membership'
  | 'invitation'
  | 'team'
  | 'teamMembership'
  | 'resourceGuest'

async function requireUnusedId(ctx: Pick<MutationCtx, 'db'>, kind: IdKind, id: string) {
  const existing = kind === 'workspace'
    ? await getWorkspace(ctx, id)
    : kind === 'principal'
      ? await getPrincipal(ctx, id)
      : kind === 'membership'
        ? await ctx.db.query('workspaceMemberships')
          .withIndex('by_membershipId', (q) => q.eq('membershipId', id)).unique()
        : kind === 'invitation'
          ? await getInvitation(ctx, id)
          : kind === 'team'
            ? await ctx.db.query('workspaceTeams')
              .withIndex('by_teamId', (q) => q.eq('teamId', id)).unique()
            : kind === 'teamMembership'
              ? await ctx.db.query('workspaceTeamMemberships')
                .withIndex('by_teamMembershipId', (q) => q.eq('teamMembershipId', id)).unique()
              : await ctx.db.query('workspaceResourceGuests')
                .withIndex('by_resourceGuestId', (q) => q.eq('resourceGuestId', id)).unique()
  if (existing) throw new Error(`WORKSPACE_${kind.replace(/[A-Z]/g, (part) => `_${part}`).toUpperCase()}_ID_EXISTS`)
}

async function insertAndRead<
  TableName extends
    | 'workspaces'
    | 'workspacePrincipals'
    | 'workspaceMemberships'
    | 'workspaceInvitations'
    | 'workspaceTeams'
    | 'workspaceTeamMemberships'
    | 'workspaceResourceGuests'
    | 'workspaceResourceScopes',
>(
  ctx: Pick<MutationCtx, 'db'>,
  table: TableName,
  value: Omit<Doc<TableName>, '_id' | '_creationTime'>,
): Promise<Doc<TableName>> {
  // Convex's writer cannot correlate a generic table name with its generic
  // document at this reusable boundary, although each call site is typed.
  const id = await ctx.db.insert(table, value as never)
  const row = await ctx.db.get(id)
  if (!row) throw new Error('WORKSPACE_WRITE_FAILED')
  return row
}

function workspaceValue(row: Doc<'workspaces'>) {
  return {
    workspaceId: row.workspaceId,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdByPrincipalId: row.createdByPrincipalId,
    personalOwnerUserId: row.personalOwnerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

function principalValue(row: Doc<'workspacePrincipals'>) {
  return {
    principalId: row.principalId,
    workspaceId: row.workspaceId,
    type: row.type,
    userId: row.userId,
    agentId: row.agentId,
    serviceId: row.serviceId,
    displayName: row.displayName,
    email: row.email,
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

function membershipValue(row: Doc<'workspaceMemberships'>) {
  return {
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    role: row.role,
    status: row.status,
    invitedByPrincipalId: row.invitedByPrincipalId,
    joinedAt: row.joinedAt,
    updatedAt: row.updatedAt,
  }
}

function invitationValue(row: Doc<'workspaceInvitations'>) {
  return {
    invitationId: row.invitationId,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByPrincipalId: row.invitedByPrincipalId,
    expiresAt: row.expiresAt,
    acceptedByPrincipalId: row.acceptedByPrincipalId,
    acceptedAt: row.acceptedAt,
    cancelledAt: row.cancelledAt,
    replacedByInvitationId: row.replacedByInvitationId,
    replacedAt: row.replacedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function invitationValueWithExpiry(row: Doc<'workspaceInvitations'>) {
  const value = invitationValue(row)
  return value.status === 'pending' && value.expiresAt <= Date.now()
    ? { ...value, status: 'expired' as const }
    : value
}

function teamValue(row: Doc<'workspaceTeams'>) {
  return {
    teamId: row.teamId,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

function teamMembershipValue(row: Doc<'workspaceTeamMemberships'>) {
  return {
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    principalId: row.principalId,
    principalType: row.principalType,
    addedByPrincipalId: row.addedByPrincipalId,
    createdAt: row.createdAt,
  }
}

function resourceGuestValue(row: Doc<'workspaceResourceGuests'>) {
  return {
    resourceGuestId: row.resourceGuestId,
    workspaceId: row.workspaceId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    principalId: row.principalId,
    accessRole: row.accessRole,
    status: row.status,
    grantedByPrincipalId: row.grantedByPrincipalId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function resourceScopeValue(row: Doc<'workspaceResourceScopes'>) {
  return {
    workspaceId: row.workspaceId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  }
}

function resourceGuestValueWithExpiry(row: Doc<'workspaceResourceGuests'>) {
  const value = resourceGuestValue(row)
  return value.status !== 'revoked'
    && value.expiresAt !== undefined
    && value.expiresAt <= Date.now()
    ? { ...value, status: 'expired' as const }
    : value
}

function requiredName(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`WORKSPACE_${label.toUpperCase().replaceAll(' ', '_')}_REQUIRED`)
  return normalized
}

function requiredEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new Error('WORKSPACE_EMAIL_INVALID')
  return normalized
}

function optionalEmail(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : requiredEmail(value)
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (!slug) throw new Error('WORKSPACE_SLUG_REQUIRED')
  return slug
}

function requirePrincipalSubject(args: {
  type: 'human' | 'agent' | 'service'
  userId?: string
  agentId?: string
  serviceId?: string
}): string {
  const expected = args.type === 'human'
    ? args.userId
    : args.type === 'agent'
      ? args.agentId
      : args.serviceId
  const populated = [args.userId, args.agentId, args.serviceId].filter(Boolean)
  if (!expected || populated.length !== 1) {
    throw new Error('WORKSPACE_PRINCIPAL_SUBJECT_INVALID')
  }
  return expected
}
