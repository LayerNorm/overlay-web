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

function ensure(convex: ReturnType<typeof testBackend>, workspaceId: string, userId: string, principalId: string) {
  return convex.mutation(mutationFn('ensureChiefsByServer'), {
    serverSecret: secret, workspaceId, actorUserId: userId, actorPrincipalId: principalId, now,
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
  test('concurrent repeated ensure calls create one workspace and one binding per eligible owner', async () => {
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
    const agents = await list(convex, 'chief-concurrent')
    expect(agents.filter((row) => row.agentRole === 'workspace_chief')).toHaveLength(1)
    expect(agents.filter((row) => row.agentRole === 'personal_chief')).toHaveLength(4)
    expect(agents.some((row) => row.chiefOwnerUserId === 'guest')).toBe(false)
    await expect(ensure(convex, 'chief-concurrent', 'guest', 'principal-guest'))
      .rejects.toThrow('WORKSPACE_AGENT_EDIT_FORBIDDEN')
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

  test('personal profile updates project across scopes without changing roles or grants', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-personal-owner',
      kind: 'personal',
      personalOwnerUserId: 'owner',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
      defaultAgent: { agentId: 'default-overlay-chief-personal-owner', name: 'Ada Local', explicit: true },
    })
    await seedWorkspace(convex, {
      workspaceId: 'chief-personal-org',
      kind: 'organization',
      members: [
        { userId: 'owner', principalId: 'principal-owner-org', role: 'owner' },
        { userId: 'peer', principalId: 'principal-peer', role: 'member' },
      ],
    })
    await ensure(convex, 'chief-personal-org', 'owner', 'principal-owner-org')
    await ensure(convex, 'chief-personal-owner', 'owner', 'principal-owner')
    const before = await list(convex, 'chief-personal-org')
    const ownerBinding = before.find((row) => row.agentRole === 'personal_chief' && row.chiefOwnerUserId === 'owner')!
    expect(ownerBinding).toMatchObject({
      name: 'Ada Local', description: 'Legacy appearance',
      avatarColor: '#123abc', avatarShape: 'droplet',
    })
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
    const privateBinding = orgRows.find((row) => row.agentRole === 'personal_chief' && row.chiefScope === 'personal')!
    const workspaceBinding = orgRows.find((row) => row.agentRole === 'personal_chief' && row.chiefScope === 'workspace')!
    const privateInstructions = privateBinding.instructions
    await convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'chief-personal-org',
      agentId: workspaceBinding.agentId,
      instructions: 'Workspace binding instructions',
      name: 'Mixed profile',
      updatedByPrincipalId: 'principal-owner-org',
      now: now + 2,
    } as never)
    const mixedRows = await list(convex, 'chief-personal-org')
    expect(mixedRows.filter((row) => row.agentRole === 'personal_chief' && row.chiefOwnerUserId === 'owner')
      .every((row) => row.name === 'Mixed profile')).toBe(true)
    expect(mixedRows.find((row) => row.agentId === workspaceBinding.agentId)?.instructions).toBe('Workspace binding instructions')
    expect(mixedRows.find((row) => row.agentId === privateBinding.agentId)?.instructions).not.toBe('Workspace binding instructions')
    expect(privateInstructions).toBeDefined()
    await expect(convex.mutation(mutationFn('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'chief-personal-org',
      agentId: workspaceBinding.agentId,
      instructions: '',
      name: 'Should rollback',
      updatedByPrincipalId: 'principal-owner-org',
      now: now + 3,
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    expect((await list(convex, 'chief-personal-org')).find((row) => row.agentId === workspaceBinding.agentId)?.name)
      .toBe('Mixed profile')
  })

  test('personal and workspace scopes have distinct IDs and isolated threads', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-scopes',
      kind: 'organization',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-scopes', 'owner', 'principal-owner')
    const agents = await list(convex, 'chief-scopes')
    const personal = agents.find((row) => row.agentRole === 'personal_chief' && row.chiefScope === 'personal')!
    const personalWorkspace = agents.find((row) => row.agentRole === 'personal_chief' && row.chiefScope === 'workspace')!
    const workspace = agents.find((row) => row.agentRole === 'workspace_chief')!
    expect(personal.agentId).not.toBe(workspace.agentId)
    expect(personal.agentId).not.toBe(personalWorkspace.agentId)
    expect(personal.visibility).toBe('creator')
    expect(personalWorkspace.visibility).toBe('workspace')
    const personalThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-scopes', agentId: personal.agentId, userId: 'owner',
    } as never) as { conversationId: string }
    const workspaceThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-scopes', agentId: workspace.agentId, userId: 'owner',
    } as never) as { conversationId: string }
    const personalWorkspaceThread = await convex.mutation(threadsFn('resolveMainThreadByServer'), {
      serverSecret: secret, workspaceId: 'chief-scopes', agentId: personalWorkspace.agentId, userId: 'owner',
    } as never) as { conversationId: string }
    expect(personalThread.conversationId).not.toBe(workspaceThread.conversationId)
    expect(personalThread.conversationId).not.toBe(personalWorkspaceThread.conversationId)
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
    const agents = await list(convex, 'chief-duplicate-names')
    const personalBindings = agents.filter((row) => row.agentRole === 'personal_chief')
    expect(personalBindings).toHaveLength(4)
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

  test('private personal bindings retain creator visibility', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-private-binding',
      kind: 'personal',
      personalOwnerUserId: 'owner',
      members: [{ userId: 'owner', principalId: 'principal-owner', role: 'owner' }],
    })
    await ensure(convex, 'chief-private-binding', 'owner', 'principal-owner')
    const personal = (await list(convex, 'chief-private-binding')).filter((row) => row.agentRole === 'personal_chief')
    expect(personal).toHaveLength(2)
    expect(personal.find((row) => row.chiefScope === 'personal')?.visibility).toBe('creator')
    expect(personal.find((row) => row.chiefScope === 'workspace')?.visibility).toBe('workspace')
    expect(personal.find((row) => row.chiefScope === 'personal')?.isDefault).toBeUndefined()
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

  test('bootstraps appearance from the owner display name when no personal default exists', async () => {
    const convex = testBackend()
    await seedWorkspace(convex, {
      workspaceId: 'chief-display-name',
      kind: 'organization',
      members: [{ userId: 'owner-id', principalId: 'principal-owner', role: 'owner', displayName: 'Ada Lovelace' }],
    })
    await ensure(convex, 'chief-display-name', 'owner-id', 'principal-owner')
    const personal = (await list(convex, 'chief-display-name')).find((row) => row.agentRole === 'personal_chief')
    expect(personal).toMatchObject({
      name: 'Ada Lovelace’s Overlay',
      avatarColor: '#8b5cf6',
      avatarShape: 'squircle',
    })
  })
})
