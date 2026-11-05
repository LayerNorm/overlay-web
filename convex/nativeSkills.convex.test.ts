import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { MutationCtx } from './_generated/server'
import schema from './schema'
import { NATIVE_POLICY_LEASE_MS } from '@/shared/authorization/native-deployment-policy'

const modules = import.meta.glob('./**/*.ts')
const secret = 'native-skills-test-secret'
const query = (path: string) => makeFunctionReference<'query'>(path)
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
const policyBeginRef = mutation('platform/nativePolicy:beginRefresh')
const policyPublishRef = mutation('platform/nativePolicy:publish')
const listRef = query('integrations/nativeSkills:list')
const getRef = query('integrations/nativeSkills:get')
const availabilityRef = query('integrations/nativeSkills:availability')
const permissionsRef = query('integrations/nativeSkills:permissions')
const createRef = mutation('integrations/nativeSkills:create')
const updateRef = mutation('integrations/nativeSkills:update')
const changeScopeRef = mutation('integrations/nativeSkills:changeScope')
const removeRef = mutation('integrations/nativeSkills:remove')
const legacyUpdateRef = mutation('integrations/skills:update')
const legacySetScopeRef = mutation('integrations/skills:setScope')
const legacyArchiveRef = mutation('integrations/skills:archive')
const legacyRestoreRef = mutation('integrations/skills:restore')
const now = 1_900_000_000_000
const policyChallenge = '00000000-0000-4000-8000-000000000001'
const policySourceOrigin = 'https://skills.example.test'
const policyBackendUrl = 'https://skills-fixture.convex.cloud'
const nativePolicySnapshot = {
  version: 1 as const,
  backendUrl: policyBackendUrl,
  revision: 'a'.repeat(64),
  features: { files: true, skills: true, mcpServers: true, externalAgents: true, connectedAgents: true, workspaceHandles: false },
  rollout: { stage: 'general' as const, internalWorkspaceIds: '', invitedWorkspaceIds: '' },
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function fixture(options: { policy?: 'enabled' | 'missing' | 'disabled' } = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubEnv('OVERLAY_BFF_URL', policySourceOrigin)
  vi.stubEnv('CONVEX_CLOUD_URL', policyBackendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const workspaceId of ['ws', 'other-ws']) {
      await ctx.db.insert('workspaces', {
        workspaceId, kind: 'organization', name: 'Skills QA', slug: workspaceId,
        status: 'active', createdAt: now, updatedAt: now,
      })
    }

    const workspaceActors = [
      ['owner', 'owner', 'active'],
      ['admin', 'admin', 'active'],
      ['alice', 'member', 'active'],
      ['bob', 'member', 'active'],
      ['guest', 'guest', 'active'],
      ['revoked', 'member', 'suspended'],
      ['restricted', 'member', 'active'],
      ['group-user', 'member', 'active'],
    ] as const
    const membershipIds: Record<string, string> = {}
    for (const [userId, role, status] of workspaceActors) {
      const principalId = `ws:${userId}`
      await ctx.db.insert('workspacePrincipals', {
        workspaceId: 'ws', principalId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now,
      })
      membershipIds[userId] = await ctx.db.insert('workspaceMemberships', {
        workspaceId: 'ws', principalId, membershipId: `membership:${userId}`, role, status,
        joinedAt: now, updatedAt: now,
      })
    }
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'other-ws', principalId: 'other-ws:foreign', type: 'human',
      userId: 'foreign', displayName: 'Foreign', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'other-ws', principalId: 'other-ws:foreign', membershipId: 'membership:foreign',
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })

    const directRole = await ctx.db.insert('authorizationRoles', {
      roleId: 'native-skills-user', name: 'Native skills user', capabilities: ['skills.use'],
      isSystem: false, createdAt: now, updatedAt: now,
    })
    const restrictedRole = await ctx.db.insert('authorizationRoles', {
      roleId: 'native-skills-restricted', name: 'Restricted user', capabilities: ['conversations.read'],
      isSystem: false, createdAt: now, updatedAt: now,
    })
    for (const userId of ['owner', 'admin', 'alice', 'bob', 'guest', 'revoked', 'foreign']) {
      await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'native-skills-user', createdAt: now })
    }
    await ctx.db.insert('authorizationUserRoles', { userId: 'restricted', roleId: 'native-skills-restricted', createdAt: now })
    await ctx.db.insert('authorizationRoles', {
      roleId: 'native-skills-group-role', name: 'Skills group', capabilities: ['skills.use'],
      isSystem: false, createdAt: now, updatedAt: now,
    })
    const groupId = await ctx.db.insert('authorizationGroups', {
      groupId: 'native-skills-group', name: 'Skills group', source: 'local', createdAt: now, updatedAt: now,
    })
    const groupMembershipId = await ctx.db.insert('authorizationGroupMemberships', {
      groupId: 'native-skills-group', userId: 'group-user', source: 'local', createdAt: now,
    })
    await ctx.db.insert('authorizationGroupRoles', {
      groupId: 'native-skills-group', roleId: 'native-skills-group-role', createdAt: now,
    })
    return { directRole, restrictedRole, groupId, groupMembershipId, membershipIds }
  })
  if (options.policy !== 'missing') {
    const { sequence } = await t.mutation(policyBeginRef, { challenge: policyChallenge })
    await t.mutation(policyPublishRef, {
      sequence,
      challenge: policyChallenge,
      snapshot: {
        ...nativePolicySnapshot,
        features: { ...nativePolicySnapshot.features, skills: options.policy !== 'disabled' },
      },
    })
  }
  return { t, ids, actor: (userId: string) => t.withIdentity({ subject: userId }) }
}

type SkillActor = ReturnType<Awaited<ReturnType<typeof fixture>>['actor']>

async function expectSkillsDenied(actor: SkillActor, requestId: string) {
  await expect(actor.query(listRef, {
    workspaceId: 'ws', view: 'personal', paginationOpts: { numItems: 25, cursor: null },
  })).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  await expect(actor.mutation(createRef, createArgs(requestId))).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
}

function createArgs(requestId: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'ws',
    requestId,
    scope: 'personal' as const,
    name: 'Skill',
    description: 'A test skill',
    instructions: 'private instruction payload',
    enabled: true,
    ...overrides,
  }
}

function updateArgs(skillId: unknown, expectedRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'ws',
    skillId,
    expectedRevision,
    name: 'Updated skill',
    description: 'Updated description',
    instructions: 'updated private instruction payload',
    enabled: true,
    ...overrides,
  }
}

async function insertSkill(ctx: MutationCtx, options: {
  name: string
  userId?: string
  scope?: 'personal' | 'workspace'
  workspaceId?: string
  legacy?: boolean
  enabled?: boolean
  archivedAt?: number
  archivedFromScope?: 'personal' | 'workspace'
  revision?: number
}) {
  const { workspaceId = 'ws', legacy = false, ...rest } = options
  return await ctx.db.insert('skills', {
    userId: rest.userId ?? 'alice',
    ...(legacy ? {} : { workspaceId }),
    scope: rest.scope ?? 'personal',
    name: rest.name,
    description: 'description',
    instructions: `private instructions for ${rest.name}`,
    enabled: rest.enabled ?? true,
    ...(rest.archivedAt !== undefined ? { archivedAt: rest.archivedAt } : {}),
    ...(rest.archivedFromScope ? { archivedFromScope: rest.archivedFromScope } : {}),
    revision: rest.revision ?? 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
}

test('native list and create fail closed for missing, expired, or disabled deployment policy', async () => {
  const missing = await fixture({ policy: 'missing' })
  await expectSkillsDenied(missing.actor('alice'), 'missing-policy')

  const expired = await fixture()
  vi.setSystemTime(Date.now() + NATIVE_POLICY_LEASE_MS + 1)
  await expectSkillsDenied(expired.actor('alice'), 'expired-policy')

  const disabled = await fixture({ policy: 'disabled' })
  await expectSkillsDenied(disabled.actor('alice'), 'disabled-policy')
})

test('native access derives its actor from identity and rejects invalid, foreign, revoked, and guest actors', async () => {
  const { t, actor } = await fixture()
  const args = { workspaceId: 'ws', view: 'personal' as const, paginationOpts: { numItems: 25, cursor: null } }

  await expect(t.query(listRef, args)).rejects.toThrow('UNAUTHENTICATED')
  await expect(actor('alice').query(listRef, { ...args, userId: 'owner' } as never)).rejects.toThrow()
  await expect(actor('alice').query(listRef, { ...args, actorUserId: 'owner' } as never)).rejects.toThrow()
  await expect(actor('alice').query(listRef, { ...args, accessToken: 'forged' } as never)).rejects.toThrow()
  await expect(actor('foreign').query(listRef, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(actor('revoked').query(listRef, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(actor('guest').query(listRef, args)).rejects.toThrow('SKILL_ACCESS_DENIED')
})

test('persisted direct and group skills.use assignments are enforced and revocable', async () => {
  const { t, ids, actor } = await fixture()
  const args = { workspaceId: 'ws', view: 'personal' as const, paginationOpts: { numItems: 10, cursor: null } }

  await expect(actor('alice').query(listRef, args)).resolves.toMatchObject({ page: [] })
  await expect(actor('group-user').query(listRef, args)).resolves.toMatchObject({ page: [] })
  await expect(actor('restricted').query(listRef, args)).rejects.toThrow('CAPABILITY_ACCESS_DENIED')

  await t.run(ctx => ctx.db.patch(ids.directRole, { capabilities: ['conversations.read'] }))
  await expect(actor('alice').query(listRef, args)).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  await expect(actor('group-user').query(listRef, args)).resolves.toMatchObject({ page: [] })
  await t.run(ctx => ctx.db.patch(ids.groupId, { archivedAt: now + 1 }))
  await expect(actor('group-user').query(listRef, args)).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
})

test('personal and shared edit rights follow creator/admin rules, with extension creation and move policy', async () => {
  const { t, actor } = await fixture()
  await t.run(ctx => ctx.db.insert('workspaceSharingPolicies', {
    workspaceId: 'ws', publicLinksEnabled: true, workspaceExtensionsEditors: 'admins',
    memberCanMoveScope: false, createdAt: now, updatedAt: now,
  }))
  const owner = actor('owner')
  const admin = actor('admin')
  const alice = actor('alice')

  const personal = await admin.mutation(createRef, createArgs('personal-admin'))
  await expect(owner.mutation(updateRef, updateArgs(personal, 1))).rejects.toThrow('SKILL_ACCESS_DENIED')
  await admin.mutation(updateRef, updateArgs(personal, 1))

  const shared = await admin.mutation(createRef, createArgs('shared-admin', { scope: 'workspace' }))
  await owner.mutation(updateRef, updateArgs(shared, 1, { name: 'Owner updated shared skill' }))
  await expect(alice.mutation(updateRef, updateArgs(shared, 2))).rejects.toThrow('SKILL_ACCESS_DENIED')
  const ownerShared = await owner.mutation(createRef, createArgs('shared-owner', { scope: 'workspace' }))
  await admin.mutation(updateRef, updateArgs(ownerShared, 1, { name: 'Admin updated shared skill' }))
  await expect(alice.mutation(updateRef, updateArgs(ownerShared, 2))).rejects.toThrow('SKILL_ACCESS_DENIED')

  await expect(alice.mutation(createRef, createArgs('member-shared', { scope: 'workspace' })))
    .rejects.toThrow('SKILL_ACCESS_DENIED')
  await expect(alice.query(permissionsRef, { workspaceId: 'ws' })).resolves.toMatchObject({ workspace: false })
  await expect(admin.query(permissionsRef, { workspaceId: 'ws' })).resolves.toMatchObject({ workspace: true })
  const memberPersonal = await alice.mutation(createRef, createArgs('member-personal'))
  await expect(alice.mutation(changeScopeRef, {
    workspaceId: 'ws', skillId: memberPersonal, expectedRevision: 1, action: 'move', to: 'workspace',
  })).rejects.toThrow('SKILL_SCOPE_DENIED:move_disabled')
  await admin.mutation(changeScopeRef, {
    workspaceId: 'ws', skillId: personal, expectedRevision: 2, action: 'move', to: 'workspace',
  })
  await expect(owner.query(getRef, { workspaceId: 'ws', skillId: personal })).resolves.toMatchObject({ scope: 'workspace' })
})

test('bounded native pages preserve cursors across filtered rows', async () => {
  const { t, actor } = await fixture()
  await t.run(async ctx => {
    for (let index = 0; index < 30; index += 1) {
      await insertSkill(ctx, { name: `bounded-${index}`, userId: 'alice' })
    }
  })
  const owner = actor('alice')
  const bounded = await owner.query(listRef, {
    workspaceId: 'ws', view: 'personal', paginationOpts: { numItems: 1000, cursor: null },
  })
  expect(bounded.page).toHaveLength(25)
  expect(bounded.isDone).toBe(false)
  const available = await owner.query(availabilityRef, {
    workspaceId: 'ws', workspaceOnly: false, legacyPersonal: false,
    paginationOpts: { numItems: 1000, cursor: null },
  })
  expect(available.page).toHaveLength(25)

  const filtered = await fixture()
  const inserted = await filtered.t.run(async ctx => {
    const expected: string[] = []
    for (let index = 0; index < 11; index += 1) {
      const visible = index % 3 === 0
      const archived = index % 4 === 0
      const name = `page-${index}`
      await insertSkill(ctx, {
        name,
        userId: 'alice',
        scope: visible ? 'personal' : 'workspace',
        ...(archived ? { archivedAt: now + index, archivedFromScope: visible ? 'personal' as const : 'workspace' as const } : {}),
      })
      if (visible && !archived) expected.push(name)
    }
    return expected
  })
  const pageActor = filtered.actor('alice')
  const names: string[] = []
  let cursor: string | null = null
  let done = false
  while (!done) {
    const result = await pageActor.query(listRef, {
      workspaceId: 'ws', view: 'personal', paginationOpts: { numItems: 2, cursor },
    })
    names.push(...result.page.map(row => row.name))
    cursor = result.continueCursor
    done = result.isDone
  }
  expect(names).toHaveLength(inserted.length)
  expect(new Set(names).size).toBe(names.length)
  expect(names.sort()).toEqual(inserted.sort())
})

test('availability excludes disabled, archived, and private rows and returns safe legacy summaries', async () => {
  const { t, actor } = await fixture()
  const ids = await t.run(async ctx => {
    const values = [
      { name: 'own-personal', userId: 'alice' },
      { name: 'own-shared', userId: 'alice', scope: 'workspace' as const },
      { name: 'other-private', userId: 'bob' },
      { name: 'other-shared', userId: 'bob', scope: 'workspace' as const },
      { name: 'disabled', userId: 'alice', enabled: false },
      { name: 'archived', userId: 'alice', scope: 'workspace' as const, archivedAt: now, archivedFromScope: 'workspace' as const },
      { name: 'legacy-own', userId: 'alice', legacy: true },
      { name: 'legacy-other', userId: 'bob', legacy: true },
    ]
    const result = new Map<string, string>()
    for (const value of values) result.set(value.name, await insertSkill(ctx, value))
    return Object.fromEntries(result)
  })
  const alice = actor('alice')
  const current = await alice.query(availabilityRef, {
    workspaceId: 'ws', workspaceOnly: false, legacyPersonal: false, paginationOpts: { numItems: 50, cursor: null },
  })
  expect(current.page.map(row => row.name).sort()).toEqual(['other-shared', 'own-personal', 'own-shared'])
  expect(JSON.stringify(current)).not.toContain('private instructions')

  const shared = await alice.query(availabilityRef, {
    workspaceId: 'ws', workspaceOnly: true, legacyPersonal: false, paginationOpts: { numItems: 50, cursor: null },
  })
  expect(shared.page.map(row => row.name).sort()).toEqual(['other-shared', 'own-shared'])
  const legacy = await alice.query(availabilityRef, {
    workspaceId: 'ws', workspaceOnly: false, legacyPersonal: true, paginationOpts: { numItems: 50, cursor: null },
  })
  expect(legacy.page).toMatchObject([{ name: 'legacy-own' }])
  expect(JSON.stringify(legacy)).not.toContain('private instructions')
  expect(legacy.page[0]).not.toHaveProperty('instructions')
  expect(ids).toHaveProperty('legacy-own')
})

test('create receipts are idempotent across retries and remain after skill deletion', async () => {
  const { actor, t } = await fixture()
  const alice = actor('alice')
  const payload = createArgs('create-retry')
  const skillId = await alice.mutation(createRef, payload)
  await expect(alice.mutation(createRef, payload)).resolves.toBe(skillId)
  await expect(alice.mutation(createRef, { ...payload, name: 'Different payload' })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  await alice.mutation(removeRef, { workspaceId: 'ws', skillId, expectedRevision: 1 })
  await expect(alice.query(getRef, { workspaceId: 'ws', skillId })).resolves.toBeNull()
  await expect(alice.mutation(createRef, payload)).resolves.toBe(skillId)
  await expect(t.run(ctx => ctx.db.query('skills').collect())).resolves.toEqual([])
  await expect(t.run(ctx => ctx.db.query('skillCreationReceipts').collect())).resolves.toHaveLength(1)
})

test('native revisions converge through update, move, archive, and restore while rejecting stale saves', async () => {
  const { actor } = await fixture()
  const alice = actor('alice')
  const skillId = await alice.mutation(createRef, createArgs('revision-flow'))
  await alice.mutation(updateRef, updateArgs(skillId, 1, { name: 'Revision two' }))
  await expect(alice.mutation(updateRef, updateArgs(skillId, 1))).rejects.toThrow('SKILL_REVISION_CONFLICT')
  await alice.mutation(changeScopeRef, {
    workspaceId: 'ws', skillId, expectedRevision: 2, action: 'move', to: 'workspace',
  })
  await alice.mutation(changeScopeRef, { workspaceId: 'ws', skillId, expectedRevision: 3, action: 'archive' })
  await alice.mutation(changeScopeRef, { workspaceId: 'ws', skillId, expectedRevision: 4, action: 'restore' })
  const restored = await alice.query(getRef, { workspaceId: 'ws', skillId })
  expect(restored).toMatchObject({ revision: 5, scope: 'workspace' })
  expect(restored?.archivedAt).toBeUndefined()
  await alice.mutation(changeScopeRef, {
    workspaceId: 'ws', skillId, expectedRevision: 5, action: 'move', to: 'personal',
  })
  const personal = await alice.query(getRef, { workspaceId: 'ws', skillId })
  expect(personal).toMatchObject({ revision: 6, scope: 'personal', name: 'Revision two' })
})

test('legacy field and scope mutations advance revisions so native stale writes conflict', async () => {
  const { t, actor } = await fixture()
  const ids = await t.run(async ctx => ({
    field: await insertSkill(ctx, { name: 'legacy-field', userId: 'alice', revision: 4 }),
    scoped: await insertSkill(ctx, { name: 'legacy-scope', userId: 'alice', revision: 8 }),
  }))
  const alice = actor('alice')
  await alice.mutation(legacyUpdateRef, {
    skillId: ids.field, userId: 'alice', workspaceId: 'ws', serverSecret: secret, name: 'Legacy updated',
  })
  const field = await t.run(ctx => ctx.db.get(ids.field))
  expect(field?.revision).toBe(5)
  await expect(alice.mutation(updateRef, updateArgs(ids.field, 4))).rejects.toThrow('SKILL_REVISION_CONFLICT')

  await alice.mutation(legacySetScopeRef, {
    id: ids.scoped, userId: 'alice', workspaceId: 'ws', serverSecret: secret, to: 'workspace',
  })
  expect((await t.run(ctx => ctx.db.get(ids.scoped)))?.revision).toBe(9)
  await alice.mutation(legacyArchiveRef, {
    id: ids.scoped, userId: 'alice', workspaceId: 'ws', serverSecret: secret,
  })
  expect((await t.run(ctx => ctx.db.get(ids.scoped)))?.revision).toBe(10)
  await alice.mutation(legacyRestoreRef, {
    id: ids.scoped, userId: 'alice', workspaceId: 'ws', serverSecret: secret,
  })
  expect((await t.run(ctx => ctx.db.get(ids.scoped)))?.revision).toBe(11)
  await expect(alice.mutation(updateRef, updateArgs(ids.scoped, 8))).rejects.toThrow('SKILL_REVISION_CONFLICT')
})

test('write admission is rate-limited and successful audit records omit instruction payloads', async () => {
  const { t, actor } = await fixture()
  const alice = actor('alice')
  const instructions = 'do-not-store-in-audit-6c9f'
  const skillId = await alice.mutation(createRef, createArgs('audit-success', { instructions }))
  const auditEvents = await t.run(ctx => ctx.db.query('auditEvents').collect())
  const skillAudit = auditEvents.filter(event => event.resourceId === skillId)
  expect(skillAudit).toHaveLength(1)
  expect(skillAudit[0]).toMatchObject({ action: 'skill.create', outcome: 'success', actorUserId: 'alice' })
  expect(JSON.stringify(skillAudit)).not.toContain(instructions)
  const bucket = await t.run(ctx => ctx.db.query('rateLimitWindows').withIndex('by_bucketKey', q =>
    q.eq('bucketKey', 'skills:write:user:alice')).unique())
  expect(bucket).toMatchObject({ bucket: 'skills:write:user', count: 1 })

  await t.run(ctx => ctx.db.patch(bucket!._id, { count: 600, resetAt: Date.now() + 60_000 }))
  await expect(alice.mutation(createRef, createArgs('rate-limited'))).rejects.toThrow('RATE_LIMITED')
  await expect(t.run(ctx => ctx.db.query('auditEvents').collect())).resolves.toHaveLength(1)
})
