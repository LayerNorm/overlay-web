import { v } from 'convex/values'
import {
  canManageWorkspace,
  type WorkspaceManagementItem,
  type WorkspaceManagementResponse,
} from '@overlay/workspace-contracts'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { canSee } from '../agents/directory'
import { invitationValueWithExpiry, resolvedPrincipalValues } from './workspaces'

const MAX_ROWS = 500
type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>
type Member = {
  principal: Awaited<ReturnType<typeof resolvedPrincipalValues>>[number]
  membership: Doc<'workspaceMemberships'>
}

const ROLE_DESCRIPTIONS = {
  owner: 'Full control, ownership transfer, and workspace archive',
  admin: 'Manage people, invitations, teams, and policy',
  member: 'Create and collaborate in workspace resources',
} as const

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Active members with their current names and photos (resolved from each person's account). */
async function activeMembers(ctx: Pick<QueryCtx, 'db'>, workspaceId: string): Promise<Member[]> {
  const [principals, memberships] = await Promise.all([
    ctx.db.query('workspacePrincipals').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).take(MAX_ROWS),
    ctx.db.query('workspaceMemberships').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).take(MAX_ROWS),
  ])
  const resolved = await resolvedPrincipalValues(ctx, principals.filter(principal => principal.archivedAt === undefined))
  const byId = new Map(resolved.map(principal => [principal.principalId, principal]))
  return memberships.flatMap(membership => {
    const principal = membership.status === 'active' ? byId.get(membership.principalId) : undefined
    return principal ? [{ principal, membership: { ...membership, role: membership.role } }] : []
  })
}

/** Pending invitations, with expiry applied on read; managers only (the server's rule). */
async function pendingInvitations(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer) {
  if (!canManageWorkspace(viewer.membership.role)) return []
  const rows = await ctx.db.query('workspaceInvitations')
    .withIndex('by_workspaceId_createdAt', q => q.eq('workspaceId', viewer.workspaceId)).order('desc').take(MAX_ROWS)
  return rows.map(invitationValueWithExpiry).filter(invitation => invitation.status === 'pending')
}

function memberItem(member: Member, description: string, detail: string): WorkspaceManagementItem {
  const { principal, membership } = member
  return {
    id: principal.principalId,
    kind: 'member',
    name: principal.displayName,
    ...(principal.photoUrl ? { photoUrl: principal.photoUrl } : {}),
    description,
    detail,
    badge: membership.status,
    principalId: principal.principalId,
    principalType: principal.type,
    role: membership.role,
    status: membership.status,
  }
}

function invitationItem(invitation: ReturnType<typeof invitationValueWithExpiry>, detail: string): WorkspaceManagementItem {
  return {
    id: invitation.invitationId,
    kind: 'invitation',
    name: invitation.email,
    description: 'Pending workspace invitation',
    detail,
    badge: invitation.status,
    invitationId: invitation.invitationId,
    role: invitation.role,
    status: invitation.status,
  }
}

async function peopleItems(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer) {
  const [members, invitations] = await Promise.all([activeMembers(ctx, viewer.workspaceId), pendingInvitations(ctx, viewer)])
  return [
    ...members.filter(({ principal }) => principal.type === 'human')
      .map(member => memberItem(member, member.principal.email ?? 'Workspace member', member.membership.role)),
    ...invitations.map(invitation => invitationItem(invitation, invitation.role)),
  ]
}

async function teamItems(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer): Promise<WorkspaceManagementItem[]> {
  const teams = (await ctx.db.query('workspaceTeams').withIndex('by_workspaceId', q => q.eq('workspaceId', viewer.workspaceId)).take(MAX_ROWS))
    .filter(team => team.archivedAt === undefined)
  return await Promise.all(teams.map(async team => {
    const members = await ctx.db.query('workspaceTeamMemberships').withIndex('by_teamId', q => q.eq('teamId', team.teamId)).take(MAX_ROWS)
    return {
      id: team.teamId,
      kind: 'team' as const,
      name: team.name,
      description: team.description ?? 'Workspace team',
      detail: plural(members.length, 'member', 'members'),
      teamMemberPrincipalIds: members.map(member => member.principalId),
    }
  }))
}

async function roleItems(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer): Promise<WorkspaceManagementItem[]> {
  const members = await activeMembers(ctx, viewer.workspaceId)
  return (['owner', 'admin', 'member'] as const).map(role => ({
    id: role,
    kind: 'role' as const,
    name: role[0]!.toUpperCase() + role.slice(1),
    description: ROLE_DESCRIPTIONS[role],
    detail: plural(members.filter(({ membership }) => membership.role === role).length, 'principal', 'principals'),
    badge: 'built-in',
  }))
}

async function agentItems(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer): Promise<WorkspaceManagementItem[]> {
  const [members, agents] = await Promise.all([
    activeMembers(ctx, viewer.workspaceId),
    ctx.db.query('workspaceAgentDefinitions').withIndex('by_workspaceId', q => q.eq('workspaceId', viewer.workspaceId)).take(MAX_ROWS),
  ])
  // Only agents this person may see, never a personal chief: it lives in its owner's Personal mode, so it is not
  // mentioned, listed with the people or shown in Settings → Agents.
  const byPrincipal = new Map(agents
    .filter(agent => agent.archivedAt === undefined && agent.deletedAt === undefined
      && agent.agentRole !== 'personal_chief' && canSee(agent, viewer))
    .map(agent => [agent.principalId, agent]))
  return members.flatMap(({ principal, membership }) => {
    const agent = principal.type === 'agent' ? byPrincipal.get(principal.principalId) : undefined
    if (!agent) return []
    return [{
      id: principal.principalId,
      kind: 'member' as const,
      name: principal.displayName,
      description: agent.description?.trim() || 'Named workspace agent',
      detail: membership.role,
      badge: principal.type,
      principalId: principal.principalId,
      principalType: principal.type,
      ...(agent.avatarColor ? { avatarColor: agent.avatarColor } : {}),
      ...(agent.avatarShape ? { avatarShape: agent.avatarShape } : {}),
      isDefault: agent.isDefault,
      ...(agent.visibility === 'creator' ? { personal: true } : {}),
      role: membership.role,
      status: membership.status,
    }]
  })
}

const VIEWS = {
  people: peopleItems,
  teams: teamItems,
  roles: roleItems,
  'chats-agents': agentItems,
} as const

/**
 * One tab of workspace settings, live, with the same rows and rules as the server's management view: active members
 * with their current names and photos, pending invitations for owners and admins only, teams, role
 * counts and agents. A role change, removal, invitation, acceptance or rename reaches every open settings page and
 * picker at once; losing access returns null. Writes (invites send email) stay on the server.
 */
export const view = query({
  args: {
    workspaceId: v.string(),
    view: v.union(v.literal('people'), v.literal('teams'), v.literal('roles'), v.literal('chats-agents')),
  },
  handler: async (ctx, args): Promise<WorkspaceManagementResponse | null> => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return null
    }
    const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    return {
      canManage: canManageWorkspace(viewer.membership.role),
      currentPrincipalId: viewer.principal.principalId,
      currentRole: viewer.membership.role,
      items: await VIEWS[args.view](ctx, viewer),
      workspaceKind: workspace!.kind,
    }
  },
})
