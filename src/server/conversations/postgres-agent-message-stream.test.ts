import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { agentRuns, users } from '@/server/database/postgres/schema'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { PostgresWorkspaceAgentRepository } from '@/server/agents/PostgresWorkspaceAgentRepository'
import { PostgresActConversationRepository } from './PostgresActConversationRepository'
import { PostgresConversationCollaborationRepository } from './PostgresConversationCollaborationRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

/**
 * The durability contract for a room agent reply: it exists in the transcript
 * from the first token, every reader sees it grow, and it reaches a terminal
 * state exactly once no matter how the turn ends.
 */
test('Postgres agent replies stream into a durable transcript row', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `agentstream_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const workspaceId = `${scope}_workspace`
  const ownerPrincipalId = `${scope}_owner`
  const agentId = `${scope}_definition`
  const agentPrincipalId = `${scope}_agent_principal`
  const workspacesRepository = new PostgresWorkspaceRepository(db)
  const agents = new PostgresWorkspaceAgentRepository(db)
  const collaboration = new PostgresConversationCollaborationRepository(db)
  const conversations = new PostgresActConversationRepository(db)

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })
    await workspacesRepository.createOrganization({
      workspaceId,
      ownerPrincipalId,
      actorUserId: userId,
      ownerDisplayName: 'Owner',
      name: 'Agent streaming',
      slug: workspaceId,
      now: 100,
    })
    await agents.create({
      agentId,
      principalId: agentPrincipalId,
      workspaceId,
      name: 'Scout',
      description: 'Finds evidence',
      instructions: 'Find primary evidence and cite it.',
      harness: 'overlay',
      modelId: 'openrouter/free',
      avatarColor: '#2563eb',
      allowedToolIds: [],
      teamIds: [],
      createdByPrincipalId: ownerPrincipalId,
      now: 120,
    })
    const channel = await collaboration.createChannel({
      actorUserId: userId,
      workspaceId,
      name: 'Research',
      visibility: 'public',
    })
    await collaboration.addParticipant({
      actorUserId: userId,
      conversationId: channel.conversationId,
      principalId: agentPrincipalId,
      workspaceId,
    })

    const clientNonce = `agent:${scope}_message:${agentId}`
    const openArgs = {
      actorUserId: userId,
      authorPrincipalId: agentPrincipalId,
      clientNonce,
      conversationId: channel.conversationId,
      modelId: 'openrouter/free',
      turnId: `agent_${scope}_message_${agentId}`,
      workspaceId,
    }
    const messageId = await collaboration.startAgentMessage(openArgs)

    const readRow = async () => (await collaboration.listMessages({
      actorUserId: userId,
      workspaceId,
      conversationId: channel.conversationId,
      limit: 100,
    })).find((message) => message._id === messageId)

    // A reader who arrives mid-turn — a reload, or anyone else in the channel —
    // sees the reply already in the transcript and marked as still arriving.
    const opened = await readRow()
    assert.equal(opened?.status, 'generating')
    assert.equal(opened?.authorKind, 'agent')
    assert.equal(opened?.content, '')

    // Re-opening the same turn reuses the row, so a retry cannot post twice.
    assert.equal(await collaboration.startAgentMessage(openArgs), messageId)

    const appendArgs = {
      actorUserId: userId,
      conversationId: channel.conversationId,
      messageId,
      workspaceId,
    }
    await collaboration.appendAgentMessageDelta({ ...appendArgs, contentDelta: 'Looking' })
    await collaboration.appendAgentMessageDelta({
      ...appendArgs,
      contentDelta: ' into it',
      emitEvent: true,
      parts: [{ type: 'tool-invocation', toolInvocation: { toolName: 'web_search' } }],
    })

    const growing = await readRow()
    assert.equal(growing?.content, 'Looking into it')
    assert.equal(growing?.status, 'generating')
    assert.deepEqual(growing?.parts, [
      { type: 'tool-invocation', toolInvocation: { toolName: 'web_search' } },
    ])

    await collaboration.finalizeAgentMessage({
      ...appendArgs,
      content: 'Looking into it — here is what I found.',
      parts: [{ type: 'text', text: 'Looking into it — here is what I found.' }],
      tokens: { input: 120, output: 40 },
    })

    const completed = await readRow()
    assert.equal(completed?.status, 'completed')
    assert.equal(completed?.content, 'Looking into it — here is what I found.')
    assert.deepEqual(completed?.tokens, { input: 120, output: 40 })

    // A straggling flush after the turn ends must not reopen a finished reply.
    await collaboration.appendAgentMessageDelta({ ...appendArgs, contentDelta: ' and more' })
    await collaboration.failAgentMessage({ ...appendArgs, content: 'clobbered' })
    const settled = await readRow()
    assert.equal(settled?.status, 'completed')
    assert.equal(settled?.content, 'Looking into it — here is what I found.')

    // A turn that dies partway keeps whatever text arrived rather than
    // vanishing, and stops rendering as a reply that never lands.
    const failingNonce = `${clientNonce}:retry`
    const failingId = await collaboration.startAgentMessage({ ...openArgs, clientNonce: failingNonce })
    await collaboration.appendAgentMessageDelta({
      ...appendArgs,
      messageId: failingId,
      contentDelta: 'I started to',
    })
    await collaboration.failAgentMessage({ ...appendArgs, messageId: failingId })
    const failed = (await collaboration.listMessages({
      actorUserId: userId,
      workspaceId,
      conversationId: channel.conversationId,
      limit: 100,
    })).find((message) => message._id === failingId)
    assert.equal(failed?.status, 'error')
    assert.equal(failed?.content, 'I started to')

    // A durable turn opens the reply row and the run that owns it together, so
    // the turn is visible and resumable before the model is ever called.
    const turnNonce = `${clientNonce}:durable`
    const turn = await collaboration.startAgentTurn({
      ...openArgs,
      agentId,
      clientNonce: turnNonce,
      turnId: `${openArgs.turnId}_durable`,
      userMessageId: messageId,
    })
    assert.equal(turn.resumed, false)
    const [runRow] = await db.select().from(agentRuns).where(eq(agentRuns.id, turn.runId))
    assert.equal(runRow?.mode, 'room')
    assert.equal(runRow?.runner, 'workflow')
    assert.equal(runRow?.status, 'queued')
    assert.equal(runRow?.agentId, agentId)
    assert.equal(runRow?.agentPrincipalId, agentPrincipalId)
    assert.equal(runRow?.assistantMessageId, turn.messageId)
    // Without a lease the sweep could never tell an abandoned turn from a slow
    // one, and the reply would stay generating forever.
    assert.ok(runRow?.leaseExpiresAt)

    // Progress writes are what keep a reloaded turn from showing an empty
    // bubble. Absolute content, and only while the run and its row are live.
    const readTurnRow = async () => (await collaboration.listMessages({
      actorUserId: userId,
      workspaceId,
      conversationId: channel.conversationId,
      limit: 100,
    })).find((message) => message._id === turn.messageId)
    await conversations.recordAgentRunProgress({
      content: 'partial answer so far',
      runId: turn.runId,
      userId,
    })
    assert.equal((await readTurnRow())?.content, 'partial answer so far')
    await conversations.recordAgentRunProgress({
      content: 'partial answer so far, extended',
      runId: turn.runId,
      userId,
    })
    assert.equal((await readTurnRow())?.content, 'partial answer so far, extended')

    // A settled row must not be reopened by a straggling progress write.
    await collaboration.failAgentMessage({ ...appendArgs, messageId: turn.messageId })
    await conversations.recordAgentRunProgress({
      content: 'too late',
      runId: turn.runId,
      userId,
    })
    assert.notEqual((await readTurnRow())?.content, 'too late')

    // A duplicate trigger must recover the same turn rather than opening a
    // second run against the same reply.
    const again = await collaboration.startAgentTurn({
      ...openArgs,
      agentId,
      clientNonce: turnNonce,
      turnId: `${openArgs.turnId}_durable`,
      userMessageId: messageId,
    })
    assert.equal(again.resumed, true)
    assert.equal(again.runId, turn.runId)
    assert.equal(again.messageId, turn.messageId)

    // A finished agent reply must raise activity the same way a teammate's
    // message does, or an answer that lands while you are looking elsewhere is
    // one you never learn about.
    const notifications = await collaboration.listNotifications({
      actorUserId: userId,
      workspaceId,
    })
    const agentNotification = notifications.find((row) => row.messageId === messageId)
    assert.ok(agentNotification, 'the finished agent reply should have raised a notification')
    assert.equal(agentNotification.type, 'message')
    assert.equal(agentNotification.actorPrincipalId, agentPrincipalId)
    assert.match(agentNotification.title, /Scout/)
    // The agent authored it, so it must not notify itself.
    assert.equal(
      notifications.some((row) => row.recipientPrincipalId === agentPrincipalId),
      false,
    )
    // A reply that failed never finished generating, so it raises nothing.
    assert.equal(notifications.some((row) => row.messageId === failingId), false)

    // The polling transcript learns about the turn without refetching on every
    // single write: one event to open it, one throttled delta, one to close it.
    const events = await collaboration.listConversationEvents({
      actorUserId: userId,
      afterSequence: 0,
      limit: 200,
      workspaceId,
    })
    const forTurn = events.filter((event) => event.messageId === messageId)
    assert.deepEqual(forTurn.map((event) => event.type), [
      'message.created',
      'message.delta',
      'message.completed',
    ])
  } finally {
    await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`).catch(() => undefined)
    await db.delete(users).where(inArray(users.id, [userId])).catch(() => undefined)
    await pool.end()
  }
})
