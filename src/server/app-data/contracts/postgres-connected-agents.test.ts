import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { and, eq } from 'drizzle-orm'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
import { PostgresConnectedAgentRepository } from '@/server/agents/PostgresConnectedAgentRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  agentRemoteSessions,
  agentRunCommands,
  agentRuns,
  conversationEvents,
  conversationMessages,
  conversationParticipants,
  conversations,
  users,
  workspaceMemberships,
  workspacePrincipals,
  workspaces,
} from '@/server/database/postgres/schema'
import { verifyConnectedAgentRepositoryContract } from '@/shared/agents/connected-agent-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres connected-agent provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres connected-agent contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({ connectionString, sslMode: process.env.OVERLAY_DATABASE_SSL_MODE })
  const db = createOverlayPostgresDb(pool)
  const suffix = randomUUID()
  const userId = `connected_user_${suffix}`
  const workspaceId = `connected_workspace_${suffix}`
  const otherWorkspaceId = `connected_other_workspace_${suffix}`
  const conversationId = `connected_conversation_${suffix}`
  const creatorPrincipalId = `connected_creator_principal_${suffix}`
  const userMessageId = `connected_user_message_${suffix}`
  const assistantMessageId = `connected_assistant_message_${suffix}`
  const runId = `connected_run_${suffix}`
  const contractPrefix = `postgres_${suffix}`
  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
    await db.insert(workspaces).values([
      { id: workspaceId, kind: 'organization', name: 'Connected contract', slug: `connected-${suffix}` },
      { id: otherWorkspaceId, kind: 'organization', name: 'Foreign contract', slug: `connected-other-${suffix}` },
    ])
    await db.insert(workspacePrincipals).values({
      id: creatorPrincipalId, workspaceId, type: 'human', userId, displayName: 'Contract creator',
    })
    await db.insert(conversations).values({
      id: conversationId, userId, title: 'Connected agent contract', lastMode: 'act',
      askModelIds: [], actModelId: 'openrouter/free', workspaceId, createdByPrincipalId: creatorPrincipalId,
    })
    await db.insert(conversationMessages).values([
      { id: userMessageId, conversationId, userId, turnId: `turn_${suffix}`, role: 'user', mode: 'act', content: 'Run', contentType: 'text', authorKind: 'human', authorPrincipalId: creatorPrincipalId },
      { id: assistantMessageId, conversationId, userId, turnId: `turn_${suffix}`, role: 'assistant', mode: 'act', content: '', contentType: 'text', authorKind: 'model' },
    ])
    await db.insert(agentRuns).values({
      id: runId, conversationId, turnId: `turn_${suffix}`, userId, userMessageId, assistantMessageId,
      mode: 'room', runner: 'remote', status: 'queued', environmentId: `${contractPrefix}_environment`,
    })
    await verifyConnectedAgentRepositoryContract({
      repository: new PostgresConnectedAgentRepository(db), prefix: contractPrefix,
      workspaceId, otherWorkspaceId, runId,
    })
  } finally {
    await db.delete(agentRuns).where(eq(agentRuns.id, runId))
    await db.delete(conversations).where(eq(conversations.id, conversationId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId))
    await db.delete(users).where(eq(users.id, userId))
    await pool.end()
  }
})

test('Postgres remote room turn is atomic, resumable, and projects terminal events once', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres connected-agent contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({ connectionString, sslMode: process.env.OVERLAY_DATABASE_SSL_MODE })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresConnectedAgentRepository(db)
  const suffix = randomUUID()
  const now = Date.now()
  const userId = `remote_user_${suffix}`
  const workspaceId = `remote_workspace_${suffix}`
  const conversationId = `remote_conversation_${suffix}`
  const actorPrincipalId = `remote_human_principal_${suffix}`
  const agentPrincipalId = `remote_agent_principal_${suffix}`
  const agentId = `remote_agent_${suffix}`
  const environmentId = `remote_environment_${suffix}`
  const bindingId = `remote_binding_${suffix}`
  const userMessageId = `remote_user_message_${suffix}`
  const runId = `remote_run_${suffix}`
  const sessionId = `remote_session_${suffix}`
  const commandId = `remote_command_${suffix}`
  const turnId = `remote_turn_${suffix}`
  const clientNonce = `remote_nonce_${suffix}`
  const queueExpiresAt = now + 60_000
  const startInput = {
    actorUserId: userId,
    agentId,
    authorPrincipalId: agentPrincipalId,
    bindingId,
    clientNonce,
    commandId,
    conversationId,
    environmentId,
    environmentName: 'untrusted environment name',
    environmentOnline: true,
    initiatorPrincipalId: actorPrincipalId,
    modelId: 'openrouter/free',
    modelUsageBilling: 'byok',
    maxConcurrentRuns: 10,
    maxRunTimeMs: 30 * 60_000,
    prompt: 'Do the work',
    queueExpiresAt,
    reservationId: null,
    runId,
    sessionId,
    startPayload: {
      bindingId,
      adapterId: 'codex',
      workingDirectory: '/repo',
      prompt: 'Do the work',
      metadata: { conversationId, messageId: userMessageId, initiatorPrincipalId: actorPrincipalId },
    },
    turnId,
    userMessageId,
    workspaceId,
    now,
  } as const

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
    await db.insert(workspaces).values({ id: workspaceId, kind: 'organization', name: 'Remote room', slug: `remote-${suffix}` })
    await db.insert(workspacePrincipals).values([
      { id: actorPrincipalId, workspaceId, type: 'human', userId, displayName: 'Human' },
      { id: agentPrincipalId, workspaceId, type: 'agent', agentId, displayName: 'Connected agent' },
    ])
    await db.insert(workspaceMemberships).values({
      workspaceId, principalId: actorPrincipalId, role: 'owner', status: 'active',
    })
    await db.insert(conversations).values({
      id: conversationId, userId, title: 'Remote room', lastMode: 'act', askModelIds: [],
      actModelId: 'openrouter/free', workspaceId, conversationType: 'dm', createdByPrincipalId: actorPrincipalId,
    })
    await db.insert(conversationParticipants).values([
      { conversationId, workspaceId, principalId: actorPrincipalId, principalType: 'human', role: 'member', status: 'active' },
      { conversationId, workspaceId, principalId: agentPrincipalId, principalType: 'agent', role: 'member', status: 'active' },
    ])
    await db.insert(conversationMessages).values({
      id: userMessageId, conversationId, userId, turnId, role: 'user', mode: 'act',
      content: '@Connected agent do the work', contentType: 'text', authorKind: 'human',
      authorPrincipalId: actorPrincipalId, status: 'completed',
    })
    await repository.createEnvironment({
      id: environmentId,
      workspaceId,
      kind: 'local',
      name: 'Offline Mac',
      status: 'offline',
      capabilities: { adapters: [{ id: 'codex', protocol: 'acp' }] },
      filesystemGrant: { mode: 'selected_roots', roots: ['/repo'] },
      approvedAt: now - 2_000,
      approvedByUserId: userId,
      lastSeenAt: now - 60_000,
      now,
    })
    await repository.upsertBinding({
      id: bindingId,
      workspaceId,
      agentId,
      environmentId,
      protocolAdapter: 'acp',
      adapterConfig: { adapterId: 'codex', workingDirectory: '/repo' },
      enabled: true,
      now,
    })

    await assert.rejects(
      () => repository.startRemoteAgentTurn({ ...startInput, initiatorPrincipalId: 'forged-principal' }),
      /CONVERSATION_ACCESS_DENIED/,
    )
    await assert.rejects(
      () => repository.startRemoteAgentTurn({
        ...startInput,
        startPayload: { text: 'x'.repeat(129 * 1024) },
      }),
      /AGENT_COMMAND_TOO_LARGE/,
    )

    const started = await repository.startRemoteAgentTurn(startInput)
    assert.equal(started.waiting, true)
    assert.equal(started.resumed, false)
    const duplicate = await repository.startRemoteAgentTurn({
      ...startInput,
      commandId: `${commandId}_duplicate`,
      runId: `${runId}_duplicate`,
      sessionId: `${sessionId}_duplicate`,
    })
    assert.equal(duplicate.resumed, true)
    assert.equal(duplicate.messageId, started.messageId)

    const [waitingMessage] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, started.messageId))
    assert.equal(waitingMessage?.content, 'Waiting for Offline Mac')
    assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.id, runId))).length, 1)
    assert.equal((await db.select().from(agentRunCommands).where(eq(agentRunCommands.runId, runId))).length, 1)

    assert.equal((await repository.claimCommands({
      workspaceId, environmentId, now: queueExpiresAt + 1, leaseMs: 5_000, limit: 10,
    })).length, 0)
    assert.deepEqual(await repository.controlRemoteAgentTurn({
      actorUserId: userId,
      conversationId,
      workspaceId,
      runId,
      action: 'retry',
      queueExpiresAt: queueExpiresAt + 120_000,
      now: queueExpiresAt + 2,
    }), { applied: true, messageId: started.messageId })
    assert.equal((await repository.claimCommands({
      workspaceId, environmentId, now: queueExpiresAt + 3, leaseMs: 5_000, limit: 10,
    })).length, 1)

    const requestEvents = [
      remoteEvent(1, 'session_started', { remoteSessionId: `acp_${suffix}` }),
      remoteEvent(2, 'approval_requested', { requestKey: 'permission-1', prompt: 'Write files?',
        options: [{ id: 'allow_once', label: 'Allow once' }, { id: 'reject', label: 'Reject' }], context: {} }),
    ]
    assert.equal((await repository.applyRemoteEvents({
      workspaceId,
      environmentId,
      sessionId,
      events: requestEvents.map((event) => ({ ...event, environmentId, runId })),
      now: queueExpiresAt + 4,
    })).accepted, true)
    assert.deepEqual(await repository.resolveRemoteRequest({ actorUserId: 'foreign-user', workspaceId,
      conversationId, runId, requestKey: 'permission-1', decision: 'allow_once', now: queueExpiresAt + 5 }), { applied: false })
    await assert.rejects(() => repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'permission-1', decision: 'forged', now: queueExpiresAt + 6 }),
    /AGENT_APPROVAL_OPTION_INVALID/)
    const approved = await repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'permission-1', decision: 'allow_once', now: queueExpiresAt + 7 })
    assert.equal(approved.applied, true)
    assert.deepEqual(await repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'permission-1', decision: 'allow_once', now: queueExpiresAt + 8 }),
    { applied: true, commandId: approved.commandId, messageId: started.messageId })
    await assert.rejects(() => repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'permission-1', decision: 'reject', now: queueExpiresAt + 8 }),
    /AGENT_REMOTE_REQUEST_ALREADY_RESOLVED/)
    assert.equal((await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId,
      events: [{ ...remoteEvent(3, 'elicitation_requested', { requestKey: 'input-1', prompt: 'Choose branch',
        requestedSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] }, context: {} }),
        environmentId, runId }], now: queueExpiresAt + 9 })).accepted, true)
    await assert.rejects(() => repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'input-1', decision: 'accept', response: {}, now: queueExpiresAt + 10 }),
    /AGENT_ELICITATION_RESPONSE_INVALID/)
    await assert.rejects(() => repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'input-1', decision: 'accept', response: { branch: 42 }, now: queueExpiresAt + 10 }),
    /AGENT_ELICITATION_RESPONSE_INVALID/)
    assert.equal((await repository.resolveRemoteRequest({ actorUserId: userId, workspaceId,
      conversationId, runId, requestKey: 'input-1', decision: 'accept', response: { branch: 'byo-agents' },
      now: queueExpiresAt + 11 })).applied, true)
    await repository.createArtifact({ id: `artifact_${suffix}`, workspaceId, environmentId, runId,
      remoteSessionId: sessionId, name: 'report.txt', mediaType: 'text/plain', size: 6,
      sha256: 'a'.repeat(64), objectKey: `scoped/${suffix}`, status: 'clean', scanResult: 'clean',
      expiresAt: queueExpiresAt + 60_000, createdAt: now, updatedAt: now })
    const events = [
      remoteEvent(4, 'text_checkpoint', { text: 'Work completed' }),
      remoteEvent(5, 'action', { actionId: 'shell', title: 'Run tests', status: 'completed' }),
      remoteEvent(6, 'plan', { entries: [{ id: 'step-1', title: 'Implement', status: 'completed' }] }),
      remoteEvent(7, 'diff', { diffId: 'diff-1', title: 'app.ts', patch: '+ready' }),
      remoteEvent(8, 'terminal', { terminalId: 'terminal-1', title: 'Tests', summary: 'Passed', status: 'completed', exitCode: 0 }),
      remoteEvent(9, 'artifact', { name: 'report.txt', mediaType: 'text/plain', size: 6,
        sha256: 'a'.repeat(64), uploadReference: `artifact_${suffix}` }),
      remoteEvent(10, 'completed', { summary: 'Done', usage: { inputTokens: 12, outputTokens: 7 } }),
    ]
    const accepted = await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId,
      events: events.map((event) => ({ ...event, environmentId, runId })), now: queueExpiresAt + 12 })
    assert.equal(accepted.accepted, true)
    if (!accepted.accepted) assert.fail('remote events should be accepted')
    assert.equal(accepted.duplicate, false)
    assert.equal(accepted.terminal?.inputTokens, 12)

    const eventCountBeforeDuplicate = (await db.select().from(conversationEvents).where(and(
      eq(conversationEvents.conversationId, conversationId),
      eq(conversationEvents.messageId, started.messageId),
    ))).length
    const duplicateEvents = await repository.applyRemoteEvents({
      workspaceId,
      environmentId,
      sessionId,
      events: events.map((event) => ({ ...event, environmentId, runId })),
      now: queueExpiresAt + 13,
    })
    assert.equal(duplicateEvents.accepted, true)
    if (!duplicateEvents.accepted) assert.fail('duplicate terminal events should be acknowledged')
    assert.equal(duplicateEvents.duplicate, true)

    const [message] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, started.messageId))
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId))
    const [session] = await db.select().from(agentRemoteSessions).where(eq(agentRemoteSessions.id, sessionId))
    const [command] = await db.select().from(agentRunCommands).where(eq(agentRunCommands.id, commandId))
    assert.equal(message?.content, 'Work completed')
    assert.equal(message?.status, 'completed')
    assert.deepEqual(message?.tokens, { input: 12, output: 7 })
    const partTypes = (message?.parts ?? []).map((part) => part.type)
    for (const type of ['data-remote-agent-request', 'data-remote-agent-plan', 'data-remote-agent-diff', 'data-remote-agent-terminal', 'file']) {
      assert.ok(partTypes.includes(type as never), `${type} should persist`)
    }
    assert.equal(run?.status, 'completed')
    assert.equal(session?.eventCursor, 10)
    assert.equal(command?.status, 'acknowledged')
    assert.equal((await db.select().from(conversationEvents).where(and(
      eq(conversationEvents.conversationId, conversationId),
      eq(conversationEvents.messageId, started.messageId),
    ))).length, eventCountBeforeDuplicate)

    const recoveryRunId = `${runId}_recovery`
    const recoverySessionId = `${sessionId}_recovery`
    const recoveryUserMessageId = `${userMessageId}_recovery`
    await db.insert(conversationMessages).values({ id: recoveryUserMessageId, conversationId, userId,
      turnId: `${turnId}_recovery`, role: 'user', mode: 'act', content: 'Resume this', contentType: 'text',
      authorKind: 'human', authorPrincipalId: actorPrincipalId, status: 'completed' })
    const recovery = await repository.startRemoteAgentTurn({ ...startInput, clientNonce: `${clientNonce}_recovery`,
      commandId: `${commandId}_recovery`, runId: recoveryRunId, sessionId: recoverySessionId,
      turnId: `${turnId}_recovery`, userMessageId: recoveryUserMessageId })
    await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId: recoverySessionId,
      events: [{ ...remoteEvent(1, 'session_started', { remoteSessionId: `resume_${suffix}`, adapterId: 'acp' }),
        environmentId, runId: recoveryRunId }], now: queueExpiresAt + 20 })
    assert.deepEqual((await repository.sweepRemoteRuns({ now: queueExpiresAt + 21,
      hostOfflineBefore: queueExpiresAt + 20, limit: 10 })).expiredRunIds, [recoveryRunId])
    const [recoveryMessage] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, recovery.messageId))
    assert.ok((recoveryMessage?.parts ?? []).some((part) => part.type === 'data-remote-agent-status'
      && part.data?.state === 'recoverable'))
    const resumed = await repository.controlRemoteAgentTurn({ actorUserId: userId, conversationId, workspaceId,
      runId: recoveryRunId, action: 'resume', queueExpiresAt: queueExpiresAt + 120_000, now: queueExpiresAt + 22 })
    assert.equal(resumed.applied, true)
    assert.equal((await db.select().from(agentRunCommands).where(eq(agentRunCommands.id, resumed.commandId!)))[0]?.type, 'reconnect')
    assert.equal((await repository.controlRemoteAgentTurn({ actorUserId: userId, conversationId, workspaceId,
      runId: recoveryRunId, action: 'cancel', queueExpiresAt: queueExpiresAt + 120_000,
      now: queueExpiresAt + 23 })).applied, true)
    const fresh = await repository.controlRemoteAgentTurn({ actorUserId: userId, conversationId, workspaceId,
      runId: recoveryRunId, action: 'start_fresh', queueExpiresAt: queueExpiresAt + 180_000,
      now: queueExpiresAt + 24 })
    assert.equal(fresh.applied, true)
    const [freshCommand] = await db.select().from(agentRunCommands).where(eq(agentRunCommands.id, fresh.commandId!))
    assert.equal(freshCommand?.type, 'start')
    assert.equal(freshCommand?.payload.fresh, true)
  } finally {
    await db.delete(conversations).where(eq(conversations.id, conversationId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.delete(users).where(eq(users.id, userId))
    await pool.end()
  }
})

function remoteEvent(
  sourceSequence: number,
  type: AgentRemoteEvent['type'],
  payload: Record<string, unknown>,
): AgentRemoteEvent {
  return {
    protocolVersion: 1,
    eventId: `remote_event_${sourceSequence}`,
    environmentId: '',
    runId: '',
    sourceSequence,
    type,
    occurredAt: Date.now() + sourceSequence,
    payload,
  }
}
