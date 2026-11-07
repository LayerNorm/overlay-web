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
