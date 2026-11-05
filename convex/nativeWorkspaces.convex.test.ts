import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test } from 'vitest'
import { DEFAULT_WORKSPACE_POLICY } from '@overlay/workspace-contracts'
import type { MutationCtx } from './_generated/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const query = (name: string) => makeFunctionReference<'query'>(`collaboration/nativeWorkspaces:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`collaboration/nativeWorkspaces:${name}`)
const now = 1_900_000_000_000

async function addWorkspace(
  ctx: MutationCtx,
  args: {
    id: string
    slug: string
    name?: string
    status?: 'active' | 'archived'
    workspaceArchivedAt?: number
    iconObjectKey?: string
    userId: string
    principalId: string
    principalType?: 'human' | 'agent'
    principalArchivedAt?: number
    role?: 'owner' | 'admin' | 'member' | 'guest'
    membershipStatus?: 'active' | 'suspended'
  },
) {
  await ctx.db.insert('workspaces', {
    workspaceId: args.id,
    kind: 'organization',
    name: args.name ?? args.id,
    slug: args.slug,
    status: args.status ?? 'active',
    ...(args.workspaceArchivedAt === undefined ? {} : { archivedAt: args.workspaceArchivedAt }),
    ...(args.iconObjectKey === undefined ? {} : { iconObjectKey: args.iconObjectKey }),
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspacePrincipals', {
    principalId: args.principalId,
    workspaceId: args.id,
    type: args.principalType ?? 'human',
    userId: args.userId,
    displayName: args.userId,
    ...(args.principalArchivedAt === undefined ? {} : { archivedAt: args.principalArchivedAt }),
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspaceMemberships', {
    membershipId: `membership-${args.id}`,
    workspaceId: args.id,
    principalId: args.principalId,
    role: args.role ?? 'member',
    status: args.membershipStatus ?? 'active',
    joinedAt: now,
    updatedAt: now,
  })
}

test('directory is authenticated, paginated, and includes only active human workspace memberships', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await addWorkspace(ctx, {
      id: 'active-a',
      slug: 'active-a',
      iconObjectKey: 'workspace-icons/123e4567-e89b-12d3-a456-426614174000.webp',
      userId: 'viewer',
      principalId: 'viewer-a',
      role: 'owner',
    })
    await addWorkspace(ctx, { id: 'active-b', slug: 'active-b', userId: 'viewer', principalId: 'viewer-b', role: 'member' })
    await addWorkspace(ctx, { id: 'active-guest', slug: 'active-guest', userId: 'viewer', principalId: 'viewer-guest', role: 'guest' })
    await addWorkspace(ctx, {
      id: 'suspended', slug: 'suspended', userId: 'viewer', principalId: 'viewer-suspended',
      membershipStatus: 'suspended',
    })
    await addWorkspace(ctx, {
      id: 'archived-workspace', slug: 'archived-workspace', userId: 'viewer', principalId: 'viewer-archived-workspace',
      status: 'archived', workspaceArchivedAt: now,
    })
    await addWorkspace(ctx, {
      id: 'archived-principal', slug: 'archived-principal', userId: 'viewer', principalId: 'viewer-archived-principal',
      principalArchivedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'viewer-revoked', workspaceId: 'active-a', type: 'human', userId: 'viewer',
      displayName: 'viewer', createdAt: now, updatedAt: now,
    })
    for (let index = 0; index < 53; index += 1) {
      await addWorkspace(ctx, {
        id: `active-extra-${index}`,
        slug: `active-extra-${index}`,
        userId: 'viewer',
        principalId: `viewer-extra-${index}`,
      })
    }
  })

  await expect(t.query(query('listDirectory'), {
    paginationOpts: { numItems: 50, cursor: null },
  })).rejects.toThrow('UNAUTHENTICATED')

  const viewer = t.withIdentity({ subject: 'viewer', issuer: 'https://issuer.example.test' })
  const result = await viewer.query(query('listDirectory'), {
    paginationOpts: { numItems: 500, cursor: null },
  })
  expect(result.page).toHaveLength(50)
  expect(result.isDone).toBe(false)
  const secondPage = await viewer.query(query('listDirectory'), {
    paginationOpts: { numItems: 50, cursor: result.continueCursor },
  })
  expect([
    ...result.page,
    ...secondPage.page,
  ].map((workspace: { id: string }) => workspace.id)).toHaveLength(56)
  expect([...result.page, ...secondPage.page].map((workspace: { id: string }) => workspace.id))
    .toContain('active-a')
  expect([...result.page, ...secondPage.page].map((workspace: { id: string }) => workspace.id))
    .toContain('active-b')
  expect([...result.page, ...secondPage.page].map((workspace: { id: string }) => workspace.id))
    .toContain('active-guest')
  expect(result.page.find((workspace: { id: string }) => workspace.id === 'active-a')).toMatchObject({
    name: 'active-a',
    routingHandle: 'active-a',
    role: 'owner',
    updatedAt: now,
  })
  expect(result.page.find((workspace: { id: string }) => workspace.id === 'active-a')?.iconUrl)
    .toContain('/api/v1/workspaces/active-a/icon?v=123e4567-e89b-12d3-a456-426614174000')
  expect(await viewer.query(query('getInitialWorkspaceHint'), {})).toBeNull()
})

test('owners and admins can rename and edit sharing policy while members and outsiders cannot', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await addWorkspace(ctx, { id: 'workspace', slug: 'workspace', userId: 'owner', principalId: 'owner-principal', role: 'owner' })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'admin-principal', workspaceId: 'workspace', type: 'human', userId: 'admin',
      displayName: 'Admin', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'admin-membership', workspaceId: 'workspace', principalId: 'admin-principal',
      role: 'admin', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'member-principal', workspaceId: 'workspace', type: 'human', userId: 'member',
      displayName: 'Member', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'member-membership', workspaceId: 'workspace', principalId: 'member-principal',
      role: 'member', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'guest-principal', workspaceId: 'workspace', type: 'human', userId: 'guest',
      displayName: 'Guest', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'guest-membership', workspaceId: 'workspace', principalId: 'guest-principal',
      role: 'guest', status: 'active', joinedAt: now, updatedAt: now,
    })
  })
  const owner = t.withIdentity({ subject: 'owner', issuer: 'https://issuer.example.test' })
  const admin = t.withIdentity({ subject: 'admin', issuer: 'https://issuer.example.test' })
  const member = t.withIdentity({ subject: 'member', issuer: 'https://issuer.example.test' })
  const guest = t.withIdentity({ subject: 'guest', issuer: 'https://issuer.example.test' })
  const outsider = t.withIdentity({ subject: 'outsider', issuer: 'https://issuer.example.test' })

  await expect(owner.query(query('getSharingPolicy'), { workspaceId: 'workspace' }))
    .resolves.toMatchObject({ policy: { ...DEFAULT_WORKSPACE_POLICY, workspaceId: 'workspace', updatedAt: 0 }, canManage: true })
  await expect(member.query(query('getSharingPolicy'), { workspaceId: 'workspace' }))
    .resolves.toMatchObject({ canManage: false })
  await expect(guest.query(query('getSharingPolicy'), { workspaceId: 'workspace' }))
    .resolves.toMatchObject({ canManage: false })
  await expect(outsider.query(query('getSharingPolicy'), { workspaceId: 'workspace' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')

  const renamedAt = await owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: '  Renamed  ', expectedUpdatedAt: now,
  })
  expect(renamedAt).toBeGreaterThan(now)
  await expect(admin.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Admin rename', expectedUpdatedAt: renamedAt,
  })).resolves.toBeGreaterThan(renamedAt)
  await expect(member.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Denied', expectedUpdatedAt: renamedAt,
  })).rejects.toThrow('WORKSPACE_MANAGEMENT_FORBIDDEN')
  await expect(outsider.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Denied', expectedUpdatedAt: renamedAt,
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')

  const policy = await owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace',
    patch: { memberCanInvite: true },
    expectedUpdatedAt: 0,
  })
  expect(policy).toMatchObject({ workspaceId: 'workspace', memberCanInvite: true })
  expect(policy.updatedAt).toBeGreaterThan(0)
  await expect(admin.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { publicLinksEnabled: false }, expectedUpdatedAt: policy.updatedAt,
  })).resolves.toMatchObject({ publicLinksEnabled: false })
  await expect(member.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { memberCanInvite: false }, expectedUpdatedAt: policy.updatedAt,
  })).rejects.toThrow('WORKSPACE_MANAGEMENT_FORBIDDEN')
  await expect(outsider.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { memberCanInvite: false }, expectedUpdatedAt: policy.updatedAt,
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('renames and policy updates validate inputs, reject stale revisions, audit actors, and enforce the write budget', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await addWorkspace(ctx, { id: 'workspace', slug: 'workspace', userId: 'owner', principalId: 'owner-principal', role: 'owner' })
  })
  const owner = t.withIdentity({ subject: 'owner', issuer: 'https://issuer.example.test' })
  await expect(owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: '   ', expectedUpdatedAt: now,
  })).rejects.toThrow('WORKSPACE_NAME_INVALID')
  await expect(owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'x'.repeat(81), expectedUpdatedAt: now,
  })).rejects.toThrow('WORKSPACE_NAME_INVALID')
  const renamedAt = await owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Updated', expectedUpdatedAt: now,
  })
  await expect(owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Stale', expectedUpdatedAt: now,
  })).rejects.toThrow('WORKSPACE_REVISION_CONFLICT')
  await expect(owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: {}, expectedUpdatedAt: 0,
  })).rejects.toThrow('WORKSPACE_POLICY_EMPTY_PATCH')
  await expect(owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { allowedAgentHarnesses: ['unknown'] }, expectedUpdatedAt: 0,
  })).rejects.toThrow('WORKSPACE_POLICY_INVALID:allowedAgentHarnesses')
  await expect(owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { channelRetentionDays: 3.5 }, expectedUpdatedAt: 0,
  })).rejects.toThrow('WORKSPACE_POLICY_INVALID:channelRetentionDays')

  const policy = await owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { allowedAgentHarnesses: ['overlay', 'overlay'] }, expectedUpdatedAt: 0,
  })
  expect(policy.allowedAgentHarnesses).toEqual(['overlay'])
  expect(policy.updatedAt).toBeGreaterThan(0)
  await expect(owner.mutation(mutation('setSharingPolicy'), {
    workspaceId: 'workspace', patch: { legalHold: true }, expectedUpdatedAt: 0,
  })).rejects.toThrow('WORKSPACE_REVISION_CONFLICT')

  const events = await t.run(ctx => ctx.db.query('auditEvents').collect())
  expect(events).toHaveLength(2)
  expect(events.map(event => [event.action, event.actorUserId, event.resourceId])).toEqual([
    ['workspace.rename', 'owner', 'workspace'],
    ['workspace.sharing-policy.update', 'owner', 'workspace'],
  ])
  expect(renamedAt).toBeGreaterThan(now)

  await t.run(async ctx => {
    await ctx.db.insert('rateLimitWindows', {
      bucket: 'native-workspaces:write:user',
      bucketKey: 'native-workspaces:write:user:owner',
      count: 300,
      resetAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    })
  })
  await expect(owner.mutation(mutation('rename'), {
    workspaceId: 'workspace', name: 'Rate limited', expectedUpdatedAt: renamedAt,
  })).rejects.toThrow('RATE_LIMITED')
})

test('handle reads preserve aliases, privacy, migration readiness, and membership authorization', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await addWorkspace(ctx, { id: 'handle-workspace', slug: 'acme', userId: 'viewer', principalId: 'viewer-handle', role: 'member' })
    await addWorkspace(ctx, { id: 'hidden-workspace', slug: 'hidden', userId: 'viewer', principalId: 'viewer-hidden', role: 'member' })
    await addWorkspace(ctx, { id: 'legacy-workspace', slug: 'legacy-team', userId: 'viewer', principalId: 'viewer-legacy', role: 'member' })
    await ctx.db.insert('workspaceHandles', {
      handle: 'acme', workspaceId: 'handle-workspace', kind: 'canonical', visibility: 'public', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandles', {
      handle: 'former-acme', workspaceId: 'handle-workspace', kind: 'alias', visibility: 'public', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandles', {
      handle: 'hidden', workspaceId: 'hidden-workspace', kind: 'canonical', visibility: 'private', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceHandleMigrationState', {
      key: 'workspace-handles-v1', status: 'pending', updatedAt: now, conflictCount: 0,
    })
  })
  const viewer = t.withIdentity({ subject: 'viewer', issuer: 'https://issuer.example.test' })
  const outsider = t.withIdentity({ subject: 'outsider', issuer: 'https://issuer.example.test' })

  await expect(t.query(query('resolveHandle'), { handle: 'acme' })).resolves.toBeNull()
  await expect(viewer.query(query('resolveHandle'), { handle: 'former-acme' }))
    .resolves.toEqual({ workspaceId: 'handle-workspace', canonicalHandle: 'acme', canonical: false })
  await expect(viewer.query(query('resolveHandle'), { handle: 'hidden' })).resolves.toBeNull()
  await expect(viewer.query(query('resolveHandle'), { handle: 'invalid handle' })).resolves.toBeNull()
  await expect(viewer.query(query('resolveHandle'), { handle: 'legacy-team' }))
    .resolves.toEqual({ workspaceId: 'legacy-workspace', canonicalHandle: 'legacy-team', canonical: true })
  await expect(outsider.query(query('resolveHandle'), { handle: 'acme' })).resolves.toBeNull()

  await t.run(async ctx => {
    const migration = await ctx.db.query('workspaceHandleMigrationState').first()
    if (migration) await ctx.db.patch(migration._id, { status: 'ready' })
  })
  await expect(viewer.query(query('resolveHandle'), { handle: 'legacy-team' })).resolves.toBeNull()
})

test('native handle writes are owner-only and fail closed without the shared deployment policy', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await addWorkspace(ctx, {
      id: 'handle-write-workspace',
      slug: 'handle-before',
      userId: 'owner',
      principalId: 'owner-principal',
      role: 'owner',
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'member-principal',
      workspaceId: 'handle-write-workspace',
      type: 'human',
      userId: 'member',
      displayName: 'Member',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'member-handle-membership',
      workspaceId: 'handle-write-workspace',
      principalId: 'member-principal',
      role: 'member',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('workspaceHandleMigrationState', {
      key: 'workspace-handles-v1',
      status: 'ready',
      updatedAt: now,
      conflictCount: 0,
    })
  })
  const owner = t.withIdentity({ subject: 'owner', issuer: 'https://issuer.example.test' })
  const member = t.withIdentity({ subject: 'member', issuer: 'https://issuer.example.test' })

  await expect(member.mutation(mutation('updateHandle'), {
    workspaceId: 'handle-write-workspace',
    slug: 'handle-after',
    expectedUpdatedAt: now,
  })).rejects.toThrow('WORKSPACE_HANDLE_OWNER_REQUIRED')
  await expect(owner.mutation(mutation('updateHandle'), {
    workspaceId: 'handle-write-workspace',
    slug: 'handle-after',
    expectedUpdatedAt: now,
  })).rejects.toThrow()
  await expect(t.run(async ctx => {
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', 'handle-write-workspace')).unique()
    const aliases = await ctx.db.query('workspaceHandles').collect()
    const events = await ctx.db.query('auditEvents').collect()
    return { workspace, aliases, events }
  })).resolves.toMatchObject({
    workspace: { slug: 'handle-before', updatedAt: now },
    aliases: [],
    events: [],
  })
})
