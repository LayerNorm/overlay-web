import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
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


test('a room\'s scope is visible to its members and to nobody else', async () => {
  const { as, ids } = await fixture()
  expect(await as('alice').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toEqual({ conversationType: 'channel', scope: 'workspace' })
  // Bob is in the workspace but not in the private channel.
  expect(await as('bob').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toBeNull()
  expect(await as('stranger').query(roomScope, { workspaceId: 'ws', conversationId: ids.room })).toBeNull()
})
