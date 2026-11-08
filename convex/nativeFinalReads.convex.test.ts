import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const launchEnabled = makeFunctionReference<'query'>('agents/environmentsBrowse:launchEnabled')
const myAccounts = makeFunctionReference<'query'>('providers/agentAccounts:mine')
const roomScope = makeFunctionReference<'query'>('collaboration/rooms:scope')
const backendUrl = 'https://fixture.convex.cloud'

afterEach(() => { vi.unstubAllEnvs() })

async function fixture() {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const ws of ['ws', 'ws-early']) {
      await ctx.db.insert('workspaces', { workspaceId: ws, kind: 'organization', name: ws, slug: ws, status: 'active', createdAt: 1, updatedAt: 1 })
    }
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws-early', principalId: 'p-alice-early', userId: 'alice', type: 'human', displayName: 'alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws-early', principalId: 'p-alice-early', membershipId: 'm-alice-early', role: 'admin', status: 'active', joinedAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws-early', principalId: 'p-bob-early', userId: 'bob', type: 'human', displayName: 'bob', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws-early', principalId: 'p-bob-early', membershipId: 'm-bob-early', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    const room = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title: 'private', conversationType: 'channel', channelVisibility: 'private', scope: 'workspace',
      createdAt: 1, updatedAt: 1, lastModified: 1, lastMode: 'act', askModelIds: [], actModelId: 'm',
    } as never)
    await ctx.db.insert('conversationParticipants', {
      conversationId: room, workspaceId: 'ws', principalId: 'p-alice', principalType: 'human', role: 'member', status: 'active',
      notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
    } as never)
    for (const [userId, label] of [['alice', 'Alice Claude'], ['bob', 'Bob Codex']] as const) {
      await ctx.db.insert('agentProviderAccounts', {
        userId, provider: userId === 'alice' ? 'claude-code' : 'codex', method: 'subscription', label,
        credentialRef: `vault://${userId}`, status: 'active', createdAt: 1, updatedAt: 1,
      })
    }
    return { room }
  })
  return { t, ids, as: (subject: string) => t.withIdentity({ subject }) }
}

async function publishPolicy(t: Awaited<ReturnType<typeof fixture>>['t'], features: Record<string, boolean>) {
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 60_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64), features,
        rollout: { stage: 'invited', internalWorkspaceIds: '', invitedWorkspaceIds: 'ws-early' },
      },
    } as never)
  })
}

test('agent launch follows the deployment features, the workspace rollout and the viewer\'s role', async () => {
  const { t, as } = await fixture()
  // No published policy: fail closed.
  expect(await as('alice').query(launchEnabled, { workspaceId: 'ws-early' })).toBe(false)
  await publishPolicy(t, { externalAgents: true, connectedAgents: true })
  expect(await as('alice').query(launchEnabled, { workspaceId: 'ws-early' })).toBe(true)
  // Not invited in the rollout.
  expect(await as('alice').query(launchEnabled, { workspaceId: 'ws' })).toBe(false)
  // A plain member cannot manage connections, so the option stays hidden for them.
  expect(await as('bob').query(launchEnabled, { workspaceId: 'ws-early' })).toBe(false)
  // Not a member: no answer at all.
  expect(await as('stranger').query(launchEnabled, { workspaceId: 'ws-early' })).toBeNull()
})

test('agent accounts are the viewer\'s own and never carry the credential reference', async () => {
  const { as, t } = await fixture()
  const rows = await as('alice').query(myAccounts, {}) as Array<Record<string, unknown>>
  expect(rows.map(row => row.label)).toEqual(['Alice Claude'])
  expect(JSON.stringify(rows)).not.toContain('vault://')
  expect(await t.query(myAccounts, {})).toBeNull()
})

test('a room\'s scope is visible to its members and to nobody else', async () => {
  const { as, ids } = await fixture()
  expect(await as('alice').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toEqual({ conversationType: 'channel', scope: 'workspace' })
  // Bob is in the workspace but not in the private channel.
  expect(await as('bob').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toBeNull()
  expect(await as('stranger').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toBeNull()
})
