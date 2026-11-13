import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const connect = makeFunctionReference<'mutation'>('sync/links:connect')
const linkChannel = makeFunctionReference<'mutation'>('sync/links:linkChannel')
const channelSources = makeFunctionReference<'query'>('sync/ui:channelSources')
const linkTargets = makeFunctionReference<'query'>('sync/ui:linkTargets')

const serverSecret = 'sync-ui-test-secret'
process.env.INTERNAL_API_SECRET = serverSecret

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['owner', 'owner'], ['alice', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p-' + userId, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p-' + userId, membershipId: 'm-' + userId, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const base = { serverSecret, actorUserId: 'owner', workspaceId: 'ws' }
  await t.mutation(connect, { ...base, provider: 'slack', externalOrgId: 'T1', externalOrgName: 'LayerNorm Slack' })
  const general = await t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
  }) as { conversationId: string }
  const secret = await t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C2', externalChannelName: 'secret', externalChannelKind: 'private',
  }) as { conversationId: string }
  return { t, general, secret }
}

async function addChannel(t: Awaited<ReturnType<typeof fixture>>['t'], slug: string, extra: Record<string, unknown> = {}) {
  return await t.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'ws', conversationType: 'channel', title: slug, channelSlug: slug, channelVisibility: 'public',
      lastModified: 1, createdAt: 1, updatedAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'model', isAutomation: false, ...extra,
    })
    await ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId: 'p-owner', principalType: 'human', role: 'moderator', status: 'active',
      notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
    })
    return conversationId as string
  })
}

test('channel sources list linked channels, hiding private ones from non-members', async () => {
  const { t, general, secret } = await fixture()
  const forOwner = await t.withIdentity({ subject: 'owner' }).query(channelSources, { workspaceId: 'ws' }) as Array<{ conversationId: string; provider: string; importing: boolean }>
  expect(forOwner.map(row => row.conversationId).sort()).toEqual([general.conversationId, secret.conversationId].sort())
  expect(forOwner.every(row => row.provider === 'slack' && row.importing)).toBe(true)
  const forAlice = await t.withIdentity({ subject: 'alice' }).query(channelSources, { workspaceId: 'ws' }) as Array<{ conversationId: string }>
  expect(forAlice.map(row => row.conversationId)).toEqual([general.conversationId])
  expect(await t.withIdentity({ subject: 'stranger' }).query(channelSources, { workspaceId: 'ws' })).toBeNull()
})

test('channel sources stop reporting history once the import completes', async () => {
  const { t, general } = await fixture()
  await t.run(async ctx => {
    const link = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', general.conversationId as never)).unique()
    await ctx.db.patch(link!._id, { status: 'syncing' })
  })
  const rows = await t.withIdentity({ subject: 'owner' }).query(channelSources, { workspaceId: 'ws' }) as Array<{ conversationId: string; importing: boolean }>
  expect(rows.find(row => row.conversationId === general.conversationId)?.importing).toBe(false)
})

test('link targets are the viewer’s native channels that are not linked yet', async () => {
  const { t } = await fixture()
  const design = await addChannel(t, 'design')
  const ops = await addChannel(t, 'ops', { channelVisibility: 'private' })
  await addChannel(t, 'from-slack-surface', { externalPlatform: 'slack' })
  await addChannel(t, 'gone', { deletedAt: 5 })
  const rows = await t.withIdentity({ subject: 'owner' }).query(linkTargets, { workspaceId: 'ws' })
  expect(rows).toEqual([
    { conversationId: design, name: 'design', visibility: 'public' },
    { conversationId: ops, name: 'ops', visibility: 'private' },
  ])
  expect(await t.withIdentity({ subject: 'alice' }).query(linkTargets, { workspaceId: 'ws' })).toEqual([])
})
