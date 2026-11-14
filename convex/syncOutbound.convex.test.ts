import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const connect = makeFunctionReference<'mutation'>('sync/links:connect')
const linkChannel = makeFunctionReference<'mutation'>('sync/links:linkChannel')
const updateLinkState = makeFunctionReference<'mutation'>('sync/links:updateLinkState')
const connectAccount = makeFunctionReference<'mutation'>('sync/accounts:connect')
const disconnectAccount = makeFunctionReference<'mutation'>('sync/accounts:disconnect')
const setDmSync = makeFunctionReference<'mutation'>('sync/accounts:setDmSync')
const composerState = makeFunctionReference<'query'>('sync/accounts:composerState')
const claimDue = makeFunctionReference<'mutation'>('sync/outbox:claimDue')
const complete = makeFunctionReference<'mutation'>('sync/outbox:complete')
const release = makeFunctionReference<'mutation'>('sync/outbox:release')
const applyInbound = makeFunctionReference<'mutation'>('sync/ingest:applyInbound')
const applyInboundInternal = makeFunctionReference<'mutation'>('sync/ingest:applyInboundInternal')
const addMessage = makeFunctionReference<'mutation'>('collaboration/directMessages:addMessage')
const editMessage = makeFunctionReference<'mutation'>('collaboration/directMessages:editMessage')
const deleteMessage = makeFunctionReference<'mutation'>('collaboration/directMessages:deleteMessage')
const setReaction = makeFunctionReference<'mutation'>('collaboration/channels:setReaction')

const serverSecret = 'sync-test-secret'
process.env.INTERNAL_API_SECRET = serverSecret

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers() })

type Work = { outboxId: string; action: string; externalMessageId?: string; externalThreadId?: string; sealedToken: string; externalUserId: string; content: string; emoji?: string }

async function fixture({ withAccount = true } = {}) {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['owner', 'owner'], ['alice', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p-' + userId, userId, type: 'human', displayName: userId, email: userId + '@example.com', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p-' + userId, membershipId: 'm-' + userId, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const base = { serverSecret, actorUserId: 'owner', workspaceId: 'ws' }
  await t.mutation(connect, { ...base, provider: 'slack', externalOrgId: 'T1' })
  const linked = await t.mutation(linkChannel, {
    ...base, provider: 'slack', externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
  }) as { linkId: string; conversationId: string }
  if (withAccount) {
    await t.mutation(connectAccount, {
      ...base, provider: 'slack', externalOrgId: 'T1', externalUserId: 'U-owner', externalDisplayName: 'Owner', sealedToken: 'v1.sealed', scopes: ['chat:write'],
    })
  }
  const room = { serverSecret, actorUserId: 'owner', workspaceId: 'ws', conversationId: linked.conversationId }
  let nonce = 0
  const send = async (content: string, extra: Record<string, unknown> = {}) => await t.mutation(addMessage, {
    ...room, content, turnId: 'turn-' + (nonce += 1), clientNonce: 'nonce-' + nonce, ...extra,
  }) as string
  const outbox = async () => await t.run(async ctx => await ctx.db.query('syncOutbox').collect())
  const messages = async () => await t.run(async ctx => (await ctx.db.query('conversationMessages').collect())
    .filter(m => m.conversationId === linked.conversationId && !m.deletedAt))
  const claim = async () => await t.mutation(claimDue, { serverSecret }) as Work[]
  const echo = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({
    serverSecret,
    batch: {
      provider: 'slack', externalOrgId: 'T1', externalChannelId: 'C1',
      events: [{ kind: 'message.upsert', externalMessageId: ts, externalUserId: 'U-owner', text, createdAt: 5000, ...extra }],
      authors: [{ externalUserId: 'U-owner', displayName: 'Owner', email: 'owner@example.com' }],
    },
  })
  return { t, base, linked, room, send, outbox, messages, claim, echo }
}

test('a member connects their own Slack account, which must belong to the synced workspace', async () => {
  const { t, base } = await fixture({ withAccount: false })
  const grant = { ...base, provider: 'slack', externalUserId: 'U-owner', sealedToken: 'v1.sealed', scopes: ['chat:write', 'reactions:write'] }
  await expect(t.mutation(connectAccount, { ...grant, externalOrgId: 'T-other' })).rejects.toThrow('SYNC_ACCOUNT_ORG_MISMATCH')
  await t.mutation(connectAccount, { ...grant, externalOrgId: 'T1', externalDisplayName: 'Owner' })
  await expect(t.mutation(connectAccount, { ...grant, actorUserId: 'alice', externalOrgId: 'T1' })).rejects.toThrow('SYNC_ACCOUNT_IN_USE')
  const identity = await t.run(async ctx => await ctx.db.query('syncIdentities').collect())
  expect(identity).toMatchObject([{ externalUserId: 'U-owner', principalId: 'p-owner' }])
  await t.mutation(setDmSync, { ...base, provider: 'slack', enabled: true })
  expect(await t.run(async ctx => (await ctx.db.query('syncMemberAccounts').first())?.dmSyncEnabled)).toBe(true)
  expect(await t.mutation(disconnectAccount, { ...base, provider: 'slack' })).toBe('v1.sealed')
  const account = await t.run(async ctx => await ctx.db.query('syncMemberAccounts').first())
  expect(account).toMatchObject({ status: 'revoked', sealedToken: '', dmSyncEnabled: false })
  expect(await t.mutation(disconnectAccount, { ...base, provider: 'slack' })).toBeNull()
  await expect(t.mutation(setDmSync, { ...base, provider: 'slack', enabled: true })).rejects.toThrow('SYNC_ACCOUNT_NOT_CONNECTED')
})

test('the composer asks members without an account to connect, and only in linked channels', async () => {
  const { t, linked } = await fixture()
  const args = { workspaceId: 'ws', conversationId: linked.conversationId }
  expect(await t.withIdentity({ subject: 'alice' }).query(composerState, args)).toEqual({ connectProvider: 'slack' })
  expect(await t.withIdentity({ subject: 'owner' }).query(composerState, args)).toBeNull()
  await t.mutation(updateLinkState, { serverSecret, linkId: linked.linkId, status: 'paused' })
  expect(await t.withIdentity({ subject: 'alice' }).query(composerState, args)).toBeNull()
  expect(await t.query(composerState, args)).toBeNull()
})

test('only members with an account queue posts, and sends wake the worker', async () => {
  const noAccount = await fixture({ withAccount: false })
  await noAccount.send('nobody can mirror this')
  expect(await noAccount.outbox()).toHaveLength(0)

  const { t, send, outbox } = await fixture()
  const messageId = await send('hello **Slack**')
  expect(await outbox()).toMatchObject([{ messageId, action: 'post', state: 'pending', actorUserId: 'owner', attempts: 0 }])
  const scheduled = await t.run(async ctx => await ctx.db.system.query('_scheduled_functions').collect())
  expect(scheduled.some(job => job.name.includes('sync/outbox') && job.name.includes('dispatch'))).toBe(true)
})

test('a post records its Slack id and the later echo creates no second message', async () => {
  const { t, send, claim, messages, echo, outbox } = await fixture()
  const messageId = await send('hello **Slack**')
  const [work] = await claim()
  expect(work).toMatchObject({ action: 'post', content: 'hello **Slack**', sealedToken: 'v1.sealed', externalUserId: 'U-owner' })
  expect(await claim()).toHaveLength(0)
  await t.mutation(complete, { serverSecret, outboxId: work!.outboxId, externalMessageId: '1700.0001' })
  const map = await t.run(async ctx => await ctx.db.query('syncMessageMap').collect())
  expect(map).toMatchObject([{ messageId, externalMessageId: '1700.0001', direction: 'outbound' }])
  expect(await t.mutation(applyInbound, echo('1700.0001', 'hello *Slack*'))).toEqual({ applied: 0, skipped: 1 })
  expect((await messages()).map(m => [m._id, m.content])).toEqual([[messageId, 'hello **Slack**']])
  expect((await outbox())[0]!.state).toBe('done')
})

test('an echo that arrives before Slack returns the id waits, then is dropped', async () => {
  const { t, send, claim, messages, echo } = await fixture()
  const messageId = await send('racing')
  const [work] = await claim()
  expect(await t.mutation(applyInbound, echo('1700.0002', 'racing'))).toEqual({ applied: 0, skipped: 1 })
  expect(await messages()).toHaveLength(1)
  const deferred = await t.run(async ctx => (await ctx.db.system.query('_scheduled_functions').collect())
    .filter(job => job.name.includes('applyInboundInternal')))
  expect(deferred).toHaveLength(1)
  await t.mutation(complete, { serverSecret, outboxId: work!.outboxId, externalMessageId: '1700.0002' })
  await t.mutation(applyInboundInternal, deferred[0]!.args[0] as never)
  expect((await messages()).map(m => m._id)).toEqual([messageId])
})

test('a genuine Slack message from the same person still lands once the post settles', async () => {
  const { t, send, claim, messages, echo } = await fixture()
  await send('from overlay')
  const [work] = await claim()
  await t.mutation(applyInbound, echo('1700.0009', 'typed in slack'))
  const [deferred] = await t.run(async ctx => (await ctx.db.system.query('_scheduled_functions').collect())
    .filter(job => job.name.includes('applyInboundInternal')))
  await t.mutation(complete, { serverSecret, outboxId: work!.outboxId, externalMessageId: '1700.0003' })
  await t.mutation(applyInboundInternal, deferred!.args[0] as never)
  expect((await messages()).map(m => m.content).sort()).toEqual(['from overlay', 'typed in slack'])
})

test('if an echo copy slipped in after the worker lease ran out, completing the post folds it into the original', async () => {
  const { t, send, claim, messages, echo } = await fixture()
  const messageId = await send('slow send')
  const [work] = await claim()
  await t.run(async ctx => { await ctx.db.patch(work!.outboxId as never, { nextAttemptAt: Date.now() - 1 }) })
  expect(await t.mutation(applyInbound, echo('1700.0004', 'slow send'))).toEqual({ applied: 1, skipped: 0 })
  const duplicate = (await messages()).find(m => m._id !== messageId)!
  await t.run(async ctx => {
    await ctx.db.insert('conversationMessageReactions', {
      conversationId: duplicate.conversationId, messageId: duplicate._id, workspaceId: 'ws', principalId: 'ext:slack:U-bob', emoji: '🎉', createdAt: 1,
    })
  })
  await t.mutation(complete, { serverSecret, outboxId: work!.outboxId, externalMessageId: '1700.0004' })
  expect((await messages()).map(m => m._id)).toEqual([messageId])
  const [map] = await t.run(async ctx => await ctx.db.query('syncMessageMap').collect())
  expect(map).toMatchObject({ messageId, direction: 'outbound', externalMessageId: '1700.0004' })
  expect(await t.run(async ctx => (await ctx.db.query('conversationMessageReactions').collect()).map(r => r.messageId))).toEqual([messageId])
})

test('edits and deletes follow the post; unsent posts absorb them', async () => {
  const { t, room, send, claim, outbox, echo, messages } = await fixture()
  const early = await send('typo')
  await t.mutation(editMessage, { ...room, messageId: early, content: 'fixed' })
  expect((await outbox()).map(row => row.action)).toEqual(['post'])
  const [post] = await claim()
  expect(post!.content).toBe('fixed')
  await t.mutation(complete, { serverSecret, outboxId: post!.outboxId, externalMessageId: '1700.0005' })

  await t.mutation(editMessage, { ...room, messageId: early, content: 'fixed again' })
  const [edit] = await claim()
  expect(edit).toMatchObject({ action: 'edit', externalMessageId: '1700.0005', content: 'fixed again' })
  expect(await t.mutation(applyInbound, echo('1700.0005', 'fixed again', { editedAt: 9000 }))).toEqual({ applied: 0, skipped: 1 })
  await t.mutation(complete, { serverSecret, outboxId: edit!.outboxId })
  expect(await t.mutation(applyInbound, echo('1700.0005', 'fixed agian', { editedAt: 9100 }))).toEqual({ applied: 0, skipped: 1 })
  await t.run(async ctx => {
    for (const row of await ctx.db.query('syncOutbox').collect()) await ctx.db.patch(row._id, { updatedAt: 1 })
  })
  expect(await t.mutation(applyInbound, echo('1700.0005', 'edited in slack', { editedAt: 9200 }))).toEqual({ applied: 1, skipped: 0 })
  expect((await messages())[0]!.content).toBe('edited in slack')

  await t.mutation(deleteMessage, { ...room, messageId: early })
  const [remove] = await claim()
  expect(remove).toMatchObject({ action: 'delete', externalMessageId: '1700.0005' })

  const unsent = await send('never mind')
  await t.mutation(deleteMessage, { ...room, messageId: unsent })
  const rows = (await outbox()).filter(row => row.messageId === unsent)
  expect(rows).toMatchObject([{ action: 'post', state: 'done', lastError: 'Deleted before it was sent' }])
})

test('messages that did not come from Overlay are never edited or deleted outward', async () => {
  const { t, room, outbox, linked } = await fixture()
  await t.mutation(applyInbound, {
    serverSecret,
    batch: {
      provider: 'slack', externalOrgId: 'T1', externalChannelId: 'C1',
      events: [{ kind: 'message.upsert', externalMessageId: '1600.0001', externalUserId: 'U-owner', text: 'written in slack', createdAt: 1000 }],
      authors: [{ externalUserId: 'U-owner', displayName: 'Owner', email: 'owner@example.com' }],
    },
  })
  const inbound = await t.run(async ctx => (await ctx.db.query('conversationMessages').collect()).find(m => m.conversationId === linked.conversationId)!)
  expect(inbound.authorPrincipalId).toBe('p-owner')
  await t.mutation(editMessage, { ...room, messageId: inbound._id, content: 'edited in overlay' })
  expect(await outbox()).toHaveLength(0)

  await t.mutation(setReaction, { ...room, messageId: inbound._id, emoji: '👍', enabled: true })
  await t.mutation(setReaction, { ...room, messageId: inbound._id, emoji: '👍', enabled: false })
  expect(await outbox()).toHaveLength(0)
  await t.mutation(setReaction, { ...room, messageId: inbound._id, emoji: '🎉', enabled: true })
  expect(await outbox()).toMatchObject([{ action: 'react', emoji: '🎉', messageId: inbound._id }])
})

test('thread replies use the root message ts and wait for an unsent root', async () => {
  const { t, send, claim, outbox } = await fixture()
  const root = await send('root')
  const reply = await send('reply', { threadRootMessageId: root })
  const first = await claim()
  expect(first.map(work => work.action)).toEqual(['post'])
  expect((await outbox()).find(row => row.messageId === reply)!.state).toBe('pending')
  await t.mutation(complete, { serverSecret, outboxId: first[0]!.outboxId, externalMessageId: '1800.0001' })
  await t.run(async ctx => {
    for (const row of await ctx.db.query('syncOutbox').collect()) await ctx.db.patch(row._id, { nextAttemptAt: 0 })
  })
  const [threaded] = await claim()
  expect(threaded).toMatchObject({ action: 'post', content: 'reply', externalThreadId: '1800.0001' })
  await t.mutation(complete, { serverSecret, outboxId: threaded!.outboxId, externalMessageId: '1800.0002', externalThreadId: '1800.0001' })
  const map = await t.run(async ctx => (await ctx.db.query('syncMessageMap').collect()).find(row => row.messageId === reply))
  expect(map).toMatchObject({ externalThreadId: '1800.0001', direction: 'outbound' })
})

test('failures back off, stop after bounded attempts, and a revoked grant fails at once', async () => {
  const { t, send, claim, outbox } = await fixture()
  await send('flaky')
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const [work] = await claim()
    expect(work).toBeDefined()
    await t.mutation(release, { serverSecret, outboxId: work!.outboxId, error: 'Slack chat.postMessage failed: internal_error' })
    const [row] = await outbox()
    if (attempt < 6) {
      expect(row).toMatchObject({ state: 'pending', attempts: attempt })
      expect(row!.nextAttemptAt).toBeGreaterThan(Date.now())
      await t.run(async ctx => { await ctx.db.patch(row!._id, { nextAttemptAt: 0 }) })
    } else {
      expect(row).toMatchObject({ state: 'failed', lastError: 'Slack chat.postMessage failed: internal_error' })
    }
  }

  await send('rate limited')
  const [limited] = await claim()
  await t.mutation(release, { serverSecret, outboxId: limited!.outboxId, error: 'Rate limited', retryAfterMs: 30_000, refundAttempt: true })
  expect((await outbox()).find(row => row._id === limited!.outboxId)).toMatchObject({ state: 'pending', attempts: 0 })
  await t.run(async ctx => { await ctx.db.patch(limited!.outboxId as never, { nextAttemptAt: 0 }) })

  const [revoked] = await claim()
  await t.mutation(release, { serverSecret, outboxId: revoked!.outboxId, error: 'Reconnect', permanent: true, revokeAccount: true })
  expect((await outbox()).find(row => row._id === revoked!.outboxId)!.state).toBe('failed')
  expect(await t.run(async ctx => (await ctx.db.query('syncMemberAccounts').first())?.status)).toBe('revoked')
  await send('after revoke')
  expect((await outbox()).filter(row => row.state === 'pending')).toHaveLength(0)
})
