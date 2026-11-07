import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const state = makeFunctionReference<'query'>('collaboration/rooms:state')
const messages = makeFunctionReference<'query'>('collaboration/rooms:messages')
const setReaction = makeFunctionReference<'mutation'>('collaboration/rooms:setReaction')
const setPinned = makeFunctionReference<'mutation'>('collaboration/rooms:setPinned')
const setSaved = makeFunctionReference<'mutation'>('collaboration/rooms:setSaved')
const setThreadFollow = makeFunctionReference<'mutation'>('collaboration/rooms:setThreadFollow')
const updateMyState = makeFunctionReference<'mutation'>('collaboration/rooms:updateMyState')
const removeParticipant = makeFunctionReference<'mutation'>('collaboration/rooms:removeParticipant')
const heartbeat = makeFunctionReference<'mutation'>('collaboration/rooms:heartbeat')
afterEach(() => vi.useRealTimers())

type State = {
  currentPrincipalId: string
  channel: { name: string; participantCount: number } | null
  participants: Array<{ principalId: string; notificationLevel?: string }>
  reactions: Array<{ emoji: string; count: number; reactedByCurrentPrincipal: boolean }>
  pins: Array<{ messageId: string }>
  saved: Array<{ messageId: string }>
  follows: Array<{ threadRootMessageId: string }>
  presence: Array<{ principalId: string; status: string; typing: boolean }>
} | null

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const conversationId = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title: 'general', conversationType: 'channel', scope: 'workspace', channelSlug: 'general',
      channelVisibility: 'public', askModelIds: ['model'], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1,
    } as never)
    for (const [userId, role] of [['alice', 'moderator'], ['bob', 'member']] as const) {
      await ctx.db.insert('conversationParticipants', {
        conversationId, workspaceId: 'ws', principalId: `p-${userId}`, principalType: 'human',
        role, status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
      })
    }
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', turnId: 'turn', role: 'user', mode: 'act', contentType: 'text',
      content: 'hello', parts: [{ type: 'text', text: 'hello' }], authorKind: 'human', authorPrincipalId: 'p-alice', createdAt: 1,
    } as never)
    return { conversationId, messageId }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  const room = { workspaceId: 'ws', conversationId: ids.conversationId }
  return { t, as, room, ...ids }
}

test('concurrent reactions from two members converge, and pins and saves are shared or private as intended', async () => {
  const { as, room, messageId } = await fixture()
  await Promise.all([
    as('alice').mutation(setReaction, { ...room, messageId, emoji: '👍', enabled: true }),
    as('bob').mutation(setReaction, { ...room, messageId, emoji: '👍', enabled: true }),
  ])
  const alice = await as('alice').query(state, room) as State
  expect(alice!.reactions).toEqual([expect.objectContaining({ emoji: '👍', count: 2, reactedByCurrentPrincipal: true })])
  expect(alice!.channel).toMatchObject({ name: 'general', participantCount: 2 })
  await as('bob').mutation(setPinned, { ...room, messageId, pinned: true })
  await as('bob').mutation(setSaved, { ...room, messageId, saved: true })
  await as('bob').mutation(setThreadFollow, { ...room, threadRootMessageId: messageId, followed: true })
  const aliceAfter = await as('alice').query(state, room) as State
  expect(aliceAfter!.pins.map(pin => pin.messageId)).toEqual([messageId])
  expect(aliceAfter!.saved).toEqual([])
  expect(aliceAfter!.follows).toEqual([])
  const bob = await as('bob').query(state, room) as State
  expect(bob!.saved.map(row => row.messageId)).toEqual([messageId])
  expect(bob!.follows.map(row => row.threadRootMessageId)).toEqual([messageId])
})

test('removing a participant revokes the room in every read', async () => {
  const { as, room, messageId } = await fixture()
  await expect(as('bob').mutation(removeParticipant, { ...room, principalId: 'p-alice' })).rejects.toThrow('CONVERSATION_MODERATOR_REQUIRED')
  await as('alice').mutation(removeParticipant, { ...room, principalId: 'p-bob' })
  expect(await as('bob').query(state, room)).toBeNull()
  expect(((await as('bob').query(messages, { ...room, paginationOpts: { numItems: 10, cursor: null } })) as { page: unknown[] }).page).toEqual([])
  await expect(as('bob').mutation(setReaction, { ...room, messageId, emoji: '👍', enabled: true })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  expect((await as('alice').query(state, room) as State)!.participants.map(row => row.principalId)).toEqual(['p-alice'])
})

test('a member mutes only their own state, and presence goes stale without heartbeats', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  const { as, room } = await fixture()
  await as('bob').mutation(updateMyState, { ...room, notificationLevel: 'muted' })
  const participants = (await as('alice').query(state, room) as State)!.participants
  expect(participants.find(row => row.principalId === 'p-bob')?.notificationLevel).toBe('muted')
  expect(participants.find(row => row.principalId === 'p-alice')?.notificationLevel).toBe('all')
  await as('bob').mutation(heartbeat, { ...room, sessionId: 'tab', status: 'online', typing: true })
  expect((await as('alice').query(state, room) as State)!.presence).toEqual([expect.objectContaining({ principalId: 'p-bob', status: 'online', typing: true })])
  vi.setSystemTime(1_000_000 + 121_000)
  expect((await as('alice').query(state, room) as State)!.presence).toEqual([expect.objectContaining({ principalId: 'p-bob', status: 'offline', typing: false })])
})
