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

test('multi-batch migration cannot skip rows and stays consistent with concurrent creation', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    for (const [workspaceId, slug, kind] of [
      ['org-first', 'duplicate', 'organization'],
      ['org-second', 'duplicate', 'organization'],
      ['personal-identity-derived-id', 'personal-old-user', 'personal'],
    ] as const) {
      await ctx.db.insert('workspaces', {
        workspaceId, slug, kind, name: 'Duplicate', status: 'active', createdAt: now, updatedAt: now,
      })
    }
  })
  const previewPage = await convex.query(preview, {
    serverSecret: secret, paginationOpts: { numItems: 1, cursor: null },
  }) as { continueCursor: string }
  await expect(convex.mutation(migrate, {
    serverSecret: secret, paginationOpts: { numItems: 1, cursor: previewPage.continueCursor },
  })).rejects.toThrow('WORKSPACE_HANDLE_MIGRATION_CURSOR_MISMATCH')
  const [first] = await Promise.all([
    convex.mutation(migrate, { serverSecret: secret, paginationOpts: { numItems: 1, cursor: null } }),
    convex.mutation(create, {
      serverSecret: secret, workspaceId: 'org-concurrent', principalId: 'principal-concurrent',
      membershipId: 'member-concurrent', creatorUserId: 'creator-concurrent',
      creatorDisplayName: 'Creator', name: 'Duplicate', slug: 'duplicate', handleExplicit: false,
      handleSuffixes: ['uniqueconcurrent'], now,
    }),
  ]) as [{ ready: boolean; continueCursor: string }, unknown]
  expect(first.ready).toBe(false)
  let ready = false
  let cursor = first.continueCursor
  for (let page = 0; page < 10 && !ready; page++) {
    const result = await convex.mutation(migrate, {
      serverSecret: secret, paginationOpts: { numItems: 1, cursor },
    }) as { ready: boolean; continueCursor: string }
    ready = result.ready
    cursor = result.continueCursor
  }
  expect(ready).toBe(true)
  const snapshot = () => convex.run(async (ctx) => ({
    workspaces: await ctx.db.query('workspaces').collect(),
    claims: await ctx.db.query('workspaceHandles').collect(),
  }))
  const before = await snapshot()
  expect(before.workspaces).toHaveLength(4)
  expect(new Set(before.claims.map((claim) => claim.handle)).size).toBe(before.claims.length)
  for (const workspace of before.workspaces) {
    expect(before.claims.find((claim) => claim.handle === workspace.slug)).toMatchObject({
      workspaceId: workspace.workspaceId, kind: 'canonical', visibility: 'public',
    })
  }
  const personal = before.workspaces.find((workspace) => workspace.kind === 'personal')!
  expect(personal.slug).toMatch(/^personal-[a-f0-9]{24}$/)
  expect(before.claims.find((claim) => claim.handle === 'personal-old-user')).toMatchObject({
    workspaceId: personal.workspaceId, kind: 'alias', visibility: 'private',
  })
  await convex.mutation(migrate, { serverSecret: secret })
  expect(await snapshot()).toEqual(before)
})

test('migrated personal handles resolve for their owner but legacy identity aliases never resolve', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'personal-one', kind: 'personal', name: 'Personal', slug: 'personal-old-user',
      status: 'active', personalOwnerUserId: 'owner-user', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'owner-principal', workspaceId: 'personal-one', type: 'human',
      userId: 'owner-user', displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'owner-member', workspaceId: 'personal-one', principalId: 'owner-principal',
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })
  })
  await convex.mutation(migrate, { serverSecret: secret })
  const workspace = await convex.run(async (ctx) => await ctx.db.query('workspaces').first())
  expect(await convex.query(resolve, {
    serverSecret: secret, handle: workspace!.slug, userId: 'owner-user',
  })).toMatchObject({ workspaceId: 'personal-one', canonical: true })
  for (const [handle, userId] of [[workspace!.slug, 'stranger'], ['personal-old-user', 'owner-user']]) {
    expect(await convex.query(resolve, { serverSecret: secret, handle, userId })).toBeNull()
  }
})
