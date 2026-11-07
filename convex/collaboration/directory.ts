import { v } from 'convex/values'
import { canManageWorkspace, DEFAULT_WORKSPACE_POLICY } from '@overlay/workspace-contracts'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { query } from '../_generated/server'
import { nativeViewer, requireNativeWorkspace } from '../lib/nativeViewer'
import { resolveWorkspaceHandleFor, sharingPolicyValue, workspaceValue } from './workspaces'

const MAX_DIRECTORY_ROWS = 500

/** Active and human member counts, as the account directory has always shown them. */
async function memberCounts(ctx: Pick<QueryCtx, 'db'>, workspaceId: string) {
  const [principals, memberships] = await Promise.all([
    ctx.db.query('workspacePrincipals').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).take(MAX_DIRECTORY_ROWS),
    ctx.db.query('workspaceMemberships').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).take(MAX_DIRECTORY_ROWS),
  ])
  const humans = new Set(principals.filter(p => p.type === 'human' && p.archivedAt === undefined).map(p => p.principalId))
  const active = memberships.filter(m => m.status === 'active')
  return { memberCount: active.length, humanMemberCount: active.filter(m => humans.has(m.principalId)).length }
}

async function workspaceSummary(ctx: Pick<QueryCtx, 'db'>, userId: string, workspace: Doc<'workspaces'>, role: Doc<'workspaceMemberships'>['role']) {
  const value = workspaceValue(workspace)
  const [counts, handle] = await Promise.all([
    memberCounts(ctx, workspace.workspaceId),
    resolveWorkspaceHandleFor(ctx, workspace.slug, userId),
  ])
  return {
    id: value.workspaceId,
    name: value.name,
    slug: value.slug,
    kind: value.kind,
    status: value.status,
    role,
    ...(value.iconUrl ? { iconUrl: value.iconUrl } : {}),
    ...(value.iconPreset ? { iconPreset: value.iconPreset } : {}),
    ...counts,
    ...(handle?.workspaceId === workspace.workspaceId ? { routingHandle: handle.canonicalHandle } : {}),
  }
}

/** Pending, unexpired invitations addressed to the account's email, for workspaces that still exist. */
async function receivedInvitations(ctx: Pick<QueryCtx, 'db'>, userId: string, now: number) {
  const account = await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', userId)).first()
  const email = account?.email?.trim().toLowerCase()
  if (!email) return []
  const invitations = await ctx.db.query('workspaceInvitations')
    .withIndex('by_email_status', q => q.eq('email', email).eq('status', 'pending').gt('expiresAt', now))
    .take(MAX_DIRECTORY_ROWS)
  const summaries = await Promise.all(invitations.map(async invitation => {
    const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', invitation.workspaceId)).unique()
    if (!workspace || workspace.status !== 'active') return null
    return { id: invitation.invitationId, workspaceId: workspace.workspaceId, workspaceName: workspace.name, role: invitation.role, expiresAt: invitation.expiresAt }
  }))
  return summaries.filter(summary => summary !== null)
}

/**
 * The signed-in person's workspaces, live: every active workspace they are an active member of (personal first, then
 * by name), the invitations waiting for them, and the workspace they last chose. A rename, icon or handle change, a
 * new member, or losing access reaches every tab at once. Null when signed out.
 */
export const workspaces = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) return null
    const principals = await ctx.db.query('workspacePrincipals')
      .withIndex('by_userId', q => q.eq('userId', viewer.userId)).take(MAX_DIRECTORY_ROWS)
    const rows = await Promise.all(principals.map(async principal => {
      if (principal.type !== 'human') return null
      const [workspace, membership] = await Promise.all([
        ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', principal.workspaceId)).unique(),
        ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q =>
          q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId)).unique(),
      ])
      if (!workspace || workspace.status !== 'active' || !membership || membership.status !== 'active') return null
      return await workspaceSummary(ctx, viewer.userId, workspace, membership.role)
    }))
    const list = rows.filter(row => row !== null).sort((left, right) =>
      Number(right.kind === 'personal') - Number(left.kind === 'personal') || left.name.localeCompare(right.name))
    const preference = await ctx.db.query('workspaceUserPreferences')
      .withIndex('by_userId', q => q.eq('userId', viewer.userId)).unique()
    const preferred = list.find(workspace => workspace.id === preference?.activeWorkspaceId)
    return {
      workspaces: list,
      activeWorkspaceId: preferred?.id ?? list[0]?.id ?? '',
      invitations: await receivedInvitations(ctx, viewer.userId, Date.now()),
    }
  },
})

/** Which workspace a `/w/<handle>` address opens for the viewer, and its current handle; null when it opens none. */
export const resolveHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const viewer = await nativeViewer(ctx)
    return viewer ? await resolveWorkspaceHandleFor(ctx, handle, viewer.userId) : null
  },
})

/** The workspace's sharing and creation policy, live, with whether the viewer may change it. Null without access. */
export const policy = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const row = await ctx.db.query('workspaceSharingPolicies').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
    return {
      policy: row ? sharingPolicyValue(row) : { ...DEFAULT_WORKSPACE_POLICY, workspaceId, updatedAt: 0 },
      canManage: canManageWorkspace(viewer.membership.role),
    }
  },
})
