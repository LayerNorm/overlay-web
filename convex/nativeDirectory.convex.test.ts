import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  workspaces: makeFunctionReference<'query'>('collaboration/directory:workspaces'),
  resolveHandle: makeFunctionReference<'query'>('collaboration/directory:resolveHandle'),
  policy: makeFunctionReference<'query'>('collaboration/directory:policy'),
}
const now = Date.now()

type Directory = {
  workspaces: Array<{ id: string; name: string; kind: string; role: string; memberCount: number; humanMemberCount: number; routingHandle?: string }>
  activeWorkspaceId: string
  invitations: Array<{ id: string; workspaceId: string }>
}

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    const workspace = (workspaceId: string, kind: 'personal' | 'organization', name: string, status: 'active' | 'archived' = 'active') =>
      ctx.db.insert('workspaces', { workspaceId, kind, name, slug: workspaceId, status, createdAt: 1, updatedAt: 1 })
    await workspace('alice-personal', 'personal', 'Alice')
    await workspace('acme', 'organization', 'Acme')
    await workspace('beta', 'organization', 'Beta')
    await workspace('old', 'organization', 'Old', 'archived')
    const member = async (workspaceId: string, userId: string, role: 'owner' | 'admin' | 'member', status: 'active' | 'suspended' = 'active', type: 'human' | 'agent' = 'human') => {
      const principalId = `${workspaceId}-${userId}`
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId, userId: type === 'human' ? userId : undefined, agentId: type === 'agent' ? userId : undefined, type, displayName: userId, createdAt: 1, updatedAt: 1 } as never)
      await ctx.db.insert('workspaceMemberships', { workspaceId, principalId, membershipId: `m-${principalId}`, role, status, joinedAt: 1, updatedAt: 1 })
    }
    await member('alice-personal', 'alice', 'owner')
    await member('acme', 'alice', 'member')
    await member('acme', 'bob', 'owner')
    await member('acme', 'helper', 'member', 'active', 'agent')
    await member('beta', 'alice', 'member', 'suspended')
    await member('old', 'alice', 'owner')
    await ctx.db.insert('workspaceUserPreferences', { userId: 'alice', activeWorkspaceId: 'acme', updatedAt: 1 })
    await ctx.db.insert('subscriptions', { userId: 'alice', email: 'Alice@Example.test' } as never)
    const invite = (invitationId: string, workspaceId: string, email: string, status: 'pending' | 'cancelled', expiresAt: number) =>
      ctx.db.insert('workspaceInvitations', { invitationId, workspaceId, email, role: 'member', status, invitedByPrincipalId: 'x', expiresAt, createdAt: 1, updatedAt: 1 })
    await invite('valid', 'beta', 'alice@example.test', 'pending', now + 60_000)
    await invite('expired', 'beta', 'alice@example.test', 'pending', now - 1)
    await invite('cancelled', 'beta', 'alice@example.test', 'cancelled', now + 60_000)
    await invite('other', 'beta', 'bob@example.test', 'pending', now + 60_000)
    await invite('archived', 'old', 'alice@example.test', 'pending', now + 60_000)
    await ctx.db.insert('workspaceHandles', { handle: 'acme-old', workspaceId: 'acme', kind: 'alias', visibility: 'public', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceSharingPolicies', { workspaceId: 'acme', publicLinksEnabled: false, memberCanCreateAgents: false, createdAt: 1, updatedAt: 7 } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as }
}

test('the directory lists active memberships with counts, the chosen workspace and invitations to the account email', async () => {
  const { t, as } = await fixture()
  const directory = await as('alice').query(fn.workspaces, {}) as Directory
  expect(directory.workspaces.map(w => [w.id, w.role])).toEqual([['alice-personal', 'owner'], ['acme', 'member']])
  expect(directory.workspaces[1]).toMatchObject({ name: 'Acme', memberCount: 3, humanMemberCount: 2, routingHandle: 'acme' })
  expect(directory.activeWorkspaceId).toBe('acme')
  expect(directory.invitations.map(i => i.id)).toEqual(['valid'])
  // Bob has no account email on file, so no invitations; signed out is null.
  expect((await as('bob').query(fn.workspaces, {}) as Directory).invitations).toEqual([])
  expect(await t.query(fn.workspaces, {})).toBeNull()
})

test('the directory follows renames and lost access live', async () => {
  const { t, as } = await fixture()
  await t.run(async ctx => {
    const acme = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', 'acme')).unique()
    await ctx.db.patch(acme!._id, { name: 'Acme Labs' })
  })
  expect((await as('alice').query(fn.workspaces, {}) as Directory).workspaces[1]?.name).toBe('Acme Labs')
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'acme').eq('principalId', 'acme-alice')).unique()
    await ctx.db.patch(membership!._id, { status: 'suspended' })
  })
  const directory = await as('alice').query(fn.workspaces, {}) as Directory
  expect(directory.workspaces.map(w => w.id)).toEqual(['alice-personal'])
  // The saved choice no longer applies, so the first workspace is offered.
  expect(directory.activeWorkspaceId).toBe('alice-personal')
})

test('handles open only for active members, and an alias names the current handle', async () => {
  const { as } = await fixture()
  expect(await as('alice').query(fn.resolveHandle, { handle: 'acme' })).toEqual({ workspaceId: 'acme', canonicalHandle: 'acme', canonical: true })
  expect(await as('alice').query(fn.resolveHandle, { handle: 'acme-old' })).toEqual({ workspaceId: 'acme', canonicalHandle: 'acme', canonical: false })
  expect(await as('alice').query(fn.resolveHandle, { handle: 'beta' })).toBeNull()
  expect(await as('stranger').query(fn.resolveHandle, { handle: 'acme' })).toBeNull()
})

test('policy is readable by members, manageable by owners and admins, and hidden from everyone else', async () => {
  const { as } = await fixture()
  const forAlice = await as('alice').query(fn.policy, { workspaceId: 'acme' }) as { policy: Record<string, unknown>; canManage: boolean }
  expect(forAlice.canManage).toBe(false)
  expect(forAlice.policy).toMatchObject({ workspaceId: 'acme', publicLinksEnabled: false, memberCanCreateAgents: false, memberCanCreateChannels: true, updatedAt: 7 })
  expect((await as('bob').query(fn.policy, { workspaceId: 'acme' }) as { canManage: boolean }).canManage).toBe(true)
  // No stored row: the defaults.
  expect((await as('alice').query(fn.policy, { workspaceId: 'alice-personal' }) as { policy: Record<string, unknown> }).policy)
    .toMatchObject({ workspaceId: 'alice-personal', memberCanInvite: false, updatedAt: 0 })
  expect(await as('alice').query(fn.policy, { workspaceId: 'beta' })).toBeNull()
  expect(await as('stranger').query(fn.policy, { workspaceId: 'acme' })).toBeNull()
})
