import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { NATIVE_POLICY_LEASE_MS } from '@/shared/authorization/native-deployment-policy'

const modules = import.meta.glob('./**/*.ts')
const previousSecret = process.env.INTERNAL_API_SECRET
const secret = 'native-agent-directory-test-secret'
const now = 1_900_000_000_000
const queryFn = (name: string) => makeFunctionReference<'query'>(`agents/nativeDirectory:${name}`)
const mutationFn = (name: string) => makeFunctionReference<'mutation'>(`agents/nativeDirectory:${name}`)
const legacyMutation = (name: string) => makeFunctionReference<'mutation'>(`collaboration/agents:${name}`)
const policyBegin = makeFunctionReference<'mutation'>('platform/nativePolicy:beginRefresh')
const policyPublish = makeFunctionReference<'mutation'>('platform/nativePolicy:publish')
const policyBackendUrl = 'https://fixture.convex.cloud'
const policyFeatures = {
  files: true,
  skills: true,
  mcpServers: true,
  externalAgents: true,
  connectedAgents: true,
  workspaceHandles: false,
}

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
afterAll(() => {
  if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousSecret
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function configureNativePolicyEnvironment() {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', policyBackendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
}

async function publishNativePolicy(
  convex: ReturnType<typeof backend>,
  featureOverrides: Partial<typeof policyFeatures> = {},
) {
  const challenge = crypto.randomUUID()
  const currentSequence = await convex.mutation(policyBegin, { challenge } as never) as { sequence: number }
  return await convex.mutation(policyPublish, {
    sequence: currentSequence.sequence,
    challenge,
    issuedAt: Date.now(),
    snapshot: {
      version: 1,
      backendUrl: policyBackendUrl,
      revision: 'a'.repeat(64),
      features: { ...policyFeatures, ...featureOverrides },
      rollout: {
        stage: 'invited',
        internalWorkspaceIds: 'internal',
        invitedWorkspaceIds: 'workspace-external',
      },
    },
  } as never) as boolean
}

type Member = {
  userId: string
  principalId: string
  role: 'owner' | 'admin' | 'member' | 'guest'
  status?: 'active' | 'suspended'
}

function backend() {
  return convexTest(schema, modules)
}

async function seedWorkspace(
  convex: ReturnType<typeof backend>,
  workspaceId: string,
  members: Member[],
  memberCanCreateAgents?: boolean,
) {
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
        membershipId: `membership-${workspaceId}-${member.userId}`,
        workspaceId,
        principalId: member.principalId,
        role: member.role,
        status: member.status ?? 'active',
        joinedAt: now,
        updatedAt: now,
      })
    }
    if (memberCanCreateAgents !== undefined) {
      await ctx.db.insert('workspaceSharingPolicies', {
        workspaceId,
        publicLinksEnabled: false,
        memberCanCreateAgents,
        createdAt: now,
        updatedAt: now,
      })
    }
  })
}

function asUser(convex: ReturnType<typeof backend>, userId: string) {
  return convex.withIdentity({ subject: userId, issuer: 'https://issuer.example.test' })
}

const createArgs = (workspaceId: string, requestId: string, name: string, visibility: 'creator' | 'workspace' = 'workspace') => ({
  workspaceId,
  requestId,
  name,
  instructions: 'Use the saved profile safely.',
  modelId: 'test-model',
  visibility,
  allowedToolIds: ['read_file'],
  teamIds: [],
})

function listArgs(workspaceId: string, includeArchived = false) {
  return { workspaceId, includeArchived, paginationOpts: { cursor: null, numItems: 100 } }
}

describe('native agent directory authorization and revisions', () => {
  test('derives identity from Convex auth and rejects anonymous, spoofed, cross-workspace, and revoked access', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-a', [
      { userId: 'member-a', principalId: 'principal-a', role: 'member' },
    ])
    await seedWorkspace(convex, 'workspace-b', [
      { userId: 'member-b', principalId: 'principal-b', role: 'member' },
      { userId: 'suspended', principalId: 'principal-suspended', role: 'member', status: 'suspended' },
    ])

    await expect(convex.query(queryFn('context'), { workspaceId: 'workspace-a' } as never))
      .rejects.toThrow('UNAUTHENTICATED')
    const memberA = asUser(convex, 'member-a')
    await expect(memberA.query(queryFn('context'), {
      workspaceId: 'workspace-a',
      actorUserId: 'member-b',
    } as never)).rejects.toThrow()
    await expect(memberA.query(queryFn('context'), { workspaceId: 'workspace-b' } as never))
      .rejects.toThrow('WORKSPACE_ACCESS_DENIED')
    await expect(asUser(convex, 'suspended').query(queryFn('context'), { workspaceId: 'workspace-b' } as never))
      .rejects.toThrow('WORKSPACE_ACCESS_DENIED')

    const target = await asUser(convex, 'member-b').mutation(mutationFn('create'), {
      ...createArgs('workspace-b', '12121212-1212-4121-8121-121212121212', 'Cross-workspace target'),
    } as never) as { id: string; revision: string }
    await expect(memberA.mutation(mutationFn('update'), {
      workspaceId: 'workspace-b',
      agentId: target.id,
      expectedRevision: target.revision,
      patch: { name: 'Cross-workspace mutation' },
    } as never)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
    await expect(asUser(convex, 'suspended').mutation(mutationFn('update'), {
      workspaceId: 'workspace-b',
      agentId: target.id,
      expectedRevision: target.revision,
      patch: { name: 'Revoked mutation' },
    } as never)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  })

  test('keeps creator-only records hidden, lets managers edit visible agents, and preserves create policy parity', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-policy', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
      { userId: 'creator', principalId: 'principal-creator', role: 'member' },
      { userId: 'admin', principalId: 'principal-admin', role: 'admin' },
      { userId: 'guest', principalId: 'principal-guest', role: 'guest' },
      { userId: 'blocked', principalId: 'principal-blocked', role: 'member' },
    ])
    const creator = asUser(convex, 'creator')
    const privateAgent = await creator.mutation(mutationFn('create'), {
      ...createArgs('workspace-policy', '11111111-1111-4111-8111-111111111111', 'Private agent', 'creator'),
    } as never) as { id: string; revision: string }
    const replay = await creator.mutation(mutationFn('create'), {
      ...createArgs('workspace-policy', '11111111-1111-4111-8111-111111111111', 'Private agent', 'creator'),
    } as never) as { id: string }
    expect(replay.id).toBe(privateAgent.id)
    expect((await asUser(convex, 'admin').query(queryFn('list'), listArgs('workspace-policy') as never) as { page: Array<{ id: string }> }).page)
      .not.toContainEqual(expect.objectContaining({ id: privateAgent.id }))
    await expect(asUser(convex, 'admin').mutation(mutationFn('update'), {
      workspaceId: 'workspace-policy',
      agentId: privateAgent.id,
      expectedRevision: privateAgent.revision,
      patch: { name: 'Cannot edit hidden row' },
    } as never)).rejects.toThrow()

    const workspaceAgent = await creator.mutation(mutationFn('create'), {
      ...createArgs('workspace-policy', '22222222-2222-4222-8222-222222222222', 'Workspace agent'),
    } as never) as { id: string; revision: string }
    await expect(asUser(convex, 'admin').mutation(mutationFn('update'), {
      workspaceId: 'workspace-policy',
      agentId: workspaceAgent.id,
      expectedRevision: workspaceAgent.revision,
      patch: { name: 'Manager edit' },
    } as never)).resolves.toMatchObject({ name: 'Manager edit', canEdit: true })

    await convex.run(async (ctx) => {
      await ctx.db.insert('workspaceSharingPolicies', {
        workspaceId: 'workspace-policy',
        publicLinksEnabled: false,
        memberCanCreateAgents: false,
        createdAt: now,
        updatedAt: now,
      })
    })
    await expect(asUser(convex, 'guest').mutation(mutationFn('create'), {
      ...createArgs('workspace-policy', '33333333-3333-4333-8333-333333333333', 'Guest agent'),
    } as never)).rejects.toThrow('WORKSPACE_AGENT_CREATE_DENIED')
    await expect(asUser(convex, 'blocked').mutation(mutationFn('create'), {
      ...createArgs('workspace-policy', '44444444-4444-4444-8444-444444444444', 'Policy blocked agent'),
    } as never)).rejects.toThrow('WORKSPACE_AGENT_CREATE_DENIED')
  })

  test('rejects invalid direct profile input and malformed idempotency keys', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-validation', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
    ])
    const owner = asUser(convex, 'owner')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-validation', 'not-a-uuid', 'Invalid request'),
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID_REQUEST_ID')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-validation', '88888888-8888-4888-8888-888888888888', 'Invalid color'),
      avatarColor: 'blue',
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-validation', '99999999-9999-4999-8999-999999999999', 'Duplicate tools'),
      allowedToolIds: ['read_file', 'read_file'],
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
  })

  test('saves long legal instructions and detects a later legacy update conflict', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-long-instructions', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
    ])
    const owner = asUser(convex, 'owner')
    const created = await owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-long-instructions', '13131313-1313-4131-8131-131313131313', 'Long instructions'),
    } as never) as { id: string; revision: string }
    const longInstructions = 'Detailed instruction. '.repeat(280)
    const saved = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-long-instructions',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { instructions: longInstructions },
    } as never) as { revision: string; instructions: string }
    expect(saved.instructions).toBe(longInstructions.trim())
    expect(saved.instructions.length).toBeGreaterThan(4096)
    expect(saved.revision).toMatch(/^sha256:[0-9a-f]{64}$/)

    await convex.mutation(legacyMutation('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'workspace-long-instructions',
      agentId: created.id,
      name: 'Updated by legacy writer',
      now: now + 1,
    } as never)
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-long-instructions',
      agentId: created.id,
      expectedRevision: saved.revision,
      patch: { instructions: `${longInstructions}More detail.` },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_REVISION_CONFLICT')
  })

  test('validates effective overlay settings, resets reasoning on model changes, and scopes harness policy to harness writes', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-profile-validation', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
    ])
    await convex.run(async (ctx) => {
      await ctx.db.insert('workspaceSharingPolicies', {
        workspaceId: 'workspace-profile-validation',
        publicLinksEnabled: false,
        memberCanCreateAgents: true,
        allowedAgentHarnesses: ['overlay'],
        createdAt: now,
        updatedAt: now,
      })
    })
    const owner = asUser(convex, 'owner')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-profile-validation', '14141414-1414-4141-8141-141414141414', 'Bad permission'),
      permissionMode: 'danger',
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-profile-validation', '17171717-1717-4171-8171-171717171717', 'Blank permission'),
      permissionMode: '  ',
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-profile-validation', '15151515-1515-4151-8151-151515151515', 'Blank effort'),
      effort: '  ',
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')
    const created = await owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-profile-validation', '16161616-1616-4161-8161-161616161616', 'Validated profile'),
      reasoning: 'high',
    } as never) as { id: string; revision: string }
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-profile-validation',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { permissionMode: 'danger' },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_INVALID')

    const changedModel = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-profile-validation',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { modelId: 'another-model' },
    } as never) as { revision: string; reasoning?: string }
    expect(changedModel.reasoning).toBe('provider-default')

    await convex.run(async (ctx) => {
      const policy = await ctx.db.query('workspaceSharingPolicies')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-profile-validation')).unique()
      if (policy) await ctx.db.patch(policy._id, { allowedAgentHarnesses: ['claude-code'] })
    })
    const metadataUpdate = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-profile-validation',
      agentId: created.id,
      expectedRevision: changedModel.revision,
      patch: { description: 'Existing runtime metadata remains editable' },
    } as never) as { revision: string }
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-profile-validation',
      agentId: created.id,
      expectedRevision: metadataUpdate.revision,
      patch: { harness: 'overlay' },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_HARNESS_DENIED')
  })

  test('detects legacy profile writes, returns safe projections, and converges through archive and restore', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-revision', [
      { userId: 'creator', principalId: 'principal-creator', role: 'member' },
      { userId: 'admin', principalId: 'principal-admin', role: 'admin' },
    ])
    const creator = asUser(convex, 'creator')
    const created = await creator.mutation(mutationFn('create'), {
      ...createArgs('workspace-revision', '55555555-5555-4555-8555-555555555555', 'Revision agent'),
    } as never) as { id: string; revision: string; name: string }
    const detail = await creator.query(queryFn('get'), {
      workspaceId: 'workspace-revision', agentId: created.id,
    } as never) as Record<string, unknown>
    expect(detail).not.toHaveProperty('adapterConfig')

    await convex.mutation(legacyMutation('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'workspace-revision',
      agentId: created.id,
      name: 'Changed through legacy path',
      now: now + 1,
    } as never)
    await expect(creator.mutation(mutationFn('update'), {
      workspaceId: 'workspace-revision',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { description: 'stale write' },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_REVISION_CONFLICT')

    const refreshed = await creator.query(queryFn('get'), {
      workspaceId: 'workspace-revision', agentId: created.id,
    } as never) as { revision: string; name: string }
    expect(refreshed.name).toBe('Changed through legacy path')
    const archived = await convex.mutation(legacyMutation('archiveByServer'), {
      serverSecret: secret,
      workspaceId: 'workspace-revision',
      agentId: created.id,
      now: now + 2,
    } as never)
    expect(archived).toBe(true)
    expect((await creator.query(queryFn('list'), listArgs('workspace-revision') as never) as { page: unknown[] }).page)
      .toHaveLength(0)
    const archivedDetail = await creator.query(queryFn('get'), {
      workspaceId: 'workspace-revision', agentId: created.id, includeArchived: true,
    } as never) as { revision: string }
    const restored = await creator.mutation(mutationFn('restore'), {
      workspaceId: 'workspace-revision',
      agentId: created.id,
      expectedRevision: archivedDetail.revision,
    } as never) as { id: string; archivedAt?: number }
    expect(restored.id).toBe(created.id)
    expect(restored.archivedAt).toBeUndefined()
    expect((await creator.query(queryFn('list'), listArgs('workspace-revision') as never) as { page: Array<{ id: string }> }).page)
      .toContainEqual(expect.objectContaining({ id: created.id }))
  })

  test('bootstraps chiefs idempotently and keeps personal-chief identity owner-only', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-personal', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
      { userId: 'member', principalId: 'principal-member', role: 'member' },
      { userId: 'guest', principalId: 'principal-guest', role: 'guest' },
    ])
    await convex.run(async (ctx) => {
      const workspace = await ctx.db.query('workspaces')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-personal')).unique()
      if (workspace) await ctx.db.patch(workspace._id, { kind: 'personal', personalOwnerUserId: 'owner' })
    })
    const owner = asUser(convex, 'owner')
    const first = await owner.mutation(mutationFn('bootstrapChiefs'), { workspaceId: 'workspace-personal' } as never) as Array<{
      id: string
      agentRole?: string
      chiefScope?: string
      revision: string
      name: string
    }>
    const second = await owner.mutation(mutationFn('bootstrapChiefs'), { workspaceId: 'workspace-personal' } as never) as Array<{ id: string }>
    expect(second.map((agent) => agent.id).sort()).toEqual(first.map((agent) => agent.id).sort())
    const personalChief = first.find((agent) => agent.agentRole === 'personal_chief' && agent.chiefScope === 'personal')
    expect(personalChief).toBeDefined()
    const member = asUser(convex, 'member')
    expect(await member.query(queryFn('get'), {
      workspaceId: 'workspace-personal', agentId: personalChief!.id,
    } as never)).toBeNull()
    expect(await asUser(convex, 'guest').query(queryFn('get'), {
      workspaceId: 'workspace-personal', agentId: personalChief!.id,
    } as never)).toBeNull()
    await expect(member.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: personalChief!.revision,
      patch: { name: 'Non-owner edit' },
    } as never)).rejects.toThrow()

    vi.useFakeTimers()
    vi.setSystemTime(now + 100)
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: personalChief!.revision,
      patch: { visibility: 'workspace' },
    } as never)).rejects.toThrow('CHIEF_BINDING_INVARIANT')
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: personalChief!.revision,
      patch: { harness: 'claude-code' },
    } as never)).rejects.toThrow('CHIEF_BINDING_INVARIANT')
    const saved = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: personalChief!.revision,
      patch: { name: 'Owner chief identity', description: 'Updated shared description', avatarColor: '#234567' },
    } as never) as { name: string; description?: string; revision: string }
    expect(saved.name).toBe('Owner chief identity')
    expect(saved.description).toBe('Updated shared description')
    const identityAfterAppearance = await convex.run(async (ctx) => await ctx.db.query('personalChiefIdentities')
      .withIndex('by_userId', (q) => q.eq('userId', 'owner')).unique())
    expect(identityAfterAppearance?.description).toBe('Updated shared description')
    vi.setSystemTime(now + 200)
    const instructionsOnly = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: saved.revision,
      patch: { instructions: 'Instructions-only change' },
    } as never) as { revision: string }
    const identityAfterInstructions = await convex.run(async (ctx) => await ctx.db.query('personalChiefIdentities')
      .withIndex('by_userId', (q) => q.eq('userId', 'owner')).unique())
    expect(identityAfterInstructions?.updatedAt).toBe(identityAfterAppearance?.updatedAt)
    vi.setSystemTime(now + 300)
    await convex.mutation(legacyMutation('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      description: 'Legacy identity description',
      updatedByPrincipalId: 'principal-owner',
      now: now + 300,
    } as never)
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-personal',
      agentId: personalChief!.id,
      expectedRevision: instructionsOnly.revision,
      patch: { instructions: 'stale after identity propagation' },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_REVISION_CONFLICT')
    await expect(asUser(convex, 'guest').mutation(mutationFn('bootstrapChiefs'), {
      workspaceId: 'workspace-personal',
    } as never)).rejects.toThrow('WORKSPACE_AGENT_EDIT_DENIED')
  })

  test('filters private chief bootstrap rows while exposing workspace chief bindings read-only to viewers', async () => {
    const convex = backend()
    await seedWorkspace(convex, 'workspace-chief-visibility', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
      { userId: 'member', principalId: 'principal-member', role: 'member' },
      { userId: 'guest', principalId: 'principal-guest', role: 'guest' },
    ])
    const member = asUser(convex, 'member')
    const bootstrap = await member.mutation(mutationFn('bootstrapChiefs'), {
      workspaceId: 'workspace-chief-visibility',
    } as never) as Array<{ id: string; agentRole?: string; chiefOwnerUserId?: string; chiefScope?: string; revision: string; canEdit: boolean }>
    const workspaceChief = bootstrap.find((agent) => agent.agentRole === 'workspace_chief')
    expect(workspaceChief?.canEdit).toBe(true)
    await expect(member.mutation(mutationFn('update'), {
      workspaceId: 'workspace-chief-visibility',
      agentId: workspaceChief!.id,
      expectedRevision: workspaceChief!.revision,
      patch: { description: 'Creator may edit workspace chief' },
    } as never)).resolves.toMatchObject({ description: 'Creator may edit workspace chief' })
    const ownerWorkspaceBinding = bootstrap.find((agent) =>
      agent.agentRole === 'personal_chief' && agent.chiefOwnerUserId === 'owner' && agent.chiefScope === 'workspace')
    expect(ownerWorkspaceBinding).toBeDefined()
    expect(ownerWorkspaceBinding?.canEdit).toBe(false)
    const ownerPrivateChiefId = await convex.run(async (ctx) => {
      const row = await ctx.db.query('workspaceAgentDefinitions')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-chief-visibility'))
        .filter((q) => q.and(
          q.eq(q.field('agentRole'), 'personal_chief'),
          q.eq(q.field('chiefOwnerUserId'), 'owner'),
          q.eq(q.field('chiefScope'), 'personal'),
        )).unique()
      return row?.agentId
    })
    expect(ownerPrivateChiefId).toBeDefined()
    await convex.mutation(legacyMutation('updateByServer'), {
      serverSecret: secret,
      workspaceId: 'workspace-chief-visibility',
      agentId: ownerPrivateChiefId,
      instructions: 'Owner private instructions must not leak',
      updatedByPrincipalId: 'principal-owner',
      now: now + 1,
    } as never)
    const refreshedBootstrap = await member.mutation(mutationFn('bootstrapChiefs'), {
      workspaceId: 'workspace-chief-visibility',
    } as never) as Array<{ id: string; agentRole?: string; chiefOwnerUserId?: string; chiefScope?: string; revision: string }>
    expect(refreshedBootstrap.some((agent) => agent.id === ownerPrivateChiefId)).toBe(false)
    expect(JSON.stringify(refreshedBootstrap)).not.toContain('Owner private instructions must not leak')

    const publicBinding = await member.query(queryFn('get'), {
      workspaceId: 'workspace-chief-visibility', agentId: ownerWorkspaceBinding!.id,
    } as never) as { id: string; canEdit: boolean } | null
    expect(publicBinding).toMatchObject({ id: ownerWorkspaceBinding!.id, canEdit: false })
    const memberList = await member.query(queryFn('list'), listArgs('workspace-chief-visibility') as never) as {
      page: Array<{ id: string }>
    }
    expect(memberList.page.some((agent) => agent.id === ownerWorkspaceBinding!.id)).toBe(true)
    const ownerUpdatedBinding = await asUser(convex, 'owner').mutation(mutationFn('update'), {
      workspaceId: 'workspace-chief-visibility',
      agentId: ownerWorkspaceBinding!.id,
      expectedRevision: ownerWorkspaceBinding!.revision,
      patch: { description: 'Owner may edit public binding' },
    } as never) as { revision: string }
    expect(await asUser(convex, 'guest').query(queryFn('get'), {
      workspaceId: 'workspace-chief-visibility', agentId: ownerWorkspaceBinding!.id,
    } as never)).toMatchObject({ id: ownerWorkspaceBinding!.id, canEdit: false })
    await expect(member.mutation(mutationFn('update'), {
      workspaceId: 'workspace-chief-visibility',
      agentId: ownerWorkspaceBinding!.id,
      expectedRevision: ownerUpdatedBinding.revision,
      patch: { name: 'Non-owner workspace identity edit' },
    } as never)).rejects.toThrow('WORKSPACE_AGENT_EDIT_DENIED')

    await convex.run(async (ctx) => {
      const principal = await ctx.db.query('workspacePrincipals')
        .withIndex('by_workspaceId_userId', (q) =>
          q.eq('workspaceId', 'workspace-chief-visibility').eq('userId', 'owner')).unique()
      if (principal) {
        const membership = await ctx.db.query('workspaceMemberships')
          .withIndex('by_workspaceId_principalId', (q) =>
            q.eq('workspaceId', 'workspace-chief-visibility').eq('principalId', principal.principalId)).unique()
        if (membership) await ctx.db.patch(membership._id, { status: 'suspended' })
      }
    })
    expect((await member.query(queryFn('list'), listArgs('workspace-chief-visibility') as never) as { page: Array<{ id: string }> })
      .page.some((agent) => agent.id === ownerWorkspaceBinding!.id)).toBe(false)
    expect(await member.query(queryFn('get'), {
      workspaceId: 'workspace-chief-visibility', agentId: ownerWorkspaceBinding!.id,
    } as never)).toBeNull()
  })

  test('applies the external-agent deployment guard to external runtimes and connected bindings', async () => {
    const convex = backend()
    configureNativePolicyEnvironment()
    await seedWorkspace(convex, 'workspace-external', [
      { userId: 'owner', principalId: 'principal-owner', role: 'owner' },
    ])
    const owner = asUser(convex, 'owner')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', '66666666-6666-4666-8666-666666666666', 'External runtime'),
      harness: 'claude-code',
    } as never)).rejects.toThrow()

    const created = await owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', '77777777-7777-4777-8777-777777777777', 'Bound overlay'),
    } as never) as { id: string; revision: string }
    await convex.run(async (ctx) => {
      await ctx.db.insert('agentBindings', {
        bindingId: `binding-${created.id}`,
        workspaceId: 'workspace-external',
        agentId: created.id,
        environmentId: 'environment',
        protocolAdapter: 'test-adapter',
        adapterConfig: { secret: 'must-not-leak' },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
    })
    const projection = await owner.query(queryFn('get'), {
      workspaceId: 'workspace-external', agentId: created.id,
    } as never) as Record<string, unknown>
    expect(JSON.stringify(projection)).not.toContain('must-not-leak')
    expect(projection).not.toHaveProperty('adapterConfig')
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-external',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { description: 'binding requires rollout' },
    } as never)).rejects.toThrow()

    await publishNativePolicy(convex)
    const external = await owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', '88888888-8888-4888-8888-888888888888', 'External runtime'),
      harness: 'claude-code',
    } as never) as { id: string }
    const updated = await owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-external',
      agentId: created.id,
      expectedRevision: created.revision,
      patch: { description: 'binding allowed by fresh rollout' },
    } as never) as { revision: string }
    expect(updated.revision).not.toBe(created.revision)

    await publishNativePolicy(convex, { connectedAgents: false })
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-external',
      agentId: created.id,
      expectedRevision: updated.revision,
      patch: { description: 'connected feature disabled' },
    } as never)).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', '99999999-9999-4999-8999-999999999999', 'Another external runtime'),
      harness: 'codex',
    } as never)).resolves.toMatchObject({ harness: 'codex' })

    await publishNativePolicy(convex, { externalAgents: false })
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-external',
      agentId: created.id,
      expectedRevision: updated.revision,
      patch: { description: 'external feature disabled' },
    } as never)).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Disabled external runtime'),
      harness: 'claude-code',
    } as never)).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')

    await publishNativePolicy(convex)
    const freshRevision = (await owner.query(queryFn('get'), {
      workspaceId: 'workspace-external', agentId: created.id,
    } as never) as { revision: string }).revision
    vi.setSystemTime(Date.now() + NATIVE_POLICY_LEASE_MS + 1)
    await expect(owner.mutation(mutationFn('update'), {
      workspaceId: 'workspace-external',
      agentId: created.id,
      expectedRevision: freshRevision,
      patch: { description: 'expired policy' },
    } as never)).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
    await expect(owner.mutation(mutationFn('create'), {
      ...createArgs('workspace-external', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Expired external runtime'),
      harness: 'claude-code',
    } as never)).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')

    expect(await owner.query(queryFn('get'), {
      workspaceId: 'workspace-external', agentId: created.id,
    } as never)).toMatchObject({ id: created.id })
    expect(external.id).toBeTruthy()
  })
})
