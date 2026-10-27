import { afterAll, beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'identity-profile-test-secret'
const now = 1_900_000_000_000
const updateWorkspaceIdentity = makeFunctionReference<'mutation'>('collaboration/workspaces:updateWorkspaceIdentityByServer')
const updateWorkspaceIcon = makeFunctionReference<'mutation'>('collaboration/workspaces:updateWorkspaceIconByServer')
const updatePrincipal = makeFunctionReference<'mutation'>('collaboration/workspaces:updatePrincipalByServer')
const getAccountPhoto = makeFunctionReference<'query'>('auth/users:getAccountPhotoByServer')

const previousSecret = process.env.INTERNAL_API_SECRET
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
afterAll(() => {
  if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousSecret
})

async function seedWorkspace(convex: ReturnType<typeof convexTest>, workspaceId: string, members: Array<{
  userId: string
  principalId: string
  membershipId: string
  role: 'owner' | 'admin' | 'member'
}>) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId,
      kind: 'organization',
      name: workspaceId,
      slug: workspaceId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    for (const member of members) {
      await ctx.db.insert('workspacePrincipals', {
        principalId: member.principalId,
        workspaceId,
        type: 'human',
        userId: member.userId,
        displayName: member.userId,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: member.membershipId,
        workspaceId,
        principalId: member.principalId,
        role: member.role,
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
    }
  })
}

test('workspace profile writes stay scoped to the active human membership and reset only that workspace', async () => {
  const convex = convexTest(schema, modules)
  await seedWorkspace(convex, 'workspace-a', [
    { userId: 'user-a', principalId: 'principal-a', membershipId: 'membership-a', role: 'owner' },
  ])
  await seedWorkspace(convex, 'workspace-b', [
    { userId: 'user-a', principalId: 'principal-b', membershipId: 'membership-b', role: 'member' },
  ])
  await convex.mutation(updateWorkspaceIdentity, {
    serverSecret: secret, workspaceId: 'workspace-a', userId: 'user-a',
    displayNameOverride: 'Workspace A', photoObjectKey: 'profiles/user-a/a.webp',
  })
  await expect(convex.mutation(updateWorkspaceIdentity, {
    serverSecret: secret, workspaceId: 'workspace-a', userId: 'stranger',
    displayNameOverride: 'Not a member',
  })).rejects.toThrow('WORKSPACE_PROFILE_FORBIDDEN')
  await convex.mutation(updateWorkspaceIdentity, {
    serverSecret: secret, workspaceId: 'workspace-a', userId: 'user-a',
    displayNameOverride: null, photoObjectKey: null,
  })
  const principals = await convex.run(async (ctx) => await ctx.db.query('workspacePrincipals').collect())
  expect(principals.find((principal) => principal.principalId === 'principal-a')).not.toMatchObject({
    displayNameOverride: 'Workspace A',
    photoObjectKey: 'profiles/user-a/a.webp',
  })
  expect(principals.find((principal) => principal.principalId === 'principal-b')).toMatchObject({
    displayName: 'user-a',
  })
})

test('only owners and admins can change workspace icons; provider sync preserves profile uploads and overrides', async () => {
  const convex = convexTest(schema, modules)
  await seedWorkspace(convex, 'workspace-one', [
    { userId: 'owner', principalId: 'owner-principal', membershipId: 'owner-membership', role: 'owner' },
    { userId: 'admin', principalId: 'admin-principal', membershipId: 'admin-membership', role: 'admin' },
    { userId: 'member', principalId: 'member-principal', membershipId: 'member-membership', role: 'member' },
  ])
  await expect(convex.mutation(updateWorkspaceIcon, {
    serverSecret: secret, workspaceId: 'workspace-one', actorUserId: 'member', preset: 'shape-2',
  })).rejects.toThrow('WORKSPACE_ICON_FORBIDDEN')
  await convex.mutation(updateWorkspaceIcon, {
    serverSecret: secret, workspaceId: 'workspace-one', actorUserId: 'admin', preset: 'shape-2',
  })
  await convex.run(async (ctx) => {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', 'owner-principal')).unique()
    if (principal) await ctx.db.patch(principal._id, {
      displayNameOverride: 'Custom name',
      photoObjectKey: 'profiles/owner/custom.webp',
    })
  })
  await convex.mutation(updatePrincipal, {
    serverSecret: secret,
    principalId: 'owner-principal',
    workspaceId: 'workspace-one',
    displayName: 'Provider name',
    email: 'owner@example.test',
  })
  const principal = await convex.run(async (ctx) => await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', 'owner-principal')).unique())
  expect(principal).toMatchObject({
    displayName: 'Provider name',
    displayNameOverride: 'Custom name',
    photoObjectKey: 'profiles/owner/custom.webp',
  })
})

test('account photo reads deny unrelated users and archived shared workspaces', async () => {
  const convex = convexTest(schema, modules)
  await seedWorkspace(convex, 'workspace-active', [
    { userId: 'actor', principalId: 'actor-active', membershipId: 'actor-active-membership', role: 'member' },
    { userId: 'target', principalId: 'target-active', membershipId: 'target-active-membership', role: 'member' },
  ])
  await seedWorkspace(convex, 'workspace-archived', [
    { userId: 'archive-only-actor', principalId: 'actor-archived', membershipId: 'actor-archived-membership', role: 'member' },
    { userId: 'archive-only-target', principalId: 'target-archived', membershipId: 'target-archived-membership', role: 'member' },
  ])
  await convex.run(async (ctx) => {
    await ctx.db.insert('subscriptions', { userId: 'target', photoObjectKey: 'profiles/target/photo.webp' })
    await ctx.db.insert('subscriptions', { userId: 'archive-only-target', photoObjectKey: 'profiles/archive/photo.webp' })
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-archived')).unique()
    if (workspace) await ctx.db.patch(workspace._id, { status: 'archived' })
  })
  expect(await convex.query(getAccountPhoto, {
    serverSecret: secret, actorUserId: 'stranger', targetUserId: 'target',
  })).toBeNull()
  expect(await convex.query(getAccountPhoto, {
    serverSecret: secret, actorUserId: 'actor', targetUserId: 'target',
  })).toMatchObject({ photoObjectKey: 'profiles/target/photo.webp' })
  expect(await convex.query(getAccountPhoto, {
    serverSecret: secret, actorUserId: 'archive-only-actor', targetUserId: 'archive-only-target',
  })).toBeNull()
})
