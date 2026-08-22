import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { ConvexWorkspaceAgentRepository } from '@/server/agents/ConvexWorkspaceAgentRepository'
import { ConvexActConversationRepository } from './ConvexActConversationRepository'
import { ConvexConversationCollaborationRepository } from './ConvexConversationCollaborationRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

/**
 * The Convex half of the durable agent turn contract, mirroring
 * `postgres-agent-message-stream.test.ts`. Deploying validates the schema and
 * types but never executes a mutation, so without this nothing proves the
 * streaming writes, the idempotency, or the terminal-state guards actually run.
 */
test('Convex agent replies stream into a durable transcript row', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async () => {
  const workspaces = new ConvexWorkspaceRepository()
  const agents = new ConvexWorkspaceAgentRepository()
  const collaboration = new ConvexConversationCollaborationRepository()
  const scope = `agentstream_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const personalWorkspaceId = `${scope}_personal`
  const workspaceId = `${scope}_org`
  const ownerPrincipalId = `${scope}_owner_principal`
  const agentId = `${scope}_definition`
  const agentPrincipalId = `${scope}_agent_principal`
  let archived = false

  try {
    await workspaces.ensurePersonalWorkspace({
      workspaceId: personalWorkspaceId,
      slug: personalWorkspaceId,
      principalId: `${scope}_personal_principal`,
      userId: ownerUserId,
      displayName: 'Owner',
      email: `${ownerUserId}@example.com`,
      now: 100,
    })
    await workspaces.createOrganization({
      workspaceId,
      ownerPrincipalId,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: 'Agent streaming',
      slug: workspaceId,
      now: 200,
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
      now: 220,
    })
    const channel = await collaboration.createChannel({
      actorUserId: ownerUserId,
      workspaceId,
      name: 'Research',
      visibility: 'public',
    })
    await collaboration.addParticipant({
      actorUserId: ownerUserId,
      conversationId: channel.conversationId,
      principalId: agentPrincipalId,
      workspaceId,
    })
    const humanMessageId = await collaboration.addMessage({
      actorUserId: ownerUserId,
      conversationId: channel.conversationId,
      content: '@Scout what do we know?',
      turnId: `${scope}_human_turn`,
      workspaceId,
    })

    const clientNonce = `agent:${humanMessageId}:${agentId}`
    const openArgs = {
      actorUserId: ownerUserId,
      authorPrincipalId: agentPrincipalId,
      clientNonce,
      conversationId: channel.conversationId,
      modelId: 'openrouter/free',
      turnId: `agent_${humanMessageId}_${agentId}`,
      workspaceId,
    }
    const messageId = await collaboration.startAgentMessage(openArgs)

    const readRow = async (id: string) => (await collaboration.listMessages({
      actorUserId: ownerUserId,
      workspaceId,
      conversationId: channel.conversationId,
      limit: 100,
    })).find((message) => message._id === id)

    const opened = await readRow(messageId)
    assert.equal(opened?.status, 'generating')
    assert.equal(opened?.authorKind, 'agent')
    assert.equal(opened?.content, '')

    assert.equal(await collaboration.startAgentMessage(openArgs), messageId)

    const appendArgs = {
      actorUserId: ownerUserId,
      conversationId: channel.conversationId,
      messageId,
      workspaceId,
    }
    await collaboration.appendAgentMessageDelta({ ...appendArgs, contentDelta: 'Looking' })
    // Tool parts are the shape most likely to be rejected by the schema's
    // discriminated union, which nothing but a real write would catch.
    await collaboration.appendAgentMessageDelta({
      ...appendArgs,
      contentDelta: ' into it',
      emitEvent: true,
      parts: [
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'call_1', toolName: 'web_search', state: 'output-available', toolOutput: { ok: true } } },
        { type: 'reasoning', state: 'done', text: 'checking sources' },
      ],
    })

    const growing = await readRow(messageId)
    assert.equal(growing?.content, 'Looking into it')
    assert.equal(growing?.status, 'generating')
    assert.equal(growing?.parts?.length, 2)

    await collaboration.finalizeAgentMessage({
      ...appendArgs,
      content: 'Looking into it — here is what I found.',
      parts: [{ type: 'text', text: 'Looking into it — here is what I found.' }],
      tokens: { input: 120, output: 40 },
    })
    const completed = await readRow(messageId)
    assert.equal(completed?.status, 'completed')
    assert.equal(completed?.content, 'Looking into it — here is what I found.')
    assert.deepEqual(completed?.tokens, { input: 120, output: 40 })

    // A straggling flush after the turn ends must not reopen a finished reply.
    await collaboration.appendAgentMessageDelta({ ...appendArgs, contentDelta: ' and more' })
    await collaboration.failAgentMessage({ ...appendArgs, content: 'clobbered' })
    const settled = await readRow(messageId)
    assert.equal(settled?.status, 'completed')
    assert.equal(settled?.content, 'Looking into it — here is what I found.')

    // A durable turn opens the reply row and the run that owns it together.
    const turnNonce = `${clientNonce}:durable`
    const turn = await collaboration.startAgentTurn({
      ...openArgs,
      agentId,
      clientNonce: turnNonce,
      turnId: `${openArgs.turnId}_durable`,
      userMessageId: humanMessageId,
    })
    assert.equal(turn.resumed, false)
    const turnRow = await readRow(turn.messageId)
    assert.equal(turnRow?.status, 'generating')
    assert.equal(turnRow?.authorKind, 'agent')

    const again = await collaboration.startAgentTurn({
      ...openArgs,
      agentId,
      clientNonce: turnNonce,
      turnId: `${openArgs.turnId}_durable`,
      userMessageId: humanMessageId,
    })
    assert.equal(again.resumed, true)
    assert.equal(again.runId, turn.runId)
    assert.equal(again.messageId, turn.messageId)

    // The run-lifecycle mutations are pre-existing, but a `room`-mode run is new
    // territory for them: the transition assertions and the assistant-message
    // patch have only ever seen runs authored by the conversation owner.
    const conversations = new ConvexActConversationRepository()
    const attached = await conversations.attachAgentRunWorkflow({
      runId: turn.runId,
      userId: ownerUserId,
      workflowRunId: `wf_${scope}`,
    })
    assert.equal(attached?.status, 'running')
    assert.equal(attached?.mode, 'room')
    assert.equal(attached?.agentId, agentId)
    assert.equal(attached?.agentPrincipalId, agentPrincipalId)

    await collaboration.appendAgentMessageDelta({
      ...appendArgs,
      messageId: turn.messageId,
      contentDelta: 'I started to',
    })
    const finishedRun = await conversations.completeAgentRun({
      content: 'I started to look and here is the answer.',
      parts: [{ type: 'text', text: 'I started to look and here is the answer.' }],
      runId: turn.runId,
      tokens: { input: 10, output: 20 },
      userId: ownerUserId,
    })
    assert.equal(finishedRun?.status, 'completed')
    assert.ok(finishedRun?.completedAt)
    assert.equal((await readRow(turn.messageId))?.status, 'completed')

    // A turn that dies partway keeps whatever text arrived. Settling the reply
    // row first is what preserves it: `failAgentRun` only rewrites a row that
    // is still generating.
    const failingNonce = `${clientNonce}:failing`
    const failing = await collaboration.startAgentTurn({
      ...openArgs,
      agentId,
      clientNonce: failingNonce,
      turnId: `${openArgs.turnId}_failing`,
      userMessageId: humanMessageId,
    })
    await collaboration.appendAgentMessageDelta({
      ...appendArgs,
      messageId: failing.messageId,
      contentDelta: 'I started to',
    })
    await collaboration.failAgentMessage({ ...appendArgs, messageId: failing.messageId })
    const failedRun = await conversations.failAgentRun({
      error: { code: 'model_failed', message: 'boom', retryable: true },
      errorText: 'boom',
      runId: failing.runId,
      userId: ownerUserId,
    })
    assert.equal(failedRun?.status, 'failed')
    const failed = await readRow(failing.messageId)
    assert.equal(failed?.status, 'error')
    assert.equal(failed?.content, 'I started to')

    const events = await collaboration.listConversationEvents({
      actorUserId: ownerUserId,
      afterSequence: 0,
      limit: 200,
      workspaceId,
    })
    assert.deepEqual(
      events.filter((event) => event.messageId === messageId).map((event) => event.type),
      ['message.created', 'message.delta', 'message.completed'],
    )
  } finally {
    await workspaces.archiveWorkspace({
      workspaceId,
      archivedByPrincipalId: ownerPrincipalId,
      now: Date.now(),
    }).then(() => { archived = true }).catch(() => undefined)
    if (archived) {
      await convex.mutation(
        'collaboration/workspaces:purgeArchivedWorkspaceByServer',
        { serverSecret: getInternalApiSecret(), workspaceId },
        { throwOnError: true },
      ).catch(() => undefined)
    }
    await convex.mutation(
      'auth/users:deleteUserAccountByServer',
      { serverSecret: getInternalApiSecret(), userId: ownerUserId },
      { throwOnError: true },
    ).catch(() => undefined)
  }
})
