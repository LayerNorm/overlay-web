import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const connect = makeFunctionReference<'mutation'>('sync/links:connect')
const disconnect = makeFunctionReference<'mutation'>('sync/links:disconnect')
const linkChannel = makeFunctionReference<'mutation'>('sync/links:linkChannel')
const unlinkChannel = makeFunctionReference<'mutation'>('sync/links:unlinkChannel')
const status = makeFunctionReference<'query'>('sync/links:status')
const applyInbound = makeFunctionReference<'mutation'>('sync/ingest:applyInbound')

const serverSecret = 'sync-test-secret'
process.env.INTERNAL_API_SECRET = serverSecret

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    const members: Array<[string, 'owner' | 'member', string]> = [['owner', 'owner', 'owner@example.com'], ['alice', 'member', 'alice@example.com']]
    for (const [userId, role, email] of members) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p-' + userId, userId, type: 'human', displayName: userId, email, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p-' + userId, membershipId: 'm-' + userId, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const base = { serverSecret, actorUserId: 'owner', workspaceId: 'ws' }
  await t.mutation(connect, { ...base, provider: 'slack', externalOrgId: 'T1', externalOrgName: 'LayerNorm Slack' })
  const linked = await t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
  }) as { linkId: string; conversationId: string }
  return { t, base, linked }
}

const batch = (events: unknown[], authors: unknown[] = []) => ({
  serverSecret,
  batch: { provider: 'slack', externalOrgId: 'T1', externalChannelId: 'C1', events, authors },
})

const bob = { externalUserId: 'U-bob', displayName: 'Bob Outside', email: 'bob@other.com' }
const alice = { externalUserId: 'U-alice', displayName: 'Alice', email: 'Alice@Example.com' }

async function messages(t: Awaited<ReturnType<typeof fixture>>['t'], conversationId: string) {
  return await t.run(async ctx => await ctx.db.query('conversationMessages')
    .withIndex('by_conversationId', q => q.eq('conversationId', conversationId as never)).collect())
}

test('only owners and admins manage sync', async () => {
  const { t } = await fixture()
  await expect(t.mutation(linkChannel, {
    serverSecret, actorUserId: 'alice', workspaceId: 'ws', provider: 'slack',
    externalChannelId: 'C2', externalChannelName: 'random', externalChannelKind: 'public',
  })).rejects.toThrow('SYNC_MANAGE_DENIED')
})

test('a channel links once, and private channels map to private Overlay channels', async () => {
  const { t, base, linked } = await fixture()
  await expect(t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
  })).rejects.toThrow('SYNC_CHANNEL_ALREADY_LINKED')
  const secret = await t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C9', externalChannelName: 'Secret Plans', externalChannelKind: 'private',
  }) as { conversationId: string }
  const conversations = await t.run(async ctx => [await ctx.db.get(linked.conversationId as never), await ctx.db.get(secret.conversationId as never)]) as Array<{ channelVisibility: string; channelSlug: string }>
  expect(conversations.map(c => [c.channelSlug, c.channelVisibility])).toEqual([['general', 'public'], ['secret-plans', 'private']])
})

test('inbound messages land once, with members matched by email and outsiders as imported authors', async () => {
  const { t, linked } = await fixture()
  const first = batch([
    { kind: 'message.upsert', externalMessageId: '100.1', externalUserId: 'U-bob', text: 'hello', createdAt: 1000 },
    { kind: 'message.upsert', externalMessageId: '100.2', externalUserId: 'U-alice', text: 'hi bob', createdAt: 2000 },
    { kind: 'message.upsert', externalMessageId: '100.3', externalThreadId: '100.1', externalUserId: 'U-alice', text: 'in thread', createdAt: 3000 },
  ], [bob, alice])
  expect(await t.mutation(applyInbound, first)).toEqual({ applied: 3, skipped: 0 })
  expect(await t.mutation(applyInbound, first)).toEqual({ applied: 0, skipped: 3 })
  const rows = (await messages(t, linked.conversationId)).sort((a, b) => a.createdAt - b.createdAt)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatchObject({ content: 'hello', importedAuthorName: 'Bob Outside', importedAuthorStatus: 'not_invited', createdAt: 1000 })
  expect(rows[1]).toMatchObject({ authorPrincipalId: 'p-alice', authorKind: 'human' })
  expect(rows[2].threadRootMessageId).toBe(rows[0]._id)
})

test('edits, deletes and reactions follow the platform message', async () => {
  const { t, linked } = await fixture()
  await t.mutation(applyInbound, batch([
    { kind: 'message.upsert', externalMessageId: '200.1', externalUserId: 'U-bob', text: 'draft', createdAt: 1000 },
  ], [bob]))
  await t.mutation(applyInbound, batch([
    { kind: 'message.upsert', externalMessageId: '200.1', externalUserId: 'U-bob', text: 'final', createdAt: 1000, editedAt: 5000 },
    { kind: 'reaction.add', externalMessageId: '200.1', externalUserId: 'U-bob', emoji: 'tada' },
    { kind: 'reaction.add', externalMessageId: '200.1', externalUserId: 'U-alice', emoji: 'tada' },
  ], [alice]))
  let [row] = await messages(t, linked.conversationId)
  expect(row).toMatchObject({ content: 'final', editedAt: 5000 })
  expect(row.editHistory).toEqual([{ content: 'draft', editedAt: 5000 }])
  const reactions = await t.run(async ctx => await ctx.db.query('conversationMessageReactions').collect())
  expect(reactions.map(r => r.principalId).sort()).toEqual(['ext:slack:U-bob', 'p-alice'])
  await t.mutation(applyInbound, batch([
    { kind: 'reaction.remove', externalMessageId: '200.1', externalUserId: 'U-bob', emoji: 'tada' },
    { kind: 'message.delete', externalMessageId: '200.1' },
  ]))
  ;[row] = await messages(t, linked.conversationId)
  expect(row.deletedAt).toBeTypeOf('number')
  expect(row.content).toBe('')
  expect(await t.run(async ctx => (await ctx.db.query('conversationMessageReactions').collect()).length)).toBe(1)
})

test('paused and unlinked channels ignore events; relinking starts clean', async () => {
  const { t, base, linked } = await fixture()
  await t.mutation(applyInbound, batch([{ kind: 'message.upsert', externalMessageId: '300.1', externalUserId: 'U-bob', text: 'one', createdAt: 1 }], [bob]))
  await t.mutation(disconnect, { ...base, provider: 'slack' })
  expect(await t.mutation(applyInbound, batch([{ kind: 'message.upsert', externalMessageId: '300.2', externalUserId: 'U-bob', text: 'two', createdAt: 2 }], [bob]))).toEqual({ applied: 0, skipped: 1 })
  await t.mutation(connect, { ...base, provider: 'slack', externalOrgId: 'T1' })
  await t.mutation(unlinkChannel, { ...base, linkId: linked.linkId })
  await t.mutation(makeFunctionReference<'mutation'>('sync/links:purgeMessageMap'), { linkId: linked.linkId })
  expect(await t.run(async ctx => (await ctx.db.query('syncMessageMap').collect()).length)).toBe(0)
  expect((await messages(t, linked.conversationId)).length).toBe(1)
})

test('the settings view shows links to members without exposing tokens', async () => {
  const { t } = await fixture()
  const view = await t.withIdentity({ subject: 'alice' }).query(status, { workspaceId: 'ws' }) as {
    canManage: boolean
    providers: Array<{ provider: string; connection: { externalOrgName: string } | null; links: Array<{ overlayChannelName: string; status: string }> }>
  }
  expect(view.canManage).toBe(false)
  const slack = view.providers.find(p => p.provider === 'slack')!
  expect(slack.connection?.externalOrgName).toBe('LayerNorm Slack')
  expect(slack.links.map(l => [l.overlayChannelName, l.status])).toEqual([['general', 'history']])
  expect(JSON.stringify(view)).not.toContain('sealed')
})
