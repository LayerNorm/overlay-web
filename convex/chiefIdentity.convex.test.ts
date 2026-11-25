import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'chief-identity-test-secret'
const now = 1_900_000_000_000
const mutationFn = (name: string) => makeFunctionReference<'mutation'>(`collaboration/agents:${name}`)
const queryFn = (name: string) => makeFunctionReference<'query'>(`collaboration/agents:${name}`)
const threadsFn = (name: string) => makeFunctionReference<'mutation'>(`agents/agentThreads:${name}`)

type Member = {
  userId: string
  principalId: string
  role?: 'owner' | 'admin' | 'member' | 'guest'
  status?: 'active' | 'suspended'
  displayName?: string
}

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

function testBackend() {
  return convexTest(schema, modules)
}

async function seedWorkspace(
  convex: ReturnType<typeof testBackend>,
  args: {
    workspaceId: string
    kind: 'personal' | 'organization'
    members: Member[]
    defaultAgent?: { agentId: string; name: string; explicit?: boolean }
    personalOwnerUserId?: string
  },
) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: args.workspaceId,
      kind: args.kind,
      name: args.workspaceId,
      slug: args.workspaceId,
      status: 'active',
      ...(args.personalOwnerUserId ? { personalOwnerUserId: args.personalOwnerUserId } : {}),
      createdAt: now,
      updatedAt: now,
    })
    for (const member of args.members) {
      await ctx.db.insert('workspacePrincipals', {
        principalId: member.principalId,
        workspaceId: args.workspaceId,
        type: 'human',
        userId: member.userId,
        displayName: member.displayName ?? member.userId,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `membership-${args.workspaceId}-${member.userId}`,
        workspaceId: args.workspaceId,
        principalId: member.principalId,
        role: member.role ?? 'member',
        status: member.status ?? 'active',
        joinedAt: now,
        updatedAt: now,
      })
    }
    if (args.defaultAgent) {
      const principalId = `principal-${args.defaultAgent.agentId}`
      await ctx.db.insert('workspacePrincipals', {
        principalId,
        workspaceId: args.workspaceId,
        type: 'agent',
        agentId: args.defaultAgent.agentId,
        displayName: args.defaultAgent.name,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `membership-${args.defaultAgent.agentId}`,
        workspaceId: args.workspaceId,
        principalId,
        role: 'member',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId: args.defaultAgent.agentId,
        workspaceId: args.workspaceId,
        principalId,
        name: args.defaultAgent.name,
        description: 'Legacy appearance',
        instructions: 'Keep this execution history intact.',
        harness: 'overlay',
        modelId: 'test-model',
        avatarColor: '#123abc',
        avatarShape: 'droplet',
        allowedToolIds: ['read_file'],
        invocationPolicy: 'mention',
        visibility: 'workspace',
        createdByPrincipalId: args.members[0]!.principalId,
        createdAt: now,
        updatedAt: now,
        teamIds: [],
        roomCount: 0,
        ...(args.defaultAgent.explicit ? { isDefault: true } : {}),
      })
    }
  })
}

function ensure(
  convex: ReturnType<typeof testBackend>, workspaceId: string, userId: string, principalId: string, includePersonal = true,
) {
  return convex.mutation(mutationFn('ensureChiefsByServer'), {
    serverSecret: secret, workspaceId, actorUserId: userId, actorPrincipalId: principalId, includePersonal, now,
  } as never)
}

function list(convex: ReturnType<typeof testBackend>, workspaceId: string) {
  return convex.query(queryFn('listByServer'), { serverSecret: secret, workspaceId } as never) as Promise<Array<{
    agentId: string; name: string; description?: string; instructions: string; avatarColor?: string; avatarShape?: string
    isDefault?: boolean; agentRole?: string; chiefOwnerUserId?: string; chiefScope?: string
    visibility: string; allowedToolIds: string[]
  }>>
}

describe('chief identity provisioning', () => {
  test('concurrent repeated ensure calls create one workspace chief and only the caller’s personal chief', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-concurrent',
      kind: 'organization',
      members: [
        { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
        { userId: 'member', principalId: 'principal-member', role: 'member' },
        { userId: 'guest', principalId: 'principal-guest', role: 'guest' },
      ],
    })
    await Promise.all([
      ensure(convex, 'chief-concurrent', 'owner', 'principal-owner'),
      ensure(convex, 'chief-concurrent', 'owner', 'principal-owner'),
    ])
    await ensure(convex, 'chief-concurrent', 'member', 'principal-member', false)
    const agents = await list(convex, 'chief-concurrent')
    expect(agents.filter((row) => row.agentRole === 'workspace_chief')).toHaveLength(1)
    const personal = agents.filter((row) => row.agentRole === 'personal_chief')
    expect(personal.map((row) => [row.chiefOwnerUserId, row.chiefScope, row.visibility]))
      .toEqual([['owner', 'personal', 'creator']])
    await expect(ensure(convex, 'chief-concurrent', 'guest', 'principal-guest'))
      .rejects.toThrow('WORKSPACE_AGENT_EDIT_FORBIDDEN')
  })

  test('a new public channel never adds personal chiefs or creator-only agents', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-channel',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }, { userId: 'member', principalId: 'principal-member' }],
      defaultAgent: { agentId: 'shared-agent', name: 'Shared agent' },
    })
    await ensure(convex, 'chief-channel', 'owner', 'principal-owner')
    await ensure(convex, 'chief-channel', 'member', 'principal-member')
    await convex.run(async (ctx) => {
      const shared = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', (q) => q.eq('agentId', 'shared-agent')).unique()
      await ctx.db.insert('workspacePrincipals', { principalId: 'principal-private-agent', workspaceId: 'chief-channel', type: 'agent', agentId: 'private-agent', displayName: 'Private agent', createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: 'membership-private-agent', workspaceId: 'chief-channel', principalId: 'principal-private-agent', role: 'member', status: 'active', joinedAt: now, updatedAt: now })
      const { _id: _ignored, _creationTime: _time, ...rest } = shared!
      await ctx.db.insert('workspaceAgentDefinitions', { ...rest, agentId: 'private-agent', principalId: 'principal-private-agent', name: 'Private agent', visibility: 'creator' })
    })
    const { conversationId } = await convex.mutation(makeFunctionReference<'mutation'>('collaboration/channels:createChannel'), {
      serverSecret: secret, workspaceId: 'chief-channel', actorUserId: 'owner', name: 'launch', visibility: 'public',
    } as never) as { conversationId: string }
    const joined = await convex.run(async (ctx) => (await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', conversationId as never)).collect())
      .map((row) => row.principalId))
    const chiefs = (await list(convex, 'chief-channel')).filter((agent) => agent.agentRole === 'personal_chief')
    expect(chiefs).toHaveLength(2)
    expect(joined).toEqual(expect.arrayContaining(['principal-owner', 'principal-member', 'principal-shared-agent']))
    expect(joined).not.toContain('principal-private-agent')
    for (const chief of chiefs) expect(joined).not.toContain((chief as { principalId?: string }).principalId)
  })

  test('personal chiefs and creator-only agents cannot be added to channels or group DMs', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-shared-rooms',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }, { userId: 'member', principalId: 'principal-member' }],
    })
    await ensure(convex, 'chief-shared-rooms', 'owner', 'principal-owner')
    const chief = (await list(convex, 'chief-shared-rooms')).find((agent) => agent.agentRole === 'personal_chief') as { principalId: string }
    const { conversationId } = await convex.mutation(makeFunctionReference<'mutation'>('collaboration/channels:createChannel'), {
      serverSecret: secret, workspaceId: 'chief-shared-rooms', actorUserId: 'owner', name: 'ops', visibility: 'public',
    } as never) as { conversationId: string }
    await expect(convex.mutation(makeFunctionReference<'mutation'>('collaboration/directMessages:addParticipant'), {
      serverSecret: secret, workspaceId: 'chief-shared-rooms', actorUserId: 'owner', conversationId, principalId: chief.principalId,
    } as never)).rejects.toThrow('PERSONAL_AGENT_NOT_IN_SHARED_ROOMS')
    await expect(convex.mutation(makeFunctionReference<'mutation'>('collaboration/directMessages:createDirectMessage'), {
      serverSecret: secret, workspaceId: 'chief-shared-rooms', actorUserId: 'owner', principalIds: ['principal-member', chief.principalId],
    } as never)).rejects.toThrow('PERSONAL_AGENT_NOT_IN_SHARED_ROOMS')
  })

  test('without includePersonal only the workspace chief is ensured', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-lazy',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-lazy', 'owner', 'principal-owner', false)
    const agents = await list(convex, 'chief-lazy')
    expect(agents.map((row) => row.agentRole)).toEqual(['workspace_chief'])
    expect(await convex.run(async (ctx) => ctx.db.query('personalChiefIdentities').collect())).toHaveLength(0)
  })

  test('adopts an explicit legacy default without changing its ID, settings, or thread reference', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-adoption',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
      defaultAgent: { agentId: 'legacy-default-id', name: 'Former name', explicit: true },
    })
    const oldThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-adoption', agentId: 'legacy-default-id', userId: 'owner',
    } as never) as { conversationId: string }
    await ensure(convex, 'chief-adoption', 'owner', 'principal-owner')
    const agents = await list(convex, 'chief-adoption')
    const adopted = agents.find((row) => row.agentId === 'legacy-default-id')
    expect(adopted).toMatchObject({
      agentRole: 'workspace_chief', chiefScope: 'workspace', isDefault: true,
      name: 'Former name', allowedToolIds: ['read_file'],
    })
    const thread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-adoption', agentId: 'legacy-default-id', userId: 'owner',
    } as never) as { conversationId: string }
    expect(thread.conversationId).toBe(oldThread.conversationId)
    const stored = await convex.run(async (ctx) =>
      ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', (q) => q.eq('agentId', 'legacy-default-id')).unique())
    expect(stored?.instructions).toBe('Keep this execution history intact.')
    expect(stored?.description).toBe('Legacy appearance')
  })

  test('a personal workspace adopts its old default as the Personal Chief even on a Workspace-only visit', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-personal-legacy',
      kind: 'personal',
      personalOwnerUserId: 'owner',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
      defaultAgent: { agentId: 'legacy-personal-default', name: 'Overlay', explicit: true },
    })
    await ensure(convex, 'chief-personal-legacy', 'owner', 'principal-owner', false)
    const agents = await list(convex, 'chief-personal-legacy')
    expect(agents.find((row) => row.agentId === 'legacy-personal-default'))
      .toMatchObject({ agentRole: 'personal_chief', chiefScope: 'personal', visibility: 'creator' })
    expect(agents.filter((row) => row.visibility === 'workspace').map((row) => row.agentRole)).toEqual(['workspace_chief'])
  })

  test('does not adopt an arbitrary agent named Overlay', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-name-not-authority',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
      defaultAgent: { agentId: 'ordinary-overlay', name: 'Overlay' },
    })
    await ensure(convex, 'chief-name-not-authority', 'owner', 'principal-owner')
    const agents = await list(convex, 'chief-name-not-authority')
    const ordinary = agents.find((row) => row.agentId === 'ordinary-overlay')
    expect(ordinary?.agentRole).toBeUndefined()
    expect(ordinary?.isDefault).toBeUndefined()
    expect(agents.find((row) => row.agentRole === 'workspace_chief')?.agentId).not.toBe('ordinary-overlay')
  })

  test('personal profile updates project across workspaces without changing roles or grants', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-personal-owner',
      kind: 'personal',
      personalOwnerUserId: 'owner',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner', displayName: 'Ada Lovelace' }],
      defaultAgent: { agentId: 'default-overlay-chief-personal-owner', name: 'Overlay', explicit: true },
    })
    await seedWorkspace(convex, {
      workspaceId: 'chief-personal-org',
      kind: 'organization',
      members: [
        { userId: 'owner', principalId: 'principal-owner-org', role: 'owner', displayName: 'Ada Lovelace' },
        { userId: 'peer', principalId: 'principal-peer', role: 'member' },
      ],
    })
    await ensure(convex, 'chief-personal-org', 'owner', 'principal-owner-org')
    await ensure(convex, 'chief-personal-owner', 'owner', 'principal-owner')
    const before = await list(convex, 'chief-personal-org')
    const ownerBinding = before.find((row) => row.agentRole === 'personal_chief' && row.chiefOwnerUserId === 'owner')!
    // The old default's look carries over; its name ("Overlay") never does.
    expect(ownerBinding).toMatchObject({
      name: 'Ada’s Chief', description: 'Legacy appearance',
      avatarColor: '#123abc', avatarShape: 'droplet',
    })
    const adopted = (await list(convex, 'chief-personal-owner')).find((row) => row.agentId === 'default-overlay-chief-personal-owner')!
    expect(adopted).toMatchObject({ agentRole: 'personal_chief', name: 'Ada’s Chief', isDefault: true })
    const adoptedPrincipal = await convex.run(async (ctx) => ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', 'principal-default-overlay-chief-personal-owner')).unique())
    expect(adoptedPrincipal?.displayName).toBe('Ada’s Chief')
    const originalTools = ownerBinding.allowedToolIds
    await convex.mutation(mutationFn('updateChiefIdentityByServer'), {
      serverSecret: secret,
      ownerUserId: 'owner',
      updatedByPrincipalId: 'principal-owner',
      name: 'Ada Global',
      now: now + 1,
    } as never)
    const personalWorkspaceRows = await list(convex, 'chief-personal-owner')
    const orgRows = await list(convex, 'chief-personal-org')
    expect(personalWorkspaceRows.find((row) => row.agentRole === 'personal_chief')?.name).toBe('Ada Global')
    expect(orgRows.find((row) => row.agentId === ownerBinding.agentId)?.name).toBe('Ada Global')
    const after = orgRows.find((row) => row.agentId === ownerBinding.agentId)!
    expect(after.agentRole).toBe('personal_chief')
    expect(after.allowedToolIds).toEqual(originalTools)
    await convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'chief-personal-org',
      agentId: ownerBinding.agentId,
      instructions: 'Org binding instructions',
      name: 'Mixed profile',
      updatedByPrincipalId: 'principal-owner-org',
      now: now + 2,
    } as never)
    const allPersonal = [...await list(convex, 'chief-personal-org'), ...await list(convex, 'chief-personal-owner')]
      .filter((row) => row.agentRole === 'personal_chief')
    expect(allPersonal.every((row) => row.name === 'Mixed profile')).toBe(true)
    expect(allPersonal.find((row) => row.agentId === ownerBinding.agentId)?.instructions).toBe('Org binding instructions')
    expect(allPersonal.find((row) => row.agentId === adopted.agentId)?.instructions).not.toBe('Org binding instructions')
    await expect(convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'chief-personal-org',
      agentId: ownerBinding.agentId,
      instructions: '',
      name: 'Should rollback',
      updatedByPrincipalId: 'principal-owner-org',
      now: now + 3,
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    expect((await list(convex, 'chief-personal-org')).find((row) => row.agentId === ownerBinding.agentId)?.name)
      .toBe('Mixed profile')
  })

  test('the personal and workspace chiefs have distinct IDs and isolated threads', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-scopes',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-scopes', 'owner', 'principal-owner')
    const agents = await list(convex, 'chief-scopes')
    const personal = agents.filter((row) => row.agentRole === 'personal_chief')
    expect(personal).toHaveLength(1)
    const workspace = agents.find((row) => row.agentRole === 'workspace_chief')!
    expect(personal[0]!.agentId).not.toBe(workspace.agentId)
    expect(personal[0]!.visibility).toBe('creator')
    const personalThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-scopes', agentId: personal[0]!.agentId, userId: 'owner',
    } as never) as { conversationId: string }
    const workspaceThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-scopes', agentId: workspace.agentId, userId: 'owner',
    } as never) as { conversationId: string }
    expect(personalThread.conversationId).not.toBe(workspaceThread.conversationId)
  })

  test('hides removed owners and rejects cross-workspace reads', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-owner-removal',
      kind: 'organization',
      members: [
        { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
        { userId: 'removed', principalId: 'principal-removed', role: 'member' },
      ],
    })
    await ensure(convex, 'chief-owner-removal', 'owner', 'principal-owner')
    await ensure(convex, 'chief-owner-removal', 'removed', 'principal-removed')
    const before = await list(convex, 'chief-owner-removal')
    const removed = before.find((row) => row.chiefOwnerUserId === 'removed')!
    await convex.run(async (ctx) => {
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', 'chief-owner-removal').eq('principalId', 'principal-removed')).unique()
      if (membership) await ctx.db.patch(membership._id, { status: 'suspended', updatedAt: now + 1 })
    })
    expect((await list(convex, 'chief-owner-removal')).some((row) => row.chiefOwnerUserId === 'removed')).toBe(false)
    const hiddenAfterRemoval = await convex.query(queryFn('getByServer'), {
      serverSecret: secret, workspaceId: 'chief-owner-removal', agentId: removed.agentId,
    } as never)
    expect(hiddenAfterRemoval).toBeNull()
    const crossWorkspace = await convex.query(queryFn('getByServer'), {
      serverSecret: secret, workspaceId: 'different-workspace', agentId: removed.agentId,
    } as never)
    expect(crossWorkspace).toBeNull()
  })

  test('owner uniqueness allows duplicate personal chief display names; peers cannot mutate bindings', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-duplicate-names',
      kind: 'organization',
      members: [
        { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
        { userId: 'peer', principalId: 'principal-peer', role: 'admin' },
      ],
    })
    await convex.run(async (ctx) => {
      for (const userId of ['owner', 'peer']) {
        await ctx.db.insert('personalChiefIdentities', {
          userId, name: 'Shared custom name', description: 'Personal profile',
          avatarColor: '#8b5cf6', avatarShape: 'squircle', createdAt: now, updatedAt: now,
        })
      }
    })
    await ensure(convex, 'chief-duplicate-names', 'owner', 'principal-owner')
    await ensure(convex, 'chief-duplicate-names', 'peer', 'principal-peer')
    const agents = await list(convex, 'chief-duplicate-names')
    const personalBindings = agents.filter((row) => row.agentRole === 'personal_chief')
    expect(personalBindings).toHaveLength(2)
    expect(personalBindings.every((row) => row.name === 'Shared custom name')).toBe(true)
    const ownerBinding = personalBindings.find((row) => row.chiefOwnerUserId === 'owner')!
    await expect(convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret, workspaceId: 'chief-duplicate-names', agentId: ownerBinding.agentId,
      instructions: 'Peer edit', updatedByPrincipalId: 'principal-peer', now: now + 1,
    } as never)).rejects.toThrow()
    await expect(convex.mutation(mutationFn('updateChiefIdentityByServer'), {
      serverSecret: secret, ownerUserId: 'owner', updatedByPrincipalId: 'principal-peer',
      name: 'Admin takeover', now: now + 1,
    } as never)).rejects.toThrow('CHIEF_IDENTITY_OWNER_REQUIRED')
    expect(await convex.mutation(mutationFn('archiveByServer'), {
      serverSecret: secret, workspaceId: 'chief-duplicate-names', agentId: ownerBinding.agentId, now: now + 1,
    } as never)).toBe(false)
  })

  test('the personal chief is creator-only and named Personal Chief without a name', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-private-binding',
      kind: 'personal',
      personalOwnerUserId: 'owner',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-private-binding', 'owner', 'principal-owner')
    const personal = (await list(convex, 'chief-private-binding')).filter((row) => row.agentRole === 'personal_chief')
    expect(personal).toHaveLength(1)
    expect(personal[0]).toMatchObject({ chiefScope: 'personal', visibility: 'creator', name: 'Personal Chief' })
    expect(personal[0]?.isDefault).toBeUndefined()
  })

  test('renaming a workspace chief does not make it archivable or deletable', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-rename-protection',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-rename-protection', 'owner', 'principal-owner')
    const chief = (await list(convex, 'chief-rename-protection')).find((row) => row.agentRole === 'workspace_chief')!
    await convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret, workspaceId: 'chief-rename-protection', agentId: chief.agentId,
      updatedByPrincipalId: 'principal-owner', name: 'Renamed chief', now: now + 1,
    } as never)
    expect(await convex.mutation(mutationFn('archiveByServer'), {
      serverSecret: secret, workspaceId: 'chief-rename-protection', agentId: chief.agentId, now: now + 2,
    } as never)).toBe(false)
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('workspaceAgentDefinitions')
        .withIndex('by_agentId', (q) => q.eq('agentId', chief.agentId)).unique()
      if (row) await ctx.db.patch(row._id, { archivedAt: now + 3 })
    })
    expect(await convex.mutation(mutationFn('deleteArchivedByServer'), {
      serverSecret: secret, workspaceId: 'chief-rename-protection', agentId: chief.agentId, now: now + 4,
    } as never)).toBe(false)
  })

  test('names the personal chief after the owner’s first name when no personal default exists', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-display-name',
      kind: 'organization',
      members: [{ userId: 'owner-id', principalId: 'principal-owner', role: 'owner', displayName: 'Ada Lovelace' }],
    })
    await ensure(convex, 'chief-display-name', 'owner-id', 'principal-owner')
    const personal = (await list(convex, 'chief-display-name')).find((row) => row.agentRole === 'personal_chief')
    expect(personal).toMatchObject({
      name: 'Ada’s Chief',
      avatarColor: '#8b5cf6',
      avatarShape: 'squircle',
    })
  })
})
