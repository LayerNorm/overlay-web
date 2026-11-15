import { expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const connect = makeFunctionReference<'mutation'>('sync/links:connect')
const linkChannel = makeFunctionReference<'mutation'>('sync/links:linkChannel')
const updateLinkState = makeFunctionReference<'mutation'>('sync/links:updateLinkState')
const applyInbound = makeFunctionReference<'mutation'>('sync/ingest:applyInbound')
const connectAccount = makeFunctionReference<'mutation'>('sync/teamsAccounts:connectAccount')
const getCredential = makeFunctionReference<'query'>('sync/teamsAccounts:getCredential')
const storeTokens = makeFunctionReference<'mutation'>('sync/teamsAccounts:storeTokens')
const revoke = makeFunctionReference<'mutation'>('sync/teamsAccounts:revoke')
const listMaintenance = makeFunctionReference<'query'>('sync/teamsLinks:listMaintenance')
const hasMaintenanceWork = makeFunctionReference<'query'>('sync/teamsLinks:hasMaintenanceWork')
const getLink = makeFunctionReference<'query'>('sync/teamsLinks:getLink')
const messageReactions = makeFunctionReference<'query'>('sync/teamsLinks:messageReactions')

const serverSecret = 'sync-teams-test-secret'
process.env.INTERNAL_API_SECRET = serverSecret

const PAUSE_TEAM = 'Add Overlay to this team in Teams to resume.'

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['owner', 'owner'], ['alice', 'member'], ['bob', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p-' + userId, userId, type: 'human', displayName: userId, email: userId + '@example.com', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p-' + userId, membershipId: 'm-' + userId, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const base = { serverSecret, actorUserId: 'owner', workspaceId: 'ws' }
  await t.mutation(connect, { ...base, provider: 'teams', externalOrgId: 'tenant-1', externalOrgName: 'Contoso' })
  const link = (externalChannelId: string, externalChannelKind: 'public' | 'private' | 'shared') => t.mutation(linkChannel, {
    ...base, provider: 'teams', externalChannelId, externalGroupId: 'team-1', externalChannelName: externalChannelId, externalChannelKind,
  }) as Promise<{ linkId: string; conversationId: string }>
  return { t, base, link }
}

const account = (userId: string, externalUserId: string, externalOrgId = 'tenant-1') => ({
  serverSecret, workspaceId: 'ws', userId, externalOrgId, externalUserId, externalDisplayName: 'Alice in Teams',
  sealedToken: 'sealed-access', sealedRefreshToken: 'sealed-refresh', tokenExpiresAt: 5000, scopes: ['ChannelMessage.Send'],
})

test('a member connects their Teams account once, in the connected tenant, and inbound posts become theirs', async () => {
  const { t, link } = await fixture()
  const { conversationId } = await link('19:general', 'public')
  await expect(t.mutation(connectAccount, account('alice', 'aad-alice', 'tenant-2'))).rejects.toThrow('SYNC_ACCOUNT_WRONG_ORG')
  await t.mutation(connectAccount, account('alice', 'aad-alice'))
  await expect(t.mutation(connectAccount, account('bob', 'aad-alice'))).rejects.toThrow('SYNC_ACCOUNT_CLAIMED')
  expect(await t.query(getCredential, { serverSecret, workspaceId: 'ws', userId: 'alice' })).toEqual({
    externalOrgId: 'tenant-1', externalUserId: 'aad-alice', sealedToken: 'sealed-access', sealedRefreshToken: 'sealed-refresh', tokenExpiresAt: 5000,
  })
  await t.mutation(applyInbound, { serverSecret, batch: {
    provider: 'teams', externalOrgId: 'tenant-1', externalChannelId: '19:general',
    events: [{ kind: 'message.upsert', externalMessageId: '1', externalUserId: 'aad-alice', text: 'from Teams', createdAt: 10 }],
    authors: [{ externalUserId: 'aad-alice', displayName: 'Alice Teams' }],
  } })
  const [message] = await t.run(async ctx => await ctx.db.query('conversationMessages')
    .withIndex('by_conversationId', q => q.eq('conversationId', conversationId as never)).collect())
  expect(message).toMatchObject({ authorPrincipalId: 'p-alice', content: 'from Teams' })
  await t.mutation(storeTokens, { serverSecret, workspaceId: 'ws', userId: 'alice', sealedToken: 'sealed-new', tokenExpiresAt: 9000 })
  expect(await t.query(getCredential, { serverSecret, workspaceId: 'ws', userId: 'alice' })).toMatchObject({ sealedToken: 'sealed-new', sealedRefreshToken: 'sealed-refresh', tokenExpiresAt: 9000 })
  await t.mutation(revoke, { serverSecret, workspaceId: 'ws', userId: 'alice' })
  expect(await t.query(getCredential, { serverSecret, workspaceId: 'ws', userId: 'alice' })).toBeNull()
  await t.mutation(connectAccount, account('bob', 'aad-alice'))
})

test('account writes require the server secret and an active member', async () => {
  const { t } = await fixture()
  await expect(t.mutation(connectAccount, { ...account('alice', 'aad-alice'), serverSecret: 'wrong' })).rejects.toThrow('Unauthorized')
  await expect(t.mutation(connectAccount, account('stranger', 'aad-x'))).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(t.query(getCredential, { serverSecret: 'wrong', workspaceId: 'ws', userId: 'alice' })).rejects.toThrow('Unauthorized')
})

test('maintenance subscribes and renews standard channels, polls private and shared ones, and retries app-missing pauses', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(1_000_000_000)
    const { t, link } = await fixture()
    const standard = await link('19:general', 'public')
    const renewing = await link('19:renew', 'public')
    const fresh = await link('19:fresh', 'public')
    const privateLink = await link('19:private', 'private')
    const sharedLink = await link('19:shared', 'shared')
    const missing = await link('19:missing', 'public')
    const disconnected = await link('19:off', 'public')
    const now = Date.now()
    await t.mutation(updateLinkState, { serverSecret, linkId: renewing.linkId, subscriptionId: 'sub-renew', subscriptionExpiresAt: now + 60 * 60 * 1000 })
    await t.mutation(updateLinkState, { serverSecret, linkId: fresh.linkId, subscriptionId: 'sub-fresh', subscriptionExpiresAt: now + 60 * 60 * 60 * 1000 })
    await t.mutation(updateLinkState, { serverSecret, linkId: missing.linkId, status: 'paused', pauseReason: PAUSE_TEAM })
    await t.mutation(updateLinkState, { serverSecret, linkId: disconnected.linkId, status: 'paused', pauseReason: 'disconnected' })
    const ids = (rows: Array<{ linkId: string }>) => rows.map(row => row.linkId).sort()
    let due = await t.query(listMaintenance, { serverSecret }) as Record<string, Array<{ linkId: string }>>
    expect(ids(due.subscribe)).toEqual([standard.linkId])
    expect(ids(due.renew)).toEqual([renewing.linkId])
    expect(ids(due.poll)).toEqual([privateLink.linkId, sharedLink.linkId].sort())
    expect(due.retry).toEqual([])
    vi.setSystemTime(now + 16 * 60 * 1000)
    due = await t.query(listMaintenance, { serverSecret }) as Record<string, Array<{ linkId: string }>>
    expect(ids(due.retry)).toEqual([missing.linkId])
    expect(await t.query(hasMaintenanceWork, { now: Date.now() })).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test('getLink returns Teams links only, and tolerates malformed ids', async () => {
  const { t, link } = await fixture()
  const { linkId } = await link('19:general', 'public')
  expect(await t.query(getLink, { serverSecret, linkId })).toMatchObject({ linkId, externalGroupId: 'team-1', externalChannelKind: 'public', status: 'history' })
  expect(await t.query(getLink, { serverSecret, linkId: 'not-an-id' })).toBeNull()
  await expect(t.query(getLink, { serverSecret: 'wrong', linkId })).rejects.toThrow('Unauthorized')
})

test('stored reactions are listed by Teams user so taken-back reactions can be removed', async () => {
  const { t, link } = await fixture()
  await link('19:general', 'public')
  await t.mutation(connectAccount, account('alice', 'aad-alice'))
  await t.mutation(applyInbound, { serverSecret, batch: {
    provider: 'teams', externalOrgId: 'tenant-1', externalChannelId: '19:general',
    events: [
      { kind: 'message.upsert', externalMessageId: '1', externalUserId: 'aad-guest', text: 'hello', createdAt: 10 },
      { kind: 'reaction.add', externalMessageId: '1', externalUserId: 'aad-guest', emoji: '👍' },
      { kind: 'reaction.add', externalMessageId: '1', externalUserId: 'aad-alice', emoji: '❤️' },
    ],
    authors: [{ externalUserId: 'aad-guest', displayName: 'Guest' }],
  } })
  await t.run(async ctx => {
    const message = (await ctx.db.query('conversationMessages').collect())[0]!
    await ctx.db.insert('conversationMessageReactions', {
      conversationId: message.conversationId, messageId: message._id, workspaceId: 'ws', principalId: 'p-bob', emoji: '🎉', createdAt: 1,
    })
  })
  const reactions = await t.query(messageReactions, { serverSecret, externalChannelId: '19:general', externalMessageId: '1' }) as Array<{ externalUserId: string; emoji: string }>
  expect(reactions.sort((a, b) => a.externalUserId.localeCompare(b.externalUserId))).toEqual([
    { externalUserId: 'aad-alice', emoji: '❤️' },
    { externalUserId: 'aad-guest', emoji: '👍' },
  ])
  expect(await t.query(messageReactions, { serverSecret, externalChannelId: '19:general', externalMessageId: 'unknown' })).toEqual([])
})
