import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'native-rooms'
const secret = 'native-rooms-test'
const now = 1_900_000_000_000
const pages = { numItems: 2, cursor: null }

beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://rooms.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://rooms.convex.cloud')
})
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence: 1, challenge: 'test',
      sourceOrigin: 'https://rooms.example.test', expiresAt: Date.now() + 3_600_000,
      snapshot: { version: 1, backendUrl: 'https://rooms.convex.cloud', revision: 'a'.repeat(64), features: { chat: true },
        rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } } })
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Rooms', slug: 'rooms', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('authorizationRoles', { roleId: 'room-user', name: 'Room user', isSystem: false,
      capabilities: ['conversations.read', 'conversations.create', 'conversations.edit'], createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob', 'eve']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: userId, userId, type: 'human', displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId, membershipId: `membership-${userId}`, principalId: userId,
        role: userId === 'alice' ? 'owner' : 'member', status: 'active', joinedAt: now, updatedAt: now })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'room-user', createdAt: now })
    }
  })
  const alice = t.withIdentity({ subject: 'alice' })
  const bob = t.withIdentity({ subject: 'bob' })
  const eve = t.withIdentity({ subject: 'eve' })
  const { conversationId } = await alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['bob'] })
  const args = { workspaceId, conversationId }
  const message = (turnId: string, threadRootMessageId?: Id<'conversationMessages'>, author = 'alice', createdAt = now) => t.run(ctx => ctx.db.insert('conversationMessages', {
    conversationId, userId: author, authorPrincipalId: author, authorKind: 'human', role: 'user', mode: 'act', contentType: 'text',
    turnId, content: turnId, parts: [{ type: 'text', text: turnId }], createdAt, threadRootMessageId,
  }))
  return { t, alice, bob, eve, args, message }
}

describe('native room access and bounded projections', () => {
  test('getExecution returns scoped compatibility only and rejects invalid or inaccessible roots', async () => {
    const f = await fixture()
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, f.args)).toEqual({ ...f.args, userId: 'alice', compatibility: { readOnly: false } })
    const root = await f.message('root')
    expect(await f.bob.query(api.collaboration.nativeRooms.getExecution, { ...f.args, threadRootMessageId: root })).toMatchObject({ userId: 'bob', threadRootMessageId: root, compatibility: { readOnly: false } })
    const reply = await f.message('reply', root)
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, { ...f.args, threadRootMessageId: reply })).toBeNull()
    const other = await f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['eve'] })
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, { conversationId: other.conversationId, workspaceId, threadRootMessageId: root })).toBeNull()
    expect(await f.eve.query(api.collaboration.nativeRooms.getExecution, f.args)).toBeNull()
    expect(await f.t.query(api.collaboration.nativeRooms.getExecution, f.args)).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, { ...f.args, workspaceId: 'foreign' })).toBeNull()
    await f.t.run(ctx => ctx.db.patch(root, { deletedAt: now }))
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, { ...f.args, threadRootMessageId: root })).toBeNull()
    await f.t.run(ctx => ctx.db.delete(root))
    expect(await f.alice.query(api.collaboration.nativeRooms.getExecution, { ...f.args, threadRootMessageId: root })).toBeNull()
    await f.bob.mutation(api.collaboration.nativeRoomState.removeParticipant, { ...f.args, principalId: 'bob' })
    expect(await f.bob.query(api.collaboration.nativeRooms.getExecution, f.args)).toBeNull()
  })

  test('getExecution conservatively reports retired threads and run-budget exhaustion read-only', async () => {
    const f = await fixture()
    const root = await f.message('root')
    const unrelated = await f.message('unrelated')
    await f.t.run(ctx => ctx.db.patch(f.args.conversationId, { conversationType: 'channel' }))
    const run = { conversationId: f.args.conversationId, userId: 'alice', userMessageId: unrelated, assistantMessageId: unrelated, turnId: 'old', mode: 'room' as const, runner: 'tool_loop' as const, status: 'completed' as const, createdAt: now, updatedAt: now }
    await f.t.run(ctx => ctx.db.insert('conversationAgentRuns', { ...run, userMessageId: root }))
    const args = { ...f.args, threadRootMessageId: root }
    expect((await f.alice.query(api.collaboration.nativeRooms.getExecution, args))?.compatibility).toMatchObject({ readOnly: true })
    await f.t.run(async ctx => {
      for (const row of await ctx.db.query('conversationAgentRuns').collect()) await ctx.db.delete(row._id)
      for (let i = 0; i < 101; i++) await ctx.db.insert('conversationAgentRuns', { ...run, turnId: `unrelated-${i}` })
    })
    expect((await f.alice.query(api.collaboration.nativeRooms.getExecution, args))?.compatibility).toMatchObject({ readOnly: true })
    expect((await f.alice.query(api.collaboration.nativeRooms.getExecution, f.args))?.compatibility).toEqual({ readOnly: false })
  })

  test('getExecution bounds ancestry traversal even for a malformed legacy reply chain', async () => {
    const f = await fixture()
    const root = await f.message('root')
    await f.t.run(ctx => ctx.db.patch(f.args.conversationId, { conversationType: 'channel' }))
    let ancestor = await f.message('unrelated-root')
    for (let i = 0; i < 201; i++) ancestor = await f.message(`nested-${i}`, ancestor)
    await f.t.run(ctx => ctx.db.insert('conversationAgentRuns', { conversationId: f.args.conversationId, userId: 'alice', userMessageId: ancestor, assistantMessageId: ancestor, turnId: 'old', mode: 'room', runner: 'tool_loop', status: 'completed', createdAt: now, updatedAt: now }))
    expect((await f.alice.query(api.collaboration.nativeRooms.getExecution, { ...f.args, threadRootMessageId: root }))?.compatibility).toMatchObject({ readOnly: true })
  })
  test('derives identity only; anonymous, outsider, foreign workspace and removed participant cannot read', async () => {
    const f = await fixture()
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).toMatchObject({ viewerPrincipalId: 'alice', participants: [{ principalId: 'alice' }, { principalId: 'bob' }] })
    expect(await f.t.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    expect(await f.eve.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, { ...f.args, workspaceId: 'other' })).toBeNull()
    await expect(f.eve.query(api.collaboration.nativeRooms.getRoom, { ...f.args, actorUserId: 'alice' } as never)).rejects.toThrow()
    await f.t.run(async ctx => {
      const row = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', f.args.conversationId).eq('principalId', 'alice')).unique()
      await ctx.db.patch(row!._id, { status: 'removed', removedAt: Date.now() })
    })
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, paginationOpts: pages })).toBeNull()
    await expect(f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['bob'] })).rejects.toThrow('ROOM_ACCESS_DENIED')
  })

  test('membership revocation, live agent archival, capabilities and chat feature fail closed', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'agent', workspaceId, principalId: 'agent-p', name: 'Agent', instructions: '', harness: 'overlay',
        modelId: 'test', allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'alice', createdAt: now, updatedAt: now })
      await ctx.db.patch(f.args.conversationId, { agentId: 'agent' })
    })
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).not.toBeNull()
    await f.t.run(async ctx => {
      const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', 'agent')).unique()
      await ctx.db.patch(agent!._id, { archivedAt: now })
    })
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    await f.t.run(ctx => ctx.db.patch(f.args.conversationId, { agentId: undefined }))
    await f.t.run(async ctx => {
      const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', 'alice')).unique()
      await ctx.db.patch(membership!._id, { status: 'suspended' })
    })
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    await f.t.run(async ctx => {
      const policy = await ctx.db.query('nativeDeploymentPolicies').unique()
      await ctx.db.patch(policy!._id, { snapshot: { ...policy!.snapshot!, features: { chat: false } } })
    })
    expect(await f.bob.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    await expect(f.bob.mutation(api.collaboration.nativeRooms.createChannel, { workspaceId, name: 'Denied', visibility: 'private' })).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  })

  test('empty rooms, missing anchors, deleted roots, page size clamp and DTO limits', async () => {
    const f = await fixture()
    expect(await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, paginationOpts: { ...pages, numItems: 0 } })).toMatchObject({ page: [], isDone: true })
    const root = await f.message('root')
    await f.t.run(ctx => ctx.db.patch(root, { deletedAt: now }))
    expect(await f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, { ...f.args, messageId: root })).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, threadRootMessageId: root, paginationOpts: pages })).toBeNull()
    const huge = await f.message('huge')
    await f.t.run(ctx => ctx.db.patch(huge, { content: 'x'.repeat(64_001) }))
    await expect(f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, { ...f.args, messageId: huge })).rejects.toThrow('ROOM_MESSAGE_LIMIT_EXCEEDED')
    await expect(f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: Array(200).fill('bob') })).rejects.toThrow('ROOM_RELATED_LIMIT_EXCEEDED')
  })

  test('revoked capabilities and oversized related traversals fail closed', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      const role = await ctx.db.query('authorizationRoles').unique()
      await ctx.db.patch(role!._id, { capabilities: [] })
    })
    expect(await f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    await f.t.run(async ctx => {
      const role = await ctx.db.query('authorizationRoles').unique()
      await ctx.db.patch(role!._id, { capabilities: ['conversations.read'] })
      for (let i = 0; i < 200; i++) await ctx.db.insert('conversationParticipants', { ...f.args, principalId: `extra-${i}`, principalType: 'human', role: 'member',
        status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    })
    await expect(f.alice.query(api.collaboration.nativeRooms.getRoom, f.args)).rejects.toThrow('ROOM_RELATED_LIMIT_EXCEEDED')
    const messageId = await f.message('too-many-chunks')
    await f.t.run(ctx => ctx.db.patch(messageId, { remoteTextStored: { contentSource: 'parts', chunks: 201 } }))
    await expect(f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, { ...f.args, messageId })).rejects.toThrow('ROOM_RELATED_LIMIT_EXCEEDED')
  })
})

describe('native room pagination and anchors', () => {
  test('equal-createdAt pages lose no main messages; thread and main pages stay separate', async () => {
    const f = await fixture()
    const ids = await Promise.all(Array.from({ length: 7 }, (_, i) => f.message(`message-${i}`)))
    await f.message('reply', ids[0])
    const seen: string[] = []
    let cursor: string | null = null
    for (let n = 0; n < 10; n++) {
      const page = await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, paginationOpts: { numItems: 2, cursor } })
      seen.push(...page!.page.map(row => row.id))
      if (page!.isDone) break
      cursor = page!.continueCursor
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen)).toEqual(new Set(ids))
    const clamped = await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, paginationOpts: { ...pages, numItems: 0 } })
    expect(clamped!.page).toHaveLength(1)
  })

  test('root and reply older than 500 main messages still load; foreign and nested roots rejected', async () => {
    const f = await fixture()
    const root = await f.message('old-root', undefined, 'alice', 1)
    const reply = await f.message('old-reply', root, 'alice', 2)
    await f.t.run(async ctx => {
      for (let i = 0; i < 510; i++) await ctx.db.insert('conversationMessages', { conversationId: f.args.conversationId,
        userId: 'alice', authorKind: 'human', authorPrincipalId: 'alice', role: 'user', mode: 'act', contentType: 'text', content: 'recent', turnId: `recent-${i}`, createdAt: now })
    })
    const thread = await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, threadRootMessageId: root, paginationOpts: pages })
    expect(thread!.page.map(row => row.id)).toEqual([reply])
    expect(await f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, { ...f.args, messageId: reply })).toMatchObject({ message: { id: reply }, threadRootMessageId: root })
    const foreign = await f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['eve'] })
    expect(await f.alice.query(api.collaboration.nativeRooms.listMessages, { conversationId: foreign.conversationId, workspaceId, threadRootMessageId: root, paginationOpts: pages })).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, { workspaceId, conversationId: foreign.conversationId, messageId: root })).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRooms.listMessages, { ...f.args, threadRootMessageId: reply, paginationOpts: pages })).toBeNull()
  })

  test('viewer-indexed room recency, archived and kind filters, with explicit old-row backfill', async () => {
    const f = await fixture()
    const channel = await f.alice.mutation(api.collaboration.nativeRooms.createChannel, { workspaceId, name: 'Private', principalIds: ['bob'], visibility: 'private' })
    const dm = await f.alice.query(api.collaboration.nativeRooms.listRooms, { workspaceId, kind: 'direct', archived: false, paginationOpts: { numItems: 100, cursor: null } })
    expect(dm.page.map(row => row.conversationId)).toEqual([f.args.conversationId])
    expect(await f.eve.query(api.collaboration.nativeRooms.getRoom, { workspaceId, ...channel })).toBeNull()
    await f.t.run(async ctx => {
      const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', f.args.conversationId).eq('principalId', 'alice')).unique()
      await ctx.db.patch(participant!._id, { archivedAt: now, roomLastModified: undefined })
    })
    await expect(f.alice.query(api.collaboration.nativeRooms.listRooms, { workspaceId, kind: 'direct', archived: true, paginationOpts: { numItems: 100, cursor: null } })).rejects.toThrow('ROOM_RECENCY_NOT_READY')
    await f.t.mutation(internal.collaboration.nativeRoomMaintenance.backfillRoomRecency, { workspaceId, paginationOpts: { numItems: 100, cursor: null } })
    const archived = await f.alice.query(api.collaboration.nativeRooms.listRooms, { workspaceId, kind: 'direct', archived: true, paginationOpts: { numItems: 100, cursor: null } })
    expect(archived.page.map(row => row.conversationId)).toEqual([f.args.conversationId])
    const room = await f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['bob'] })
    expect(room).toEqual({ conversationId: f.args.conversationId, created: false })
  })
})

test('native edit/delete use the legacy human-author policy and preserve file parts', async () => {
  const f = await fixture()
  const messageId = await f.message('original')
  const args = { ...f.args, messageId }
  await f.t.run(ctx => ctx.db.patch(messageId, { parts: [{ type: 'text', text: 'original' }, { type: 'file', url: 'https://example.test/file', mediaType: 'image/png' }] }))
  expect(await f.bob.mutation(api.collaboration.nativeRooms.editMessage, { ...args, content: 'stolen' })).toBe(false)
  expect(await f.bob.mutation(api.collaboration.nativeRooms.deleteMessage, args)).toBe(false)
  await expect(f.alice.mutation(api.collaboration.nativeRooms.editMessage, { ...args, content: '   ' })).rejects.toThrow('Message content is required')
  expect(await f.alice.mutation(api.collaboration.nativeRooms.editMessage, { ...args, content: 'updated' })).toBe(true)
  const anchor = await f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, args)
  expect(anchor!.message.content).toBe('updated')
  expect(JSON.parse(anchor!.message.partsJson)).toHaveLength(2)
  expect(await f.alice.mutation(api.collaboration.nativeRooms.deleteMessage, args)).toBe(true)
  expect(await f.alice.mutation(api.collaboration.nativeRooms.deleteMessage, args)).toBe(false)
  expect(await f.alice.query(api.collaboration.nativeRooms.getMessageAnchor, args)).toBeNull()
})

test('canonical send replay has one message and fanout, and retry completes missing activity', async () => {
  const f = await fixture()
  const send = { ...f.args, actorUserId: 'alice', serverSecret: secret, clientNonce: 'nonce', turnId: 'turn', content: '@bob hi', mentionedPrincipalIds: ['bob'] }
  const first = await f.t.mutation(api.collaboration.directMessages.addMessage, send)
  expect(first.replayed).toBe(false)
  await f.t.run(ctx => ctx.db.patch(first.messageId, { content: 'later edit' }))
  const replay = await f.t.mutation(api.collaboration.directMessages.addMessage, { ...send, content: 'changed', turnId: 'different', mentionedPrincipalIds: ['eve'] })
  expect(replay).toMatchObject({ messageId: first.messageId, replayed: true, content: send.content, turnId: 'turn', mentionedPrincipalIds: ['bob'] })
  const activity = { ...f.args, actorUserId: 'alice', serverSecret: secret, messageId: replay.messageId, mentionedPrincipalIds: ['eve'] }
  await f.t.mutation(api.collaboration.directMessages.recordMessageActivity, activity)
  await f.t.mutation(api.collaboration.directMessages.recordMessageActivity, activity)
  const rows = await f.t.run(async ctx => ({ messages: await ctx.db.query('conversationMessages').collect(), activity: await ctx.db.query('workspaceNotifications').collect() }))
  expect(rows.messages).toHaveLength(1)
  const activityRows = rows.activity.filter(row => row.messageId === first.messageId)
  expect(activityRows).toHaveLength(1)
  expect(activityRows[0].recipientPrincipalId).toBe('bob')
  expect(activityRows[0].body).toBe(send.content)
  expect((await f.t.mutation(api.collaboration.directMessages.addMessage, { ...send, clientNonce: 'different-nonce' })).messageId).toBe(first.messageId)
})

test('agent starts dedupe by canonical source and agent; queued dispatch is recoverable, terminal dispatch is not restarted', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: 'agent-p', type: 'agent', agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('conversationParticipants', { ...f.args, principalId: 'agent-p', principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
  })
  const userMessageId = await f.message('source')
  const args = { ...f.args, actorUserId: 'alice', serverSecret: secret, agentId: 'agent', authorPrincipalId: 'agent-p', userMessageId, executionEngine: 'overlay_harness' as const,
    clientNonce: 'agent-nonce', turnId: 'agent-turn', modelId: 'test' }
  const first = await f.t.mutation(api.collaboration.directMessages.startAgentTurn, args)
  const replay = await f.t.mutation(api.collaboration.directMessages.startAgentTurn, { ...args, turnId: 'other-turn', clientNonce: 'other-nonce' })
  expect(replay).toEqual({ ...first, resumed: true, dispatchNeeded: true })
  await f.t.run(ctx => ctx.db.patch(first.runId, { status: 'running', workflowRunId: 'workflow' }))
  await f.t.mutation(api.collaboration.directMessages.recordAgentStartFailure, { ...f.args, actorUserId: 'alice', serverSecret: secret,
    authorPrincipalId: 'agent-p', clientNonce: args.clientNonce, turnId: args.turnId, modelId: 'test', content: 'late failure' })
  expect((await f.t.run(ctx => ctx.db.get(first.messageId)))?.status).toBe('generating')
  await f.t.run(ctx => ctx.db.patch(first.runId, { status: 'completed' }))
  expect(await f.t.mutation(api.collaboration.directMessages.startAgentTurn, args)).toMatchObject({ dispatchNeeded: false, runId: first.runId })
  expect(await f.t.run(ctx => ctx.db.query('conversationAgentRuns').collect())).toHaveLength(1)
})

test.each([false, true])('losing launch failure cannot corrupt an admitted harness before delivery binding (claimed=%s)', async claimed => {
  const f = await fixture()
  await f.t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: 'agent-p', type: 'agent', agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('conversationParticipants', { ...f.args, principalId: 'agent-p', principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
  })
  const userMessageId = await f.message('source')
  const args = { ...f.args, actorUserId: 'alice', serverSecret: secret, agentId: 'agent', authorPrincipalId: 'agent-p', userMessageId, executionEngine: 'overlay_harness' as const, clientNonce: 'launch', turnId: 'launch', modelId: 'test' }
  const turn = await f.t.mutation(api.collaboration.directMessages.startAgentTurn, args)
  expect(await f.t.mutation(api.collaboration.directMessages.startAgentTurn, args)).toMatchObject({ runId: turn.runId, dispatchNeeded: true })
  const runId = `workspace:${turn.runId}`
  await f.t.run(ctx => ctx.db.insert('workspaceAgentDefinitions', { agentId: 'agent', workspaceId, principalId: 'agent-p', name: 'Agent', instructions: '', harness: 'overlay', modelId: 'test', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'alice', createdAt: now, updatedAt: now }))
  const admitted = await f.t.mutation(api.harness.runs.admit, { runId, source: { conversationId: String(f.args.conversationId) }, goal: 'Help', constraints: [], policy: { actorUserId: 'alice', workspaceId, allowedToolIds: [], requiresPlan: false, deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2 }, deliveryAgentRunId: String(turn.runId), serverSecret: secret })
  if (claimed) await f.t.mutation(api.harness.runs.apply, { actorUserId: 'alice', runId, operationId: 'winner-claim', expectedRevision: admitted.revision, operation: { type: 'claim_execution', workflowRunId: 'winner' }, serverSecret: secret })
  const queued = await f.t.run(ctx => ctx.db.get(turn.runId))
  expect(queued).toMatchObject({ status: 'queued', harnessRunId: runId })
  expect(queued?.workflowRunId).toBeUndefined()
  await f.t.mutation(api.collaboration.directMessages.recordAgentStartFailure, { ...f.args, actorUserId: 'alice', serverSecret: secret, authorPrincipalId: 'agent-p', clientNonce: args.clientNonce, turnId: args.turnId, modelId: 'test', content: 'loser failed' })
  expect(await f.t.run(ctx => ctx.db.get(turn.messageId))).toMatchObject({ status: 'generating', content: '' })
  expect((await f.t.run(ctx => ctx.db.query('conversationEvents').collect())).filter(row => row.type === 'message.failed')).toEqual([])
})
