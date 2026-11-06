import { afterEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { NATIVE_POLICY_LEASE_MS } from '@/shared/authorization/native-deployment-policy'

const modules = import.meta.glob('./**/*.ts')
const secret = 'mcp-native-contract-secret'
const workspaceId = 'mcp-native-ws'
const now = 1_900_000_000_000
const backendUrl = 'https://fixture.convex.cloud'
const policyChallenge = '00000000-0000-4000-8000-000000000001'
const policySnapshot = {
  version: 1 as const,
  backendUrl,
  revision: 'a'.repeat(64),
  features: {
    files: true,
    skills: true,
    mcpServers: true,
    externalAgents: true,
    connectedAgents: true,
    workspaceHandles: false,
  },
  rollout: { stage: 'invited' as const, internalWorkspaceIds: 'internal', invitedWorkspaceIds: 'invited' },
}
const beginPolicy = makeFunctionReference<'mutation'>('platform/nativePolicy:beginRefresh')
const publishPolicy = makeFunctionReference<'mutation'>('platform/nativePolicy:publish')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

const query = (name: string) => makeFunctionReference<'query'>(name)
const mutation = (name: string) => makeFunctionReference<'mutation'>(name)

type Convex = ReturnType<typeof convexTest>

async function publishMcpPolicy(convex: Convex, enabled: boolean, challenge = policyChallenge) {
  const { sequence } = await convex.mutation(beginPolicy, { challenge })
  return convex.mutation(publishPolicy, {
    sequence,
    challenge,
    issuedAt: now,
    snapshot: {
      ...policySnapshot,
      features: { ...policySnapshot.features, mcpServers: enabled },
    },
  })
}

async function makeConvex({ publishPolicyOnCreate = true }: { publishPolicyOnCreate?: boolean } = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const convex = convexTest(schema, modules)
  if (publishPolicyOnCreate) await publishMcpPolicy(convex, true)
  return convex
}

async function seedWorkspace(convex: Convex) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId, kind: 'organization', name: 'MCP QA', slug: 'mcp-qa',
      status: 'active', createdAt: now, updatedAt: now,
    })
    for (const [userId, role] of [
      ['alice', 'member'], ['bob', 'member'], ['admin', 'admin'], ['guest', 'guest'],
    ] as const) {
      const roleId = `mcp-${userId}`
      await ctx.db.insert('authorizationRoles', {
        roleId, name: roleId, capabilities: ['mcp.use'], isSystem: false, createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId, createdAt: now })
      await ctx.db.insert('workspacePrincipals', {
        principalId: `p-${userId}`, workspaceId, type: 'human', userId,
        displayName: userId, createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`,
        role, status: 'active', joinedAt: now, updatedAt: now,
      })
    }
    await ctx.db.insert('workspaceSharingPolicies', {
      workspaceId, workspaceExtensionsEditors: 'admins', publicLinksEnabled: false, createdAt: now, updatedAt: now,
    })
  })
}

async function removeMcpCapability(convex: Convex, userId: string) {
  await convex.run(async (ctx) => {
    const role = await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', q => q.eq('roleId', `mcp-${userId}`))
      .unique()
    if (!role) throw new Error('MCP test role missing')
    await ctx.db.patch(role._id, { capabilities: [] })
  })
}

async function insertServer(convex: Convex, overrides: Record<string, unknown> = {}) {
  return convex.run((ctx) => ctx.db.insert('mcpServers', {
    userId: 'alice',
    workspaceId,
    scope: 'workspace',
    name: 'Shared server',
    transport: 'streamable-http',
    url: 'https://user:pass@safe.example.test/secret-path?token=query-secret#fragment-secret',
    enabled: true,
    authType: 'bearer',
    authConfig: { bearerToken: 'bearer-secret' },
    encryptedAuthConfig: 'encrypted-auth-secret',
    encryptedOAuthTokens: 'encrypted-token-secret',
    encryptedOAuthClient: 'encrypted-client-secret',
    oauthClientId: 'oauth-client-id-secret',
    oauthIssuer: 'oauth-issuer-secret',
    oauthScope: 'oauth-scope-secret',
    oauthResource: 'oauth-resource-secret',
    oauthError: 'raw-provider-error-secret',
    toolCatalog: [{ name: 'secret-tool', inputSchema: { secretSchema: 'raw-schema-secret' } }],
    toolCatalogError: 'raw catalog error secret',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as never))
}

describe('native MCP server settings', () => {
  test('derives identity from Convex auth, requires membership and capability, and rejects caller identity fields', async () => {
    const convex = await makeConvex({ publishPolicyOnCreate: false })
    await seedWorkspace(convex)
    const list = query('integrations/nativeMcpServers:list')
    const args = { workspaceId, paginationOpts: { numItems: 10, cursor: null } }

    await expect(convex.query(list, args)).rejects.toThrow(/UNAUTHENTICATED/)
    await expect(convex.withIdentity({ subject: 'outsider' }).query(list, args)).rejects.toThrow(/WORKSPACE_ACCESS_DENIED/)
    const alice = convex.withIdentity({ subject: 'alice' })
    await expect(alice.query(list, args)).rejects.toThrow(/DEPLOYMENT_FEATURE_ACCESS_DENIED/)
    await publishMcpPolicy(convex, true)
    await expect(alice.query(list, { ...args, userId: 'admin' })).rejects.toThrow()

    await convex.run(async (ctx) => {
      const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', 'mcp-alice')).unique()
      if (!role) throw new Error('MCP test role missing')
      await ctx.db.patch(role._id, { capabilities: [] })
    })
    await expect(alice.query(list, args)).rejects.toThrow(/CAPABILITY_ACCESS_DENIED/)
  })

  test('native MCP calls fail closed for disabled and expired deployment policy', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const alice = convex.withIdentity({ subject: 'alice' })
    const list = query('integrations/nativeMcpServers:list')
    const args = { workspaceId, paginationOpts: { numItems: 10, cursor: null } }

    await publishMcpPolicy(convex, false, '00000000-0000-4000-8000-000000000002')
    await expect(alice.query(list, args)).rejects.toThrow(/DEPLOYMENT_FEATURE_ACCESS_DENIED/)
    await publishMcpPolicy(convex, true, '00000000-0000-4000-8000-000000000003')
    vi.setSystemTime(Date.now() + NATIVE_POLICY_LEASE_MS + 1)
    await expect(alice.query(list, args)).rejects.toThrow(/DEPLOYMENT_FEATURE_ACCESS_DENIED/)
  })

  test('redacts endpoint components and all credential, OAuth, catalog-schema and external-error fields', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const id = await insertServer(convex)
    const alice = convex.withIdentity({ subject: 'alice' })
    const result = await alice.query(query('integrations/nativeMcpServers:get'), {
      workspaceId, mcpServerId: id,
    }) as Record<string, unknown>

    expect(result).toMatchObject({
      url: 'https://safe.example.test',
      endpointRedacted: true,
      hasAuth: true,
      toolCatalogError: 'Tool discovery failed.',
      oauthError: 'Authorization failed. Reconnect to try again.',
    })
    const serialized = JSON.stringify(result)
    for (const value of [
      'user:pass', 'secret-path', 'query-secret', 'fragment-secret', 'bearer-secret',
      'encrypted-auth-secret', 'encrypted-token-secret', 'encrypted-client-secret',
      'oauth-client-id-secret', 'oauth-issuer-secret', 'oauth-scope-secret',
      'oauth-resource-secret', 'raw-provider-error-secret', 'raw catalog error secret',
      'raw-schema-secret',
    ]) expect(serialized).not.toContain(value)
    expect(result).not.toHaveProperty('authConfig')
    expect(result).not.toHaveProperty('encryptedOAuthTokens')
    expect(result).not.toHaveProperty('oauthClientId')
    expect(result).not.toHaveProperty('toolCatalog')
  })

  test('members can read shared summaries, guests cannot, and only owners or workspace admins edit metadata', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const id = await insertServer(convex)
    const list = query('integrations/nativeMcpServers:list')
    const pageArgs = { workspaceId, view: 'workspace', paginationOpts: { numItems: 10, cursor: null } }
    const member = convex.withIdentity({ subject: 'bob' })
    expect((await member.query(list, pageArgs)).page).toHaveLength(1)
    expect(await convex.withIdentity({ subject: 'guest' }).query(
      query('integrations/nativeMcpServers:get'), { workspaceId, mcpServerId: id },
    )).toBeNull()

    const update = mutation('integrations/nativeMcpServers:updateMetadata')
    const updateArgs = { workspaceId, mcpServerId: id, expectedUpdatedAt: now, name: 'Changed' }
    await expect(member.mutation(update, updateArgs)).rejects.toThrow(/MCP_ACCESS_DENIED/)
    await convex.withIdentity({ subject: 'admin' }).mutation(update, updateArgs)
    const updated = await convex.withIdentity({ subject: 'bob' }).query(
      query('integrations/nativeMcpServers:get'), { workspaceId, mcpServerId: id },
    )
    expect(updated).toMatchObject({ name: 'Changed' })
  })

  test('metadata writes use compare-and-set and monotonically advance the revision', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const id = await insertServer(convex, { scope: 'personal' })
    const alice = convex.withIdentity({ subject: 'alice' })
    const update = mutation('integrations/nativeMcpServers:updateMetadata')

    await alice.mutation(update, { workspaceId, mcpServerId: id, expectedUpdatedAt: now, enabled: false })
    const fresh = await alice.query(query('integrations/nativeMcpServers:get'), { workspaceId, mcpServerId: id }) as { updatedAt: number }
    expect(fresh.updatedAt).toBeGreaterThan(now)
    await expect(alice.mutation(update, {
      workspaceId, mcpServerId: id, expectedUpdatedAt: now, name: 'Stale overwrite',
    })).rejects.toThrow(/MCP_REVISION_CONFLICT/)
    const after = await alice.query(query('integrations/nativeMcpServers:get'), { workspaceId, mcpServerId: id }) as { updatedAt: number; name: string }
    expect(after).toMatchObject({ updatedAt: fresh.updatedAt, name: 'Shared server' })
  })

  test('OAuth and tool-catalog writes advance metadata revisions and reject stale native and BFF writes', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const id = await insertServer(convex)
    const oauth = mutation('integrations/mcpServers:updateOAuthState')
    const catalog = mutation('integrations/mcpServers:updateToolCatalog')
    const nativeUpdate = mutation('integrations/nativeMcpServers:updateMetadata')
    const bffUpdate = mutation('integrations/mcpServers:update')

    await convex.mutation(oauth, {
      mcpServerId: id, userId: 'alice', serverSecret: secret,
      encryptedOAuthTokens: 'encrypted-token', oauthStatus: 'connected',
    })
    const afterOAuth = await convex.run((ctx) => ctx.db.get(id))
    expect(afterOAuth?.updatedAt).toBe(now + 1)
    expect(afterOAuth?.oauthConnectedAt).toBe(now)
    await expect(convex.withIdentity({ subject: 'admin' }).mutation(nativeUpdate, {
      workspaceId, mcpServerId: id, expectedUpdatedAt: now, name: 'Stale native edit',
    })).rejects.toThrow(/MCP_REVISION_CONFLICT/)
    await expect(convex.mutation(bffUpdate, {
      mcpServerId: id, userId: 'admin', workspaceId, serverSecret: secret,
      expectedUpdatedAt: now, name: 'Stale BFF edit',
    })).rejects.toThrow(/MCP_REVISION_CONFLICT/)

    await convex.mutation(catalog, {
      mcpServerId: id, userId: 'alice', serverSecret: secret,
      tools: [{ name: 'fresh_tool' }],
    })
    const afterCatalog = await convex.run((ctx) => ctx.db.get(id))
    expect(afterCatalog?.updatedAt).toBe(now + 2)
    expect(afterCatalog?.toolCatalogUpdatedAt).toBe(now)
    await expect(convex.withIdentity({ subject: 'admin' }).mutation(nativeUpdate, {
      workspaceId, mcpServerId: id, expectedUpdatedAt: now + 1, name: 'Stale native edit',
    })).rejects.toThrow(/MCP_REVISION_CONFLICT/)
    await expect(convex.mutation(bffUpdate, {
      mcpServerId: id, userId: 'admin', workspaceId, serverSecret: secret,
      expectedUpdatedAt: now + 1, name: 'Stale BFF edit',
    })).rejects.toThrow(/MCP_REVISION_CONFLICT/)
  })

  test('OAuth and tool-catalog revisions stay monotonic when the stored revision is ahead of wall time', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const ahead = now + 60_000
    const id = await insertServer(convex, { updatedAt: ahead })

    await convex.mutation(mutation('integrations/mcpServers:updateOAuthState'), {
      mcpServerId: id, userId: 'alice', serverSecret: secret,
      encryptedOAuthTokens: 'encrypted-token', oauthStatus: 'connected',
    })
    const afterOAuth = await convex.run((ctx) => ctx.db.get(id))
    expect(afterOAuth?.updatedAt).toBe(ahead + 1)
    expect(afterOAuth?.oauthConnectedAt).toBe(now)

    await convex.mutation(mutation('integrations/mcpServers:updateToolCatalog'), {
      mcpServerId: id, userId: 'alice', serverSecret: secret,
      tools: [{ name: 'fresh_tool' }],
    })
    const afterCatalog = await convex.run((ctx) => ctx.db.get(id))
    expect(afterCatalog?.updatedAt).toBe(ahead + 2)
    expect(afterCatalog?.toolCatalogUpdatedAt).toBe(now)
  })

  test('generic MCP scope writes advance the metadata revision', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const id = await insertServer(convex, { scope: 'personal' })

    const result = await convex.mutation(mutation('integrations/mcpServers:archive'), {
      id, userId: 'alice', workspaceId, serverSecret: secret,
    })
    expect(result).toEqual({ ok: true })
    const archived = await convex.run((ctx) => ctx.db.get(id))
    expect(archived?.updatedAt).toBe(now + 1)
    await expect(convex.withIdentity({ subject: 'alice' }).mutation(
      mutation('integrations/nativeMcpServers:updateMetadata'),
      { workspaceId, mcpServerId: id, expectedUpdatedAt: now, name: 'Stale edit' },
    )).rejects.toThrow(/MCP_REVISION_CONFLICT/)
  })
})

describe('native MCP grants', () => {
  test('lists only active, unrevoked grants with the safe connection projection', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    await convex.run(async (ctx) => {
      await ctx.db.insert('workspaces', {
        workspaceId: 'suspended-ws', kind: 'organization', name: 'Suspended', slug: 'suspended',
        status: 'active', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspacePrincipals', {
        principalId: 'p-alice-suspended', workspaceId: 'suspended-ws', type: 'human', userId: 'alice',
        displayName: 'Alice', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: 'm-alice-suspended', workspaceId: 'suspended-ws', principalId: 'p-alice-suspended',
        role: 'member', status: 'suspended', joinedAt: now, updatedAt: now,
      })
      const insert = (workspace: string, clientName: string, revokedAt?: number) => ctx.db.insert('mcpGrants', {
        userId: 'alice', workspaceId: workspace, access: 'write', kind: 'oauth', clientName,
        clientId: 'client-secret', codeId: 'authorization-code-secret', refreshVersion: 7,
        createdAt: now, ...(revokedAt !== undefined ? { revokedAt } : {}),
      })
      await insert(workspaceId, 'Active app')
      await insert(workspaceId, 'Revoked app', now + 1)
      await insert('suspended-ws', 'Suspended app')
    })
    await removeMcpCapability(convex, 'alice')
    const result = await convex.withIdentity({ subject: 'alice' }).query(
      query('mcp/grants:listNative'), { paginationOpts: { numItems: 10, cursor: null } },
    )
    expect(result.page).toHaveLength(1)
    expect(result.page[0]).toMatchObject({
      name: 'Active app', kind: 'oauth', access: 'write', workspaceId,
      createdAt: now, lastUsedAt: null, expiresAt: null,
    })
    expect(JSON.stringify(result)).not.toContain('client-secret')
    expect(JSON.stringify(result)).not.toContain('authorization-code-secret')
    expect(result.page[0]).not.toHaveProperty('userId')
    expect(result.page[0]).not.toHaveProperty('clientId')
    expect(result.page[0]).not.toHaveProperty('refreshVersion')
  })

  test('revoke is identity-bound, active-workspace checked, audited, and idempotent', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    await removeMcpCapability(convex, 'alice')
    const grantId = await convex.run((ctx) => ctx.db.insert('mcpGrants', {
      userId: 'alice', workspaceId, access: 'read', kind: 'token', clientName: 'Local agent',
      refreshVersion: 0, createdAt: now,
    }))
    const suspendedGrantId = await convex.run(async (ctx) => {
      await ctx.db.insert('workspaces', {
        workspaceId: 'revoke-suspended-ws', kind: 'organization', name: 'Suspended', slug: 'revoke-suspended',
        status: 'active', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspacePrincipals', {
        principalId: 'p-alice-revoke-suspended', workspaceId: 'revoke-suspended-ws', type: 'human',
        userId: 'alice', displayName: 'Alice', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: 'm-alice-revoke-suspended', workspaceId: 'revoke-suspended-ws',
        principalId: 'p-alice-revoke-suspended', role: 'member', status: 'suspended',
        joinedAt: now, updatedAt: now,
      })
      return ctx.db.insert('mcpGrants', {
        userId: 'alice', workspaceId: 'revoke-suspended-ws', access: 'read', kind: 'token',
        clientName: 'Suspended workspace app', refreshVersion: 0, createdAt: now,
      })
    })
    const alice = convex.withIdentity({ subject: 'alice' })
    const revoke = mutation('mcp/grants:revokeNative')
    await expect(alice.mutation(revoke, { grantId, userId: 'bob' })).rejects.toThrow()
    await expect(convex.withIdentity({ subject: 'bob' }).mutation(revoke, { grantId })).rejects.toThrow(/MCP_GRANT_ACCESS_DENIED/)
    await expect(alice.mutation(revoke, { grantId: suspendedGrantId })).rejects.toThrow(/WORKSPACE_ACCESS_DENIED/)
    await alice.mutation(revoke, { grantId })
    await alice.mutation(revoke, { grantId })
    const row = await convex.run((ctx) => ctx.db.get(grantId))
    expect(row?.revokedAt).toBeDefined()
    expect((await alice.query(query('mcp/grants:listNative'), {
      paginationOpts: { numItems: 10, cursor: null },
    })).page).toEqual([])
    const audits = await convex.run((ctx) => ctx.db.query('auditEvents').collect())
    expect(audits.filter((event) => event.action === 'mcp.grant.revoked')).toHaveLength(1)
    expect((await convex.run((ctx) => ctx.db.get(suspendedGrantId)))?.revokedAt).toBeUndefined()
  })
})

describe('server-only MCP command lifecycle', () => {
  test('requires the server secret, owned server and active human workspace membership; finish matches the pending command', async () => {
    const convex = await makeConvex()
    await seedWorkspace(convex)
    const mcpServerId = await insertServer(convex, { scope: 'personal' })
    const begin = mutation('integrations/mcpCommands:begin')
    const finish = mutation('integrations/mcpCommands:finish')
    const commandArgs = { serverSecret: secret, userId: 'alice', workspaceId, mcpServerId }
    const args = { ...commandArgs, commandId: 'command-1', kind: 'test' as const }
    await expect(convex.mutation(begin, { ...args, serverSecret: 'wrong' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(begin, { ...args, userId: 'bob' })).rejects.toThrow(/MCP_SERVER_ACCESS_DENIED/)
    await expect(convex.mutation(begin, { ...args, workspaceId: 'other-ws' })).rejects.toThrow(/MCP_SERVER_ACCESS_DENIED/)
    expect(await convex.mutation(begin, args)).toBe(args.commandId)
    await expect(convex.mutation(begin, { ...args, commandId: 'command-2' })).rejects.toThrow(/MCP_COMMAND_IN_PROGRESS/)
    await expect(convex.mutation(finish, { ...commandArgs, commandId: 'stale', status: 'succeeded' })).rejects.toThrow(/MCP_COMMAND_STALE/)
    await convex.mutation(finish, { ...commandArgs, commandId: args.commandId, status: 'failed' })
    const failed = await convex.run((ctx) => ctx.db.get(mcpServerId))
    expect(failed?.commandState).toMatchObject({ id: 'command-1', status: 'failed' })

    expect(await convex.mutation(begin, { ...commandArgs, commandId: 'command-3', kind: 'connect' })).toBe('command-3')
    await convex.mutation(finish, { ...commandArgs, commandId: 'command-3', status: 'succeeded', toolCount: 2 })
    const succeeded = await convex.run((ctx) => ctx.db.get(mcpServerId))
    expect(succeeded?.commandState).toMatchObject({ id: 'command-3', kind: 'connect', status: 'succeeded', toolCount: 2 })
    await convex.run(async (ctx) => {
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', 'p-alice'))
        .unique()
      if (!membership) throw new Error('MCP test membership missing')
      await ctx.db.patch(membership._id, { status: 'suspended' })
    })
    await expect(convex.mutation(begin, {
      ...commandArgs, commandId: 'command-4', kind: 'test',
    })).rejects.toThrow(/WORKSPACE_ACCESS_DENIED/)
  })
})
