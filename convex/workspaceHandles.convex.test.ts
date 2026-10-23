import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'handles-test-secret'
const now = 1_900_000_000_000
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const create = makeFunctionReference<'mutation'>('collaboration/workspaces:createOrganizationByServer')
const update = makeFunctionReference<'mutation'>('collaboration/workspaces:updateWorkspaceHandleByServer')
const resolve = makeFunctionReference<'query'>('collaboration/workspaces:resolveWorkspaceHandleByServer')
const migrate = makeFunctionReference<'mutation'>('migrations/workspaceHandles:migrateWorkspaceHandlesBatchByServer')
const preview = makeFunctionReference<'query'>('migrations/workspaceHandles:previewWorkspaceHandlesBatchByServer')

test('concurrent automatic claims allocate unique handles for duplicate display names', async () => {
  const convex = convexTest(schema, modules)
  const createOrganization = (index: number) => convex.mutation(create, {
    serverSecret: secret,
    workspaceId: `workspace-${index}`,
    principalId: `principal-${index}`,
    membershipId: `membership-${index}`,
    creatorUserId: `user-${index}`,
    creatorDisplayName: `Member ${index}`,
    name: 'Same Name',
    slug: 'same-name',
    handleExplicit: false,
    handleSuffixes: [`suffix${index}a`, `suffix${index}b`],
    now,
  }) as Promise<{ workspace: { workspaceId: string; slug: string } }>
  const created = await Promise.all([createOrganization(1), createOrganization(2)])
  expect(new Set(created.map((item) => item.workspace.slug)).size).toBe(2)
  expect(created.map((item) => item.workspace.workspaceId).sort()).toEqual(['workspace-1', 'workspace-2'])
})

test('owner changes preserve immutable identity, retain aliases, and deny admins', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'workspace-one', kind: 'organization', name: 'Acme', slug: 'acme-one',
      status: 'active', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'owner-principal', workspaceId: 'workspace-one', type: 'human',
      userId: 'owner-user', displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'owner-membership', workspaceId: 'workspace-one', principalId: 'owner-principal',
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'admin-principal', workspaceId: 'workspace-one', type: 'human',
      userId: 'admin-user', displayName: 'Admin', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'admin-membership', workspaceId: 'workspace-one', principalId: 'admin-principal',
      role: 'admin', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandles', {
      handle: 'acme-one', workspaceId: 'workspace-one', kind: 'canonical', visibility: 'public',
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandleMigrationState', {
      key: 'workspace-handles-v1', status: 'ready', updatedAt: now, conflictCount: 0,
    })
  })
  await convex.mutation(update, {
    serverSecret: secret, workspaceId: 'workspace-one', actorUserId: 'owner-user', slug: 'acme-two', now: now + 1,
  })
  await convex.mutation(update, {
    serverSecret: secret, workspaceId: 'workspace-one', actorUserId: 'owner-user', slug: 'acme-one', now: now + 2,
  })
  const records = await convex.run(async (ctx) => ({
    workspace: await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-one')).unique(),
    handles: await ctx.db.query('workspaceHandles').withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-one')).collect(),
  }))
  expect(records.workspace?.workspaceId).toBe('workspace-one')
  expect(records.workspace?.slug).toBe('acme-one')
  expect(records.handles.find((item) => item.handle === 'acme-two')?.kind).toBe('alias')
  await expect(convex.mutation(update, {
    serverSecret: secret, workspaceId: 'workspace-one', actorUserId: 'admin-user', slug: 'acme-three', now: now + 3,
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('resolver gives generic denial for nonmembers and archived workspaces', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'workspace-one', kind: 'organization', name: 'Acme', slug: 'acme-one',
      status: 'active', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'owner-principal', workspaceId: 'workspace-one', type: 'human',
      userId: 'owner-user', displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'owner-membership', workspaceId: 'workspace-one', principalId: 'owner-principal',
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandles', {
      handle: 'acme-one', workspaceId: 'workspace-one', kind: 'canonical', visibility: 'public',
      createdAt: now, updatedAt: now,
    })
  })
  expect(await convex.query(resolve, { serverSecret: secret, handle: 'acme-one', userId: 'stranger' })).toBeNull()
  expect(await convex.query(resolve, { serverSecret: secret, handle: 'acme-one', userId: 'owner-user' })).toMatchObject({
    workspaceId: 'workspace-one', canonicalHandle: 'acme-one', canonical: true,
  })
  await convex.run(async (ctx) => {
    const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-one')).unique()
    if (workspace) await ctx.db.patch(workspace._id, { status: 'archived' })
  })
  expect(await convex.query(resolve, { serverSecret: secret, handle: 'acme-one', userId: 'owner-user' })).toBeNull()
})

test('backfill is dry-run safe, resumable, idempotent, and hides legacy personal addresses', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'org-one', kind: 'organization', name: 'Acme Labs', slug: 'acme-labs',
      status: 'active', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaces', {
      workspaceId: 'personal-one', kind: 'personal', name: 'Personal', slug: 'personal-user-123',
      status: 'active', personalOwnerUserId: 'user-123', createdAt: now, updatedAt: now,
    })
  })
  const before = await convex.query(preview, {
    serverSecret: secret, paginationOpts: { numItems: 50, cursor: null },
  }) as { rows: Array<{ workspaceId: string }> }
  expect(before.rows).toHaveLength(2)
  const dryRun = await convex.mutation(migrate, {
    serverSecret: secret, dryRun: true, paginationOpts: { numItems: 50, cursor: null },
  }) as { conflicts: number }
  expect(dryRun.conflicts).toBe(0)
  expect(await convex.run(async (ctx) => await ctx.db.query('workspaceHandles').collect())).toHaveLength(0)
  const result = await convex.mutation(migrate, { serverSecret: secret }) as { ready: boolean }
  expect(result.ready).toBe(true)
  const handles = await convex.run(async (ctx) => await ctx.db.query('workspaceHandles').collect())
  expect(handles.find((item) => item.handle === 'personal-user-123')).toMatchObject({ visibility: 'private', kind: 'alias' })
  const workspace = await convex.run(async (ctx) => await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'personal-one')).unique())
  expect(workspace?.slug).not.toBe('personal-user-123')
  expect((await convex.mutation(migrate, { serverSecret: secret }) as { ready: boolean }).ready).toBe(true)
})
