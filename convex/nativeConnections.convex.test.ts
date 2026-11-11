import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const backendUrl = 'https://fixture.convex.cloud'
const mcpServers = makeFunctionReference<'query'>('integrations/mcpBrowse:servers')
const mcpConnections = makeFunctionReference<'query'>('integrations/mcpBrowse:connections')

afterEach(() => { vi.unstubAllEnvs() })

/** Two members (alice, bob) and a member without capabilities (carol) in one workspace, with a fresh native policy. */
export async function connectionFixture(options: { features?: Record<string, boolean>; capabilities?: string[] } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64),
        features: options.features ?? { mcpServers: true, modelRouting: true, computers: true, externalAgents: true },
        rollout: { stage: 'general', internalWorkspaceIds: '', invitedWorkspaceIds: '' },
      },
    } as never)
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: options.capabilities ?? ['mcp.use', 'integrations.use'], isSystem: false, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob', 'carol']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      if (userId !== 'carol') await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId, createdAt: 1 })
    }
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }) }
}

test('MCP servers list live without credentials; only editors see the full URL', async () => {
  const { t, as } = await connectionFixture()
  await t.run(async ctx => {
    const server = (fields: Record<string, unknown>) => ctx.db.insert('mcpServers', {
      userId: 'alice', workspaceId: 'ws', transport: 'streamable-http', enabled: true, authType: 'bearer', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await server({ name: 'Private', url: 'https://mcp.example.com/a?key=secret', authConfig: { bearerToken: 'tok' } })
    await server({ name: 'Shared', scope: 'workspace', url: 'https://user:pw@mcp.example.com/b?key=secret', encryptedAuthConfig: 'sealed' })
  })
  const alice = await as('alice').query(mcpServers, { workspaceId: 'ws' }) as Array<Record<string, unknown>>
  expect(alice.map(s => s.name).sort()).toEqual(['Private', 'Shared'])
  for (const row of alice) {
    for (const secret of ['authConfig', 'encryptedAuthConfig', 'encryptedOAuthTokens', 'encryptedOAuthClient']) expect(row[secret]).toBeUndefined()
    expect(row.hasAuth).toBe(true)
  }
  expect(alice.find(s => s.name === 'Shared')).toMatchObject({ canEdit: true, url: 'https://user:pw@mcp.example.com/b?key=secret' })
  const bob = await as('bob').query(mcpServers, { workspaceId: 'ws' }) as Array<Record<string, unknown>>
  expect(bob).toEqual([expect.objectContaining({ name: 'Shared', canEdit: false, url: 'https://mcp.example.com/b' })])
  expect(await as('carol').query(mcpServers, { workspaceId: 'ws' })).toBeNull()
  expect(await as('stranger').query(mcpServers, { workspaceId: 'ws' })).toBeNull()
  const off = await connectionFixture({ features: {} })
  expect(await off.as('alice').query(mcpServers, { workspaceId: 'ws' })).toBeNull()
})

test('connected apps list only the viewer’s active grants', async () => {
  const { t, as } = await connectionFixture()
  await t.run(async ctx => {
    const grant = (fields: Record<string, unknown>) => ctx.db.insert('mcpGrants', {
      userId: 'alice', workspaceId: 'ws', access: 'read', kind: 'oauth', clientName: 'Claude', refreshVersion: 1, createdAt: 1, ...fields,
    } as never)
    await grant({ clientName: 'Active' })
    await grant({ clientName: 'Revoked', revokedAt: 5 })
    await grant({ clientName: 'Expired', expiresAt: 10 })
    await grant({ clientName: 'Bob app', userId: 'bob' })
  })
  const rows = await as('alice').query(mcpConnections, {}) as Array<Record<string, unknown>>
  expect(rows.map(row => row.name)).toEqual(['Active'])
  expect(rows[0]).not.toHaveProperty('refreshVersion')
  expect(await t.query(mcpConnections, {})).toBeNull()
})

test('provider connections list own and workspace-shared subscriptions without vault references', async () => {
  const { t, as } = await connectionFixture()
  const providerConnections = makeFunctionReference<'query'>('providers/browse:connections')
  await t.run(async ctx => {
    const connection = (fields: Record<string, unknown>) => ctx.db.insert('userProviderConnections', {
      userId: 'alice', providerId: 'openai', endpoint: 'https://api.openai.com', displayName: 'x', vaultKeyName: 'vault-key',
      vaultObjectId: 'vault-object', enabledModelIds: [], status: 'active', isDefault: false, isDeletable: true, createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await connection({ displayName: 'Gateway', isDefault: true })
    await connection({ displayName: 'Alice key' })
    await connection({ displayName: 'Team Codex', scope: 'workspace', workspaceId: 'ws', authKind: 'subscription', subscriptionProvider: 'codex' })
    await connection({ displayName: 'Bob key', userId: 'bob' })
  })
  const alice = await as('alice').query(providerConnections, { workspaceId: 'ws' }) as Array<Record<string, unknown>>
  expect(alice.map(row => row.displayName)).toEqual(['Gateway', 'Alice key', 'Team Codex'])
  for (const row of alice) {
    expect(row.vaultKeyName).toBeUndefined()
    expect(row.vaultObjectId).toBeUndefined()
  }
  const bob = await as('bob').query(providerConnections, { workspaceId: 'ws' }) as Array<Record<string, unknown>>
  expect(bob.map(row => [row.displayName, row.canManage])).toEqual([['Bob key', true], ['Team Codex', false]])
  expect(await as('stranger').query(providerConnections, { workspaceId: 'ws' })).toBeNull()
  const off = await connectionFixture({ features: {} })
  expect(await off.as('alice').query(providerConnections, { workspaceId: 'ws' })).toBeNull()
})

test('Computers follow the server visibility rules and never carry provider references', async () => {
  const { t, as } = await connectionFixture()
  const computers = makeFunctionReference<'query'>('computers/browse:list')
  await t.run(async ctx => {
    await ctx.db.patch((await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-carol')).unique())!._id, { role: 'owner' })
    const agent = (agentId: string, visibility: string, creator: string) => ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'ws', principalId: `ap-${agentId}`, name: agentId, instructions: 'x', harness: 'overlay', modelId: 'm',
      allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: creator, visibility, createdAt: 1, updatedAt: 1,
    } as never)
    await agent('shared-agent', 'workspace', 'p-alice')
    await agent('private-agent', 'creator', 'p-alice')
    const computer = (id: string, ownerType: string, ownerId: string) => ctx.db.insert('computers', {
      id, workspaceId: 'ws', ownerType, ownerId, provider: 'box', providerRef: 'secret-ref', size: 'default', status: 'ready', createdBy: 'alice', createdAt: 1, updatedAt: 1,
    } as never)
    await computer('alice-pc', 'user', 'alice')
    await computer('shared-pc', 'agent', 'shared-agent')
    await computer('private-pc', 'agent', 'private-agent')
    await computer('orphan-pc', 'agent', 'deleted-agent')
  })
  const ids = async (subject: string) => ((await as(subject).query(computers, { workspaceId: 'ws' })) as Array<{ id: string; providerRef: unknown }>)
  const alice = await ids('alice')
  expect(alice.map(c => c.id)).toEqual(['alice-pc', 'shared-pc', 'private-pc'])
  expect(alice.every(c => c.providerRef === null)).toBe(true)
  expect((await ids('bob')).map(c => c.id)).toEqual(['shared-pc'])
  expect((await ids('carol')).map(c => c.id)).toEqual(['shared-pc', 'private-pc', 'orphan-pc'])
  expect(await as('stranger').query(computers, { workspaceId: 'ws' })).toBeNull()
})

test('environments never carry public keys, pending ones show their phrase, and bindings are for managers', async () => {
  const { t, as } = await connectionFixture()
  const environments = makeFunctionReference<'query'>('agents/environmentsBrowse:list')
  const bindings = makeFunctionReference<'query'>('agents/environmentsBrowse:bindings')
  await t.run(async ctx => {
    await ctx.db.patch((await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-alice')).unique())!._id, { role: 'admin' })
    await ctx.db.insert('agentEnvironments', { environmentId: 'env-1', workspaceId: 'ws', kind: 'local', name: 'Laptop', status: 'online', publicKey: 'pk', capabilities: {}, lastSeenAt: 5, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('agentEnvironments', { environmentId: 'env-2', workspaceId: 'ws', kind: 'local', name: 'New', status: 'pending', capabilities: {}, createdAt: 2, updatedAt: 2 })
    await ctx.db.insert('agentEnrollmentSessions', { enrollmentSessionId: 'e', workspaceId: 'ws', createdByUserId: 'alice', codeHash: 'hash', verificationPhrase: 'blue fox', status: 'redeemed', environmentId: 'env-2', expiresAt: 9e15, createdAt: 2, updatedAt: 2 })
    await ctx.db.insert('agentBindings', { bindingId: 'b', workspaceId: 'ws', agentId: 'a', environmentId: 'env-1', protocolAdapter: 'acp', adapterConfig: {}, enabled: true, createdAt: 1, updatedAt: 1 })
  })
  const rows = await as('bob').query(environments, { workspaceId: 'ws' }) as Array<Record<string, unknown>>
  expect(rows.map(r => r.id)).toEqual(['env-2', 'env-1'])
  expect(rows.find(r => r.id === 'env-1')).not.toHaveProperty('publicKey')
  expect(rows.find(r => r.id === 'env-2')).toMatchObject({ verificationPhrase: 'blue fox' })
  expect(JSON.stringify(rows)).not.toContain('hash')
  expect(await as('bob').query(bindings, { workspaceId: 'ws' })).toBeNull()
  expect((await as('alice').query(bindings, { workspaceId: 'ws', agentId: 'a' }) as Array<{ id: string }>).map(b => b.id)).toEqual(['b'])
  expect(await as('stranger').query(environments, { workspaceId: 'ws' })).toBeNull()
})

test('workspace Slack lists only Chief channels and the viewer identity, with live management rights', async () => {
  const { t, as } = await connectionFixture()
  const forWorkspace = makeFunctionReference<'query'>('surfaces/browse:forWorkspace')
  await t.run(async ctx => {
    await ctx.db.patch((await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-carol')).unique())!._id, { role: 'guest' })
    const agent = (agentId: string, visibility: string) => ctx.db.insert('workspaceAgentDefinitions', {
      agentId, agentRole: agentId === 'team' ? 'workspace_chief' : 'agent', workspaceId: 'ws', principalId: `ap-${agentId}`, name: agentId, instructions: 'x', harness: 'overlay', modelId: 'm',
      allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', visibility, createdAt: 1, updatedAt: 1,
    } as never)
    await agent('team', 'workspace')
    await agent('mine', 'creator')
    await ctx.db.insert('surfaceConnections', { id: 'conn', workspaceId: 'ws', platform: 'slack', externalTeamId: 'T1', status: 'active', installedByUserId: 'alice', createdAt: 1, updatedAt: 1 } as never)
    await ctx.db.insert('surfaceConnections', { id: 'other', workspaceId: 'elsewhere', platform: 'slack', externalTeamId: 'T2', status: 'active', installedByUserId: 'x', createdAt: 1, updatedAt: 1 } as never)
    await ctx.db.insert('surfaceBindings', { id: 'b1', connectionId: 'conn', agentId: 'team', channelId: 'C1', status: 'active', createdByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceBindings', { id: 'b2', connectionId: 'other', agentId: 'team', channelId: 'C2', status: 'active', createdByUserId: 'x', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceBindings', { id: 'legacy-specialist', connectionId: 'conn', agentId: 'mine', channelId: 'C3', status: 'active', createdByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceBindings', { id: 'removed', connectionId: 'conn', agentId: 'team', channelId: 'C4', status: 'removed', createdByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    for (const link of [
      { id: 'bob-link', userId: 'bob', slackUserId: 'U_BOB', displayName: 'bob', workspaceId: 'ws', connectionId: 'conn', status: 'active' as const },
      { id: 'alice-link', userId: 'alice', slackUserId: 'U_ALICE', workspaceId: 'ws', connectionId: 'conn', status: 'active' as const },
      { id: 'revoked-link', userId: 'bob', slackUserId: 'U_OLD', workspaceId: 'ws', connectionId: 'conn', status: 'revoked' as const },
      { id: 'elsewhere-link', userId: 'bob', slackUserId: 'U_OTHER', workspaceId: 'elsewhere', connectionId: 'other', status: 'active' as const },
    ]) await ctx.db.insert('slackIdentityLinks', { ...link, teamId: 'T1', createdAt: 1, updatedAt: 1 })
  })
  const bob = await as('bob').query(forWorkspace, { workspaceId: 'ws' }) as { connections: Array<{ id: string }>; bindings: Array<{ id: string }>; canManage: boolean; identityLinks: unknown[] }
  expect(bob.connections.map(c => c.id)).toEqual(['conn'])
  expect(bob.bindings.map(b => b.id)).toEqual(['b1'])
  expect(bob.canManage).toBe(false)
  expect(bob.identityLinks).toEqual([{ id: 'bob-link', connectionId: 'conn', slackUserId: 'U_BOB', displayName: 'bob' }])
  expect((await as('carol').query(forWorkspace, { workspaceId: 'ws' }) as { canManage: boolean }).canManage).toBe(false)
  expect(await as('stranger').query(forWorkspace, { workspaceId: 'ws' })).toBeNull()
  await t.run(async ctx => {
    const chief = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', 'team')).unique()
    await ctx.db.patch(chief!._id, { archivedAt: 2 })
  })
  expect((await as('bob').query(forWorkspace, { workspaceId: 'ws' }) as { bindings: unknown[] }).bindings).toEqual([])
})
