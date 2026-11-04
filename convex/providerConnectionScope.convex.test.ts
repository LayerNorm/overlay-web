import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'provider-connection-scope-test-secret'
const create = makeFunctionReference<'mutation'>('providers/connections:createByServer')
const listForUse = makeFunctionReference<'query'>('providers/connections:listPublicForUseByServer')
const getForUse = makeFunctionReference<'query'>('providers/connections:getForUseByServer')
const getByServer = makeFunctionReference<'query'>('providers/connections:getByServer')
const getForDispatchOwner = makeFunctionReference<'query'>('providers/subscriptions:getForDispatchByServer')
const getForDispatch = makeFunctionReference<'query'>('providers/subscriptions:getForDispatchForActorByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function addMember(
  convex: ReturnType<typeof convexTest>,
  workspaceId: string,
  userId: string,
  suffix: string,
) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: `principal-${suffix}`,
      workspaceId,
      type: 'human',
      userId,
      displayName: userId,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `membership-${suffix}`,
      workspaceId,
      principalId: `principal-${suffix}`,
      role: 'member',
      status: 'active',
      joinedAt: 1,
      updatedAt: 1,
    })
  })
}

async function addWorkspace(convex: ReturnType<typeof convexTest>, workspaceId: string, status = 'active') {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId,
      kind: 'organization',
      name: workspaceId,
      slug: workspaceId,
      status: status as 'active' | 'archived',
      createdAt: 1,
      updatedAt: 1,
    })
  })
}

function subscriptionConnection(userId: string, options: {
  scope?: 'personal' | 'workspace'
  workspaceId?: string
  vaultObjectId?: string
} = {}) {
  return {
    serverSecret: secret,
    userId,
    providerId: 'subscription:codex',
    authKind: 'subscription' as const,
    subscriptionProvider: 'codex' as const,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    endpoint: '',
    displayName: 'Codex subscription',
    vaultKeyName: 'private-vault-name',
    ...(options.vaultObjectId ? { vaultObjectId: options.vaultObjectId } : {}),
    enabledModelIds: ['codex-model'],
    isDefault: false,
    isDeletable: true,
  }
}

test('legacy subscription rows remain personal and public listings omit Vault references', async () => {
  const convex = convexTest(schema, modules)
  const connectionId = await convex.mutation(create, subscriptionConnection('owner'))
  await convex.run(async (ctx) => {
    await ctx.db.patch(connectionId, {
      scope: undefined,
      workspaceId: undefined,
      status: 'active',
      discoveredModelsJson: JSON.stringify({ data: [{ id: 'codex-model', name: 'Codex' }] }),
    })
    await ctx.db.insert('providerSubscriptionStates', {
      userId: 'owner',
      connectionId,
      providerId: 'codex',
      generation: 3,
      revision: 7,
      phase: 'active',
      credentialRef: 'vault-reference',
      cleanupRefs: [],
      cleanupStatus: 'clean',
      createdAt: 1,
      updatedAt: 1,
    })
  })
  const storedRow = await convex.run((ctx) => ctx.db.get(connectionId))
  expect(storedRow?.scope).toBeUndefined()

  const ownerRows = await convex.query(listForUse, {
    serverSecret: secret,
    actorUserId: 'owner',
    workspaceId: 'missing-workspace',
  })
  expect(ownerRows).toHaveLength(1)
  expect(ownerRows[0]).toMatchObject({ _id: connectionId, scope: 'personal', canManage: true })
  expect(ownerRows[0]).not.toHaveProperty('vaultKeyName')
  expect(ownerRows[0]).not.toHaveProperty('vaultObjectId')
  expect(await convex.query(listForUse, {
    serverSecret: secret,
    actorUserId: 'viewer',
  })).toEqual([])

  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'owner',
  })).toMatchObject({ userId: 'owner', scope: 'personal' })
  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'viewer',
  })).toBeNull()
  expect(await convex.query(getByServer, { serverSecret: secret, connectionId })).toMatchObject({
    userId: 'owner',
    scope: 'personal',
  })
  expect(await convex.query(getForDispatchOwner, {
    serverSecret: secret,
    userId: 'owner',
    connectionId,
    modelId: 'codex-model',
  })).toEqual({
    providerId: 'codex',
    credentialRef: 'vault-reference',
    generation: 3,
  })
  expect(await convex.query(getForDispatchOwner, {
    serverSecret: secret,
    userId: 'viewer',
    connectionId,
    modelId: 'codex-model',
  })).toBeNull()
})

test('workspace subscriptions are shared only with active members of the exact active workspace', async () => {
  const convex = convexTest(schema, modules)
  await addWorkspace(convex, 'workspace-one')
  await addWorkspace(convex, 'workspace-two')
  await addMember(convex, 'workspace-one', 'owner', 'owner')
  await addMember(convex, 'workspace-one', 'member', 'member')
  await addMember(convex, 'workspace-two', 'other-member', 'other-member')

  const connectionId = await convex.mutation(create, subscriptionConnection('owner', {
    scope: 'workspace',
    workspaceId: 'workspace-one',
  }))
  await convex.run(async (ctx) => {
    const connection = await ctx.db.get(connectionId)
    if (!connection) throw new Error('fixture connection missing')
    await ctx.db.patch(connectionId, {
      status: 'active',
      vaultObjectId: 'vault-reference',
      discoveredModelsJson: JSON.stringify({ data: [{ id: 'codex-model', name: 'Codex' }] }),
    })
    await ctx.db.insert('providerSubscriptionStates', {
      userId: 'owner',
      connectionId,
      providerId: 'codex',
      generation: 3,
      revision: 7,
      phase: 'active',
      credentialRef: 'vault-reference',
      cleanupRefs: [],
      cleanupStatus: 'clean',
      createdAt: 1,
      updatedAt: 1,
    })
  })

  const memberRows = await convex.query(listForUse, {
    serverSecret: secret,
    actorUserId: 'member',
    workspaceId: 'workspace-one',
  })
  expect(memberRows).toMatchObject([{
    _id: connectionId,
    scope: 'workspace',
    workspaceId: 'workspace-one',
    canManage: false,
  }])
  expect(memberRows[0]).not.toHaveProperty('vaultObjectId')
  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'member',
    workspaceId: 'workspace-one',
  })).toMatchObject({ userId: 'owner', vaultObjectId: 'vault-reference' })
  expect(await convex.query(getByServer, {
    serverSecret: secret,
    connectionId,
  })).toMatchObject({ userId: 'owner' })

  const dispatchArgs = {
    serverSecret: secret,
    connectionId,
    modelId: 'codex-model',
  }
  expect(await convex.query(getForDispatch, {
    ...dispatchArgs,
    actorUserId: 'member',
    workspaceId: 'workspace-one',
  })).toMatchObject({
    ownerUserId: 'owner',
    providerId: 'codex',
    credentialRef: 'vault-reference',
    generation: 3,
    revision: 7,
  })
  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'other-member',
    workspaceId: 'workspace-two',
  })).toBeNull()
  expect(await convex.query(getForDispatch, {
    ...dispatchArgs,
    actorUserId: 'other-member',
    workspaceId: 'workspace-two',
  })).toBeNull()
  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'outsider',
    workspaceId: 'workspace-one',
  })).toBeNull()

  await convex.run(async (ctx) => {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', 'workspace-one').eq('userId', 'member'))
      .unique()
    if (!principal) throw new Error('fixture principal missing')
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) =>
        q.eq('workspaceId', 'workspace-one').eq('principalId', principal.principalId),
      )
      .unique()
    if (!membership) throw new Error('fixture membership missing')
    await ctx.db.patch(membership._id, { status: 'suspended' })
  })
  expect(await convex.query(getForDispatch, {
    ...dispatchArgs,
    actorUserId: 'member',
    workspaceId: 'workspace-one',
  })).toBeNull()
  expect(await convex.query(listForUse, {
    serverSecret: secret,
    actorUserId: 'member',
    workspaceId: 'workspace-one',
  })).toEqual([])

  await convex.run(async (ctx) => {
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'workspace-one'))
      .unique()
    if (!workspace) throw new Error('fixture workspace missing')
    await ctx.db.patch(workspace._id, { status: 'archived' })
  })
  expect(await convex.query(getForUse, {
    serverSecret: secret,
    connectionId,
    actorUserId: 'owner',
    workspaceId: 'workspace-one',
  })).toBeNull()
})

test('workspace scope cannot be applied to API-key connections', async () => {
  const convex = convexTest(schema, modules)
  await addWorkspace(convex, 'workspace-one')
  await addMember(convex, 'workspace-one', 'owner', 'owner')
  await expect(convex.mutation(create, {
    serverSecret: secret,
    userId: 'owner',
    providerId: 'openai',
    scope: 'workspace',
    workspaceId: 'workspace-one',
    endpoint: 'https://api.openai.com/v1',
    displayName: 'OpenAI',
    vaultKeyName: 'openai',
    enabledModelIds: [],
    isDefault: false,
    isDeletable: true,
  })).rejects.toThrow(/Workspace scope is only supported/)
})
