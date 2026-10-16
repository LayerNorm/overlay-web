import { SignJWT } from 'jose'
import { mergeRoomMessages, type RoomMessageRecord } from '../src/features/chat/components/collaboration/room-message-view'
import { agentHostCommandSchema } from '../packages/overlay-agent-bridge-protocol/src/index'
import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { internal } from './_generated/api'
import { hydrateRemoteMessage } from './lib/remoteMessageText'

const modules = import.meta.glob('./**/*.ts')
const secret = 'remote-agent-turn-test-secret'
const now = 1_900_000_000_000
const workspaceId = 'workspace-remote-turn'
const environmentId = 'environment-remote-turn'
const agentId = 'agent-remote-turn'
const actorUserId = 'user-remote-turn'
const actorPrincipalId = 'principal-human-remote-turn'
const agentPrincipalId = 'principal-agent-remote-turn'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex remote agent room turns', () => {
  test('binding discovery is tenant-scoped and requires a real agent principal', async () => {
    const convex = convexTest(schema, modules)
    await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    const read = <T>(operation: string, args: Record<string, unknown>) =>
      convex.query(queryRef(operation), { ...args, serverSecret: secret }) as Promise<T>

    await expect(call('upsertBindingByServer', bindingInput({ agentId: 'arbitrary-agent' })))
      .rejects.toThrow(/AGENT_PRINCIPAL_UNAVAILABLE/)
    const binding = await call<{ id: string }>('upsertBindingByServer', bindingInput())
    expect(binding.id).toBe('binding-remote-turn')
    expect(await read<unknown[]>('listBindingsByServer', { workspaceId: 'workspace-foreign' })).toEqual([])
    const target = await read<{ environment: { status: string } }>('findInvocationTargetByServer', {
      workspaceId, agentId, now, onlineWithinMs: 45_000,
    })
    expect(target.environment.status).toBe('offline')
    expect(await call<boolean>('disableBindingsForAgentByServer', { workspaceId, agentId, now: now + 1 })).toBe(true)
    expect(await read('findInvocationTargetByServer', { workspaceId, agentId, now: now + 1, onlineWithinMs: 45_000 })).toBeNull()
  })

  test('a question one agent posts for another is a valid trigger that carries its lineage, for the same person only', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    // The lineage part must pass the message schema, or posting the question fails.
    const questionId = await convex.run(async ctx => await ctx.db.insert('conversationMessages', {
      conversationId: seeded.conversationId as never, userId: actorUserId, authorKind: 'agent', authorPrincipalId: agentPrincipalId,
      turnId: 'ask-1', role: 'assistant', mode: 'act', content: 'Asked by Scout: hi', contentType: 'text', modelId: 'm', status: 'completed',
      parts: [{ type: 'text', text: 'Asked by Scout: hi' }, { type: 'data-agent-lineage', data: { rootTurnId: 'r', hop: 1, chain: ['scout', 'planner'], askedByName: 'Scout' } }],
      createdAt: now, updatedAt: now,
    }))
    const asked = await call<{ resumed: boolean }>('startRemoteAgentTurnByServer', startInput({ ...seeded, userMessageId: questionId as string }, { clientNonce: 'ask-nonce', commandId: 'ask-command', runId: 'ask-run', sessionId: 'ask-session' }))
    expect(asked.resumed).toBe(false)
    await expect(call('startRemoteAgentTurnByServer', startInput({ ...seeded, userMessageId: questionId as string }, {
      actorUserId: 'someone-else', initiatorPrincipalId: 'foreign-principal', clientNonce: 'ask-nonce-2', commandId: 'ask-command-2', runId: 'ask-run-2', sessionId: 'ask-session-2',
    }))).rejects.toThrow(/CONVERSATION_ACCESS_DENIED/)
  })

  test('stopping a machine for lack of credit ends its runs: the chat row stops generating and the session is closed', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    await convex.run(async ctx => {
      await ctx.db.insert('agentSandboxLeases', {
        leaseId: 'lease-stop', workspaceId, environmentId, provider: 'box', providerReference: 'sandbox', status: 'running',
        reservedUntil: Number.MAX_SAFE_INTEGER, usage: {}, cleanupAttempts: 0, createdAt: now, updatedAt: now,
      })
    })
    await call('stopSandboxLeaseByServer', { workspaceId, leaseId: 'lease-stop', reason: 'budget_exhausted', now: now + 1_000 })
    const after = await convex.run(async ctx => ({
      message: await ctx.db.get(started.messageId as never) as { status?: string; content: string } | null,
      session: (await ctx.db.query('agentRemoteSessions').withIndex('by_environmentId_status', q => q.eq('environmentId', environmentId).eq('status', 'cancelled')).collect()).length,
    }))
    expect(after.message?.status).toBe('completed')
    expect(after.message?.content).toMatch(/credit ran low/)
    expect(after.session).toBe(1)
    const active = await convex.query(queryRef('environmentHasActiveRunsByServer'), { serverSecret: secret, environmentId })
    expect(active).toBe(false)
  })

  test('offline start is atomic, inaccessible callers are denied, and expired run leases cannot claim', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())

    await expect(call('startRemoteAgentTurnByServer', startInput(seeded, {
      actorUserId: 'foreign-user', initiatorPrincipalId: 'foreign-principal', clientNonce: 'foreign-nonce',
    }))).rejects.toThrow(/CONVERSATION_ACCESS_DENIED/)
    const result = await call<{ messageId: string; resumed: boolean; waiting: boolean }>(
      'startRemoteAgentTurnByServer', startInput(seeded),
    )
    expect(result.waiting).toBe(true)
    expect(result.resumed).toBe(false)
    const duplicate = await call<{ messageId: string; resumed: boolean }>('startRemoteAgentTurnByServer', startInput(seeded, {
      commandId: 'different-command', runId: 'different-run', sessionId: 'different-session',
    }))
    expect(duplicate).toEqual(expect.objectContaining({ messageId: result.messageId, resumed: true }))
    await expect(call('startRemoteAgentTurnByServer', startInput(seeded, {
      clientNonce: 'concurrent-invocation', commandId: 'concurrent-command', runId: 'concurrent-run',
      sessionId: 'concurrent-session', maxConcurrentRuns: 1,
    }))).rejects.toThrow(/CONNECTED_AGENT_POLICY_LIMIT:concurrent_runs/)

    const snapshot = await convex.run(async ctx => {
      const message = await ctx.db.get(result.messageId as never)
      const runs = await ctx.db.query('conversationAgentRuns')
        .withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).collect()
      const commands = await ctx.db.query('agentRunCommands')
        .withIndex('by_environmentId_sequence', q => q.eq('environmentId', environmentId)).collect()
      return { message, runs, commands }
    })
    expect(snapshot.message?.content).toBe('Waiting for Offline Mac')
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.commands).toHaveLength(1)

    // The command of an expired run is not started; it still goes out, as a shutdown, so the host's command numbers
    // have no hole.
    expect(await call('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 60_001, leaseMs: 5_000, limit: 10,
    })).toEqual([expect.objectContaining({ type: 'shutdown', payload: { reason: 'This run is no longer active.' } })])
    expect(await call('controlRemoteAgentTurnByServer', {
      actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn', action: 'retry',
      queueExpiresAt: now + 120_000, now: now + 60_002,
    })).toEqual(expect.objectContaining({ applied: true, messageId: result.messageId }))
    expect(await call<unknown[]>('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 60_003, leaseMs: 5_000, limit: 10,
    })).toHaveLength(1)
    expect(await call('controlRemoteAgentTurnByServer', {
      actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn', action: 'cancel',
      queueExpiresAt: now + 120_000, now: now + 60_004,
    })).toEqual(expect.objectContaining({ applied: true, messageId: result.messageId }))
    await expect(call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(1, 'cancelled', { reason: 'Cancelled from Overlay' })], maxEventsPerMinute: 0,
      now: now + 60_005 })).rejects.toThrow(/CONNECTED_AGENT_POLICY_LIMIT:event_rate/)
    expect(await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(1, 'cancelled', { reason: 'Cancelled from Overlay' })], maxEventsPerMinute: 1,
      now: now + 60_005 }))
      .toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 1, duplicate: false }))
  })

  test('contiguous events project once and duplicate terminal delivery is harmless', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded, {
      sandboxBilling: {
        baselineUsage: {}, leaseId: 'lease-remote-turn', provider: 'vercel',
        providerReference: 'sandbox-remote-turn', reservationId: 'sandbox-reservation-remote-turn',
        resources: { diskGiB: 20, memoryGiB: 4, vcpus: 2 }, startedAt: now,
      },
    }))
    const events = [
      event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' }),
      event(2, 'text_checkpoint', { text: 'Work completed', final: true }),
      event(3, 'completed', { summary: 'Done', usage: { inputTokens: 12, outputTokens: 7 } }),
    ]
    const accepted = await call<{ accepted: boolean; duplicate: boolean; terminal?: { inputTokens: number } }>('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: now + 100,
    })
    expect(accepted).toEqual(expect.objectContaining({ accepted: true, duplicate: false }))
    expect(accepted.terminal?.inputTokens).toBe(12)
    const beforeDuplicate = await projectedState(convex, started.messageId)
    expect(beforeDuplicate.message?.content).toBe('Work completed')
    expect(beforeDuplicate.message?.status).toBe('completed')
    expect(beforeDuplicate.run?.status).toBe('completed')
    expect(beforeDuplicate.session?.eventCursor).toBe(3)
    expect(beforeDuplicate.command?.status).toBe('pending') // never claimed: preserve its sequence for shutdown delivery

    const duplicate = await call<{ accepted: boolean; duplicate: boolean }>('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: now + 101,
    })
    expect(duplicate).toEqual(expect.objectContaining({ accepted: true, duplicate: true }))
    const afterDuplicate = await projectedState(convex, started.messageId)
    expect(afterDuplicate.eventCount).toBe(beforeDuplicate.eventCount)
    const pendingSettlements = await convex.query(queryRef('listPendingSandboxSettlementsByServer'), {
      serverSecret: secret, limit: 10,
    }) as Array<{ runId: string; sandboxBilling: { reservationId: string } }>
    expect(pendingSettlements).toEqual([
      expect.objectContaining({ runId: 'run-remote-turn', sandboxBilling: expect.objectContaining({
        reservationId: 'sandbox-reservation-remote-turn',
      }) }),
    ])
    expect(await call('markSandboxSettlementCompleteByServer', {
      workspaceId, reservationId: 'sandbox-reservation-remote-turn', settledAt: now + 102,
    })).toBe(true)
    expect(await convex.query(queryRef('listPendingSandboxSettlementsByServer'), {
      serverSecret: secret, limit: 10,
    })).toEqual([])
    expect(await call('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(4, 'text_checkpoint', { text: 'must not apply' })], now: now + 102,
    })).toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 4, stale: 'stale_terminal' }))
  })

  test('stream stats record batches, snapshot size, quiet gaps, host lag, tool time and refused batches', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    const apply = (events: Array<ReturnType<typeof event>>, at: number) => call<{ accepted: boolean }>('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: at,
    })
    await apply([
      event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' }),
      event(2, 'text_checkpoint', { text: 'Searching' }),
      event(3, 'action', { actionId: 'search-1', title: 'Web search', status: 'started' }),
    ], now + 1_000)
    // A gap in sequence numbers is refused and counted, and changes nothing else.
    expect(await apply([event(9, 'text_checkpoint', { text: 'out of order' })], now + 2_000))
      .toEqual({ accepted: false, expectedSequence: 4 })
    await apply([
      { ...event(4, 'action', { actionId: 'search-1', title: 'Web search', status: 'completed' }), occurredAt: now + 4_000 },
      { ...event(5, 'text_checkpoint', { text: 'Searching done' }), occurredAt: now + 4_001 },
    ], now + 5_000)
    // A batch the server could not use at all (scope or schema) is counted through the separate mutation.
    expect(await call('recordRemoteEventBatchRejectionByServer', { workspaceId, environmentId, runId: 'run-remote-turn' })).toBe(true)
    expect(await call('recordRemoteEventBatchRejectionByServer', { workspaceId: 'other-workspace', environmentId, runId: 'run-remote-turn' })).toBe(false)

    const { run, message } = await projectedState(convex, started.messageId)
    expect(message?.content).toBe('Searching done')
    expect(run?.streamStats).toEqual(expect.objectContaining({
      batches: 2,
      events: 5,
      textCheckpointChars: 'Searching'.length + 'Searching done'.length,
      messageWrites: 2,
      rejectedBatches: 2,
      firstEventAt: now + 1_000,
      lastEventAt: now + 5_000,
      maxQuietGapMs: 4_000,
      longestToolMs: 4_000 - 3,
      longestToolTitle: 'Web search',
      openTools: [],
    }))
    expect(run?.streamStats?.eventBytes).toBeGreaterThan(0)
    // The second batch arrived 1 s after its events happened on the host.
    expect(run?.streamStats?.maxHostLagMs).toBe(1_000)
  })

  test('a rejected host command terminates the visible run with a recoverable error', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))

    expect(await call<boolean>('acknowledgeCommandByServer', {
      workspaceId, environmentId, commandId: 'command-remote-turn', accepted: false, now: now + 1,
    })).toBe(true)

    const state = await projectedState(convex, started.messageId)
    expect(state.command?.status).toBe('cancelled')
    expect(state.run).toEqual(expect.objectContaining({ status: 'failed',
      terminalError: expect.objectContaining({ code: 'remote_command_rejected', retryable: true }) }))
    expect(state.session?.status).toBe('failed')
    expect(state.message).toEqual(expect.objectContaining({ status: 'error',
      content: 'The connected environment rejected this command. Reconnect it, then retry this message.' }))
    expect(state.message?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'data-remote-agent-status', data: expect.objectContaining({
        state: 'recoverable', retryClass: 'transient',
      }) }),
    ]))
  })

  test('the host is told why it rejected a command, in one safe line', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    await call('acknowledgeCommandByServer', {
      workspaceId, environmentId, commandId: 'command-remote-turn', accepted: false, now: now + 1,
      errorCode: 'command_sequence_gap', errorMessage: 'expected command sequence 6\n<script>x</script>'.padEnd(400, '!'),
    })
    const state = await projectedState(convex, started.messageId)
    const content = String(state.message?.content)
    expect(content).toMatch(/^The connected environment rejected this command \(command_sequence_gap: expected command sequence 6 <script>/)
    expect(content).not.toContain('\n')
    expect(content.length).toBeLessThan(330)
    expect(content).toMatch(/Reconnect it, then retry this message\.$/)
  })

  test('cancelling a run before its commands are delivered leaves no hole in the host’s command numbers', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    await call('startRemoteAgentTurnByServer', startInput(seeded))
    await call('controlRemoteAgentTurnByServer', {
      actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn', action: 'cancel',
      queueExpiresAt: now + 120_000, now: now + 10,
    })
    const delivered = await call<Array<{ sequence: number; type: string }>>('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 20, leaseMs: 5_000, limit: 10,
    })
    // Both commands reach the host, in order: the start as a shutdown (its run is over) and the cancel.
    expect(delivered.map((command) => [command.sequence, command.type])).toEqual([[1, 'shutdown'], [2, 'cancel']])
  })

  test('repairing a wedged environment sends the host the commands it never got, so it catches up and accepts new ones', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    await call('startRemoteAgentTurnByServer', startInput(seeded))
    // The state production was in: command 1 acknowledged, 2 and 3 cancelled without ever being delivered, the run over.
    await convex.run(async (ctx) => {
      const [first] = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', (q) => q.eq('environmentId', environmentId)).collect()
      await ctx.db.patch(first!._id, { status: 'acknowledged', acknowledgedAt: now + 1 })
      for (const sequence of [2, 3]) {
        await ctx.db.insert('agentRunCommands', {
          commandId: `lost-${sequence}`, workspaceId, environmentId, runId: 'run-remote-turn', type: 'reconnect', sequence,
          payload: { remoteSessionId: 'acp-session' }, status: 'cancelled', createdAt: now + sequence, updatedAt: now + sequence,
        })
      }
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', (q) => q.eq('externalRunId', 'run-remote-turn')).unique()
      await ctx.db.patch(run!._id, { status: 'failed' })
    })
    expect(await call('claimCommandsByServer', { workspaceId, environmentId, now: now + 50, leaseMs: 5_000, limit: 10 })).toEqual([])

    const repaired = await convex.mutation(internal.agents.connectedAgents.reopenUndeliveredCommands, { environmentId })
    expect(repaired).toEqual({ lastAcknowledged: 1, reopened: [2, 3] })
    const delivered = await call<Array<{ sequence: number; type: string }>>('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 60, leaseMs: 5_000, limit: 10,
    })
    expect(delivered.map((command) => [command.sequence, command.type])).toEqual([[2, 'shutdown'], [3, 'shutdown']])
  })

  test('an approval for an Overlay MCP tool call shows a card, answers the waiting call, and sends the host nothing', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 10,
      events: [event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' })] })
    const ask = (at: number, overrides: Record<string, unknown> = {}) => call<{ state: string; decision?: string }>('requestMcpApprovalByServer', {
      workspaceId, environmentId, runId: 'run-remote-turn', requestKey: 'mcp:abc', prompt: 'Allow call_mcp_tool (Monid)?', now: now + at, ...overrides })

    expect(await ask(11, { runId: 'someone-elses-run' })).toEqual({ state: 'unavailable' })
    expect(await ask(11)).toEqual({ state: 'pending' })
    expect(await ask(12)).toEqual({ state: 'pending' })
    const waiting = await projectedState(convex, started.messageId)
    const card = (waiting.message?.parts ?? []).find(part => part.type === 'data-remote-agent-request') as { data: Record<string, unknown> }
    expect(card.data).toEqual(expect.objectContaining({ requestKey: 'mcp:abc', state: 'pending', prompt: 'Allow call_mcp_tool (Monid)?' }))
    expect(waiting.run?.status).toBe('waiting_for_approval')
    await convex.run(async ctx => {
      const rows = await ctx.db.query('agentApprovalRequests').collect()
      expect(rows.filter(row => row.requestKey === 'mcp:abc')).toHaveLength(1)
    })

    expect(await call('resolveRemoteRequestByServer', { actorUserId: 'foreign-user', workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'mcp:abc', decision: 'allow', now: now + 13 })).toEqual({ applied: false })
    await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'mcp:abc', decision: 'forged', now: now + 13 })).rejects.toThrow(/AGENT_APPROVAL_OPTION_INVALID/)
    const resolved = await call<{ applied: boolean; commandId?: string }>('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'mcp:abc', decision: 'allow', now: now + 14 })
    expect(resolved.applied).toBe(true)
    // The host is never told: there is no command for it, because the agent did not ask.
    expect(resolved.commandId).toBeUndefined()
    await convex.run(async ctx => {
      const commands = await ctx.db.query('agentRunCommands').collect()
      expect(commands.filter(command => command.type === 'approval_response')).toHaveLength(0)
    })

    expect(await ask(15)).toEqual({ state: 'resolved', decision: 'allow' })
    const after = await projectedState(convex, started.messageId)
    expect(after.run?.status).toBe('running')
    const resolvedCard = (after.message?.parts ?? []).find(part => part.type === 'data-remote-agent-request') as { data: Record<string, unknown> }
    expect(resolvedCard.data.state).toBe('resolved')
  })

  test('a bridged MCP approval uses one canonical card and delivers its answer as elicitation', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    await call('startRemoteAgentTurnByServer', startInput(seeded))
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 10,
      events: [event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' })] })
    const callId = 'd3c2acb6-f09a-4ec6-97eb-39fad2eed724'
    const requestKey = `mcp_call:${callId}`
    const ask = () => call('requestMcpApprovalByServer', { workspaceId, environmentId, runId: 'run-remote-turn',
      sessionId: 'session-remote-turn', requestKey, prompt: 'Allow synthetic tool?', bridge: true, now: now + 11 })
    expect(await ask()).toEqual({ state: 'unavailable' })
    await convex.run(ctx => ctx.db.insert('agentMcpCalls', { callId, workspaceId, environmentId, runId: 'run-remote-turn',
      sessionId: 'session-remote-turn', clientSessionId: 'client', rpcId: '1', toolName: 'synthetic', argumentsJson: '{}',
      requestKey, state: { kind: 'pending' }, expiresAt: now + 60000, retireAt: now + 86400000, createdAt: now }))
    expect(await ask()).toEqual({ state: 'pending' })
    expect(await ask()).toEqual({ state: 'pending' })
    expect(await convex.run(ctx => ctx.db.query('agentApprovalRequests').collect())).toHaveLength(1)
    const resolved = await call<{ commandId?: string }>('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey, decision: 'allow', now: now + 12 })
    const command = await convex.run(ctx => ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', resolved.commandId!)).unique())
    expect(command).toMatchObject({ type: 'elicitation_response', payload: { requestKey, action: 'accept', content: { confirm: true } } })
    const replay = await call<{ commandId?: string }>('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey, decision: 'allow', now: now + 13 })
    expect(replay.commandId).toBe(resolved.commandId)
  })

  test('an MCP approval left unanswered is closed when the run ends, so the waiting call is refused', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    await call('startRemoteAgentTurnByServer', startInput(seeded))
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 10,
      events: [event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' })] })
    const ask = (at: number) => call<{ state: string; decision?: string }>('requestMcpApprovalByServer', {
      workspaceId, environmentId, runId: 'run-remote-turn', requestKey: 'mcp:late', prompt: 'Allow?', now: now + at })
    expect(await ask(11)).toEqual({ state: 'pending' })
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 12,
      events: [event(2, 'cancelled', {})] })
    expect(await ask(13)).toEqual({ state: 'resolved', decision: 'cancelled' })
    // And a new request on an ended run is unavailable.
    expect(await call('requestMcpApprovalByServer', { workspaceId, environmentId, runId: 'run-remote-turn',
      requestKey: 'mcp:new', prompt: 'Allow?', now: now + 14 })).toEqual({ state: 'unavailable' })
  })

  test('approval, elicitation, artifacts, and structured work remain server-authorized and exactly once', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 10,
      events: [
        event(1, 'session_started', { remoteSessionId: 'acp-session', adapterId: 'acp' }),
        event(2, 'approval_requested', { requestKey: 'permission-1', prompt: 'Write files?',
          options: [{ id: 'allow_once', label: 'Allow once' }, { id: 'reject', label: 'Reject' }], context: {} }),
      ] })
    expect(await call('resolveRemoteRequestByServer', { actorUserId: 'foreign-user', workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'permission-1',
      decision: 'allow_once', now: now + 11 })).toEqual({ applied: false })
    await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'permission-1',
      decision: 'forged-option', now: now + 12 })).rejects.toThrow(/AGENT_APPROVAL_OPTION_INVALID/)
    const approved = await call<{ applied: boolean; commandId: string }>('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'permission-1',
      decision: 'allow_once', now: now + 13 })
    expect(approved.applied).toBe(true)
    expect(await call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'permission-1',
      decision: 'allow_once', now: now + 14 })).toEqual(expect.objectContaining({ applied: true, commandId: approved.commandId }))
    await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'permission-1',
      decision: 'reject', now: now + 14 })).rejects.toThrow(/AGENT_REMOTE_REQUEST_ALREADY_RESOLVED/)

    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 15,
      events: [event(3, 'elicitation_requested', { requestKey: 'input-1', prompt: 'Choose branch',
        requestedSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] }, context: {} })] })
    await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'input-1',
      decision: 'accept', response: {}, now: now + 16 })).rejects.toThrow(/AGENT_ELICITATION_RESPONSE_INVALID/)
    await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'input-1',
      decision: 'accept', response: { branch: 42 }, now: now + 16 })).rejects.toThrow(/AGENT_ELICITATION_RESPONSE_INVALID/)
    await call('resolveRemoteRequestByServer', { actorUserId, workspaceId,
      conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey: 'input-1',
      decision: 'accept', response: { branch: 'byo-agents' }, now: now + 17 })
    await expect(call('createArtifactByServer', { id: 'artifact-too-large', workspaceId, environmentId,
      runId: 'run-remote-turn', remoteSessionId: 'session-remote-turn', name: 'report.txt', mediaType: 'text/plain',
      size: 6, sha256: 'a'.repeat(64), objectKey: 'scoped/rejected', status: 'clean', scanResult: 'clean',
      expiresAt: now + 60_000, createdAt: now, updatedAt: now, maxWorkspaceArtifactBytes: 5,
    })).rejects.toThrow(/CONNECTED_AGENT_POLICY_LIMIT:artifact_bytes/)
    await call('createArtifactByServer', { id: 'artifact-remote-turn', workspaceId, environmentId,
      runId: 'run-remote-turn', remoteSessionId: 'session-remote-turn', name: 'report.txt', mediaType: 'text/plain',
      size: 6, sha256: 'a'.repeat(64), objectKey: 'scoped/report', status: 'clean', scanResult: 'clean',
      expiresAt: now + 60_000, createdAt: now, updatedAt: now, maxWorkspaceArtifactBytes: 10 })
    const terminal = await call<{ accepted: boolean; terminal?: { inputTokens: number } }>('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 18,
      events: [
        event(4, 'plan', { entries: [{ id: 'step-1', title: 'Implement', status: 'completed' }] }),
        event(5, 'diff', { diffId: 'diff-1', title: 'app.ts', patch: '+ready' }),
        event(6, 'terminal', { terminalId: 'terminal-1', title: 'Tests', summary: 'Passed', status: 'completed', exitCode: 0 }),
        event(7, 'artifact', { name: 'report.txt', mediaType: 'text/plain', size: 6,
          sha256: 'a'.repeat(64), uploadReference: 'artifact-remote-turn' }),
        event(8, 'completed', { summary: 'Done', usage: { inputTokens: 4, outputTokens: 2 } }),
      ],
    })
    expect(terminal.terminal?.inputTokens).toBe(4)
    const state = await projectedState(convex, started.messageId)
    const types = (state.message?.parts ?? []).map(part => part.type)
    for (const type of ['data-remote-agent-request', 'data-remote-agent-plan', 'data-remote-agent-diff', 'data-remote-agent-terminal', 'file']) {
      expect(types).toContain(type)
    }
    const snapshot = await convex.run(async ctx => ({
      resolved: (await ctx.db.query('agentApprovalRequests').withIndex('by_workspaceId_runId', q => q.eq('workspaceId', workspaceId).eq('runId', 'run-remote-turn')).collect()).every(request => Boolean(request.resolution)),
      linked: (await ctx.db.query('agentArtifacts').withIndex('by_artifactId', q => q.eq('artifactId', 'artifact-remote-turn')).unique())?.status,
    }))
    expect(snapshot).toEqual({ resolved: true, linked: 'linked' })
  })

  test('host disappearance becomes recoverable and supports resume or a deliberate fresh start', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    await seedWorkspaceReservation(convex)
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded, {
      reservationId: 'reservation-remote-turn',
    }))
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(1, 'session_started', { remoteSessionId: 'resume-session', adapterId: 'acp' })], now: now + 1 })
    const swept = await convex.mutation(mutationRef('sweepRemoteRunsInternal'), {
      now: now + 2, hostOfflineBefore: now - 30_000,
    }) as { alerts: Array<{ code: string; runId?: string }>; expiredRunIds: string[] }
    expect(swept.expiredRunIds).toEqual(['run-remote-turn'])
    expect(swept.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'offline_environment', runId: 'run-remote-turn' }),
    ]))
    expect(await convex.run(async ctx => ctx.db.query('budgetReservations')
      .withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique()))
      .toEqual(expect.objectContaining({ status: 'reconcile_required', reconciliationAttempts: 1 }))
    expect((await projectedState(convex, started.messageId)).message?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'data-remote-agent-status', data: expect.objectContaining({ state: 'recoverable', retryClass: 'host_offline' }) }),
    ]))
    const resumed = await call<{ applied: boolean; commandId: string }>('controlRemoteAgentTurnByServer', {
      actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn',
      action: 'resume', queueExpiresAt: now + 60_000, now: now + 3,
    })
    expect(resumed.applied).toBe(true)
    const resumeCommand = await convex.run(async ctx => ctx.db.query('agentRunCommands')
      .withIndex('by_commandId', q => q.eq('commandId', resumed.commandId)).unique())
    expect(resumeCommand).toEqual(expect.objectContaining({ type: 'reconnect', payload: { remoteSessionId: 'resume-session' } }))
    await call('controlRemoteAgentTurnByServer', { actorUserId, conversationId: seeded.conversationId,
      workspaceId, runId: 'run-remote-turn', action: 'cancel', queueExpiresAt: now + 60_000, now: now + 4 })
    const fresh = await call<{ applied: boolean; commandId: string }>('controlRemoteAgentTurnByServer', {
      actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn',
      action: 'start_fresh', queueExpiresAt: now + 120_000, now: now + 5,
    })
    // Cancellation is final; a fresh execution requires a new logical task and budget.
    expect(fresh.applied).toBe(false)
    expect((await call<{ expiredRunIds: string[] }>('sweepRemoteRunsByServer', {
      now: now + 6, hostOfflineBefore: 0, limit: 10,
    })).expiredRunIds).toEqual([])
  })

  test('offline alerts skip overlay_cloud environments whose idle-stopped sandbox is normal', async () => {
    const convex = convexTest(schema, modules)
    await seedRoom(convex)
    await convex.run(async ctx => {
      await ctx.db.insert('agentEnvironments', {
        environmentId: 'environment-managed', workspaceId, kind: 'overlay_cloud',
        name: 'overlay-harness-managed', status: 'offline', capabilities: {},
        approvedAt: now - 1_000, approvedByUserId: actorUserId,
        lastSeenAt: now - 60_000, createdAt: now - 2_000, updatedAt: now,
      })
      await ctx.db.insert('agentEnvironments', {
        environmentId: 'environment-byo-stale', workspaceId, kind: 'local',
        name: 'Stale laptop', status: 'online', capabilities: {},
        approvedAt: now - 1_000, approvedByUserId: actorUserId,
        lastSeenAt: now - 60_000, createdAt: now - 2_000, updatedAt: now,
      })
    })
    const swept = await convex.mutation(mutationRef('sweepRemoteRunsInternal'), {
      now: now + 2, hostOfflineBefore: now - 30_000,
    }) as { alerts: Array<{ code: string; environmentId?: string }> }
    const alertedEnvironmentIds = swept.alerts
      .filter(alert => alert.code === 'offline_environment')
      .map(alert => alert.environmentId)
    expect(alertedEnvironmentIds.sort()).toEqual(['environment-byo-stale', environmentId])
  })
})

async function seedRoom(convex: ReturnType<typeof convexTest>) {
  return await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Remote', slug: 'remote', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: actorPrincipalId, workspaceId, type: 'human', userId: actorUserId, displayName: 'Human', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: agentPrincipalId, workspaceId, type: 'agent', agentId, displayName: 'Agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'membership-remote-turn', workspaceId, principalId: actorPrincipalId, role: 'owner', status: 'active', joinedAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: actorUserId, workspaceId, conversationType: 'dm', title: 'Remote room', lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    await ctx.db.insert('conversationParticipants', { conversationId, workspaceId, principalId: actorPrincipalId, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    await ctx.db.insert('conversationParticipants', { conversationId, workspaceId, principalId: agentPrincipalId, principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: actorUserId, authorKind: 'human', authorPrincipalId: actorPrincipalId, turnId: 'human-message-turn', role: 'user', mode: 'act', content: '@Agent work', contentType: 'text', status: 'completed', createdAt: now, updatedAt: now })
    await ctx.db.insert('agentEnvironments', { environmentId, workspaceId, kind: 'local', name: 'Offline Mac', status: 'offline', capabilities: { adapters: ['acp'] }, filesystemGrant: { mode: 'selected_roots', roots: ['/repo'] }, approvedAt: now - 1_000, approvedByUserId: actorUserId, lastSeenAt: now - 60_000, createdAt: now - 2_000, updatedAt: now })
    return { conversationId, userMessageId }
  })
}

async function seedWorkspaceReservation(convex: ReturnType<typeof convexTest>) {
  await convex.run(async ctx => {
    const billingAccountId = 'billing-account-remote-turn'
    await ctx.db.insert('billingAccounts', {
      billingAccountId, scope: 'workspace', workspaceId, status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('billingAccountBalances', {
      billingAccountId, mode: 'budgeted', includedMicros: 100_000, institutionalGrantMicros: 0,
      allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0,
      reservedMicros: 10_000, version: 1, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('budgetReservations', {
      userId: actorUserId, billingAccountId, spendSubjectKind: 'programmatic', spendSubjectId: `agent:${agentId}`,
      reservationId: 'reservation-remote-turn', status: 'reserved', kind: 'agent', modelId: 'openrouter/free',
      operationId: 'workspace-agent:remote-turn', reservedCents: 1, createdAt: now, updatedAt: now,
    })
  })
}

function bindingInput(overrides: Record<string, unknown> = {}) {
  return { id: 'binding-remote-turn', workspaceId, agentId, environmentId, protocolAdapter: 'acp', adapterConfig: { adapterId: 'acp' }, enabled: true, now, ...overrides }
}
function startInput(seeded: { conversationId: string; userMessageId: string }, overrides: Record<string, unknown> = {}) {
  return { actorUserId, agentId, authorPrincipalId: agentPrincipalId, bindingId: 'binding-remote-turn',
    clientNonce: 'invocation-remote-turn', commandId: 'command-remote-turn', conversationId: seeded.conversationId,
    environmentId, environmentName: 'untrusted-name', environmentOnline: true, initiatorPrincipalId: actorPrincipalId,
    modelId: 'openrouter/free', modelUsageBilling: 'byok', maxConcurrentRuns: 10,
    maxRunTimeMs: 30 * 60_000, prompt: 'work', queueExpiresAt: now + 60_000, reservationId: null,
    runId: 'run-remote-turn', sessionId: 'session-remote-turn', startPayload: { bindingId: 'binding-remote-turn', adapterId: 'acp', workingDirectory: '/repo', prompt: 'work', metadata: {} },
    turnId: 'turn-remote-turn', userMessageId: seeded.userMessageId, workspaceId, now, ...overrides }
}
function event(sourceSequence: number, type: string, payload: Record<string, unknown>) {
  return { protocolVersion: 1, eventId: `event-${sourceSequence}`, environmentId, runId: 'run-remote-turn', sourceSequence, type, occurredAt: now + sourceSequence, payload }
}
async function projectedState(convex: ReturnType<typeof convexTest>, messageId: string) {
  return await convex.run(async ctx => {
    const message = await ctx.db.get(messageId as never)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).unique()
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', 'session-remote-turn')).unique()
    const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', 'command-remote-turn')).unique()
    const events = run ? await ctx.db.query('conversationEvents').withIndex('by_conversationId_createdAt', q => q.eq('conversationId', run.conversationId)).collect() : []
    return { message, run, session, command, eventCount: events.length }
  })
}
function mutationRef(operation: string) { return makeFunctionReference<'mutation'>(`agents/connectedAgents:${operation}`) }
function queryRef(operation: string) { return makeFunctionReference<'query'>(`agents/connectedAgents:${operation}`) }

async function durableFixture() {
  const convex = convexTest(schema, modules)
  const seeded = await seedRoom(convex)
  const call = <T = Record<string, unknown>>(operation: string, args: Record<string, unknown>) =>
    convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
  const lifecycle = <T = Record<string, unknown>>(operation: string, args: Record<string, unknown>) =>
    convex.mutation(makeFunctionReference<'mutation'>(`agents/remoteRuns:${operation}ByServer`), { ...args, serverSecret: secret }) as Promise<T>
  await call('upsertBindingByServer', bindingInput())
  await convex.run(async ctx => {
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
    await ctx.db.patch(environment!._id, { kind: 'overlay_cloud', status: 'online', lastSeenAt: now, capabilities: { ...environment!.capabilities, remoteLifecycleVersion: 2 } })
  })
  await seedWorkspaceReservation(convex)
  const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded, { lifecycleVersion: 2, maxRunTimeMs: 3_600_000, reservationId: 'reservation-remote-turn' }))
  const events = (items: Array<ReturnType<typeof event>>, at: number) => call('applyRemoteEventsByServer', {
    workspaceId, environmentId, sessionId: 'session-remote-turn', now: at,
    events: items.map(e => ({ ...e, execution: { attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-1' } })),
  })
  return { convex, seeded, call, lifecycle, started, events }
}

test('durable API-exit intent survives and duplicate Workflow claims allow exactly one issuer', async () => {
  const { convex, lifecycle, call } = await durableFixture()
  const intents = await convex.run(ctx => ctx.db.query('agentRemoteRunIntents').withIndex('by_status_updatedAt', q => q.eq('status', 'pending')).collect())
  expect(intents.some(i => i.kind === 'start')).toBe(true)
  expect(await call<unknown[]>('claimCommandsByServer', { workspaceId, environmentId, now, leaseMs: 5000, limit: 10 })).toHaveLength(0)
  expect(await lifecycle('claim', { runId: 'run-remote-turn', coordinatorId: 'winner', generation: 1, now })).toBe(true)
  expect(await lifecycle('claim', { runId: 'run-remote-turn', coordinatorId: 'loser', generation: 1, now })).toBe(false)
  expect(await lifecycle('advance', { runId: 'run-remote-turn', coordinatorId: 'loser', generation: 1, now })).toBeNull()
  await lifecycle('advance', { runId: 'run-remote-turn', coordinatorId: 'winner', generation: 1, now })
  const commands = await call<unknown[]>('claimCommandsByServer', { workspaceId, environmentId, now, leaseMs: 5000, limit: 10 })
  expect(commands).toHaveLength(1)
  expect(commands[0]).toEqual(expect.objectContaining({ attemptId: 'session-remote-turn', executionGeneration: 1, type: 'start' }))
})

test('durable approval crosses 20 minutes with health and unrelated output then finishes on the same row', async () => {
  const { convex, lifecycle, call, started, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }), event(2, 'approval_requested', {
    requestKey: 'clone', prompt: 'Allow clone?', options: [{ id: 'allow', label: 'Allow' }], context: {},
  })], now + 1)
  const beforeHealth = await projectedState(convex, started.messageId)
  for (let minute = 1; minute <= 20; minute++) {
    const at = now + minute * 60_000
    await events([event(minute + 2, 'process_observation', { process: 'live' })], at)
    await call('sweepRemoteRunsByServer', { now: at, hostOfflineBefore: at - 45_000, limit: 100 })
  }
  expect((await projectedState(convex, started.messageId)).message?.updatedAt).toBe(beforeHealth.message?.updatedAt)
  await events([event(23, 'text_checkpoint', { text: 'Waiting for your decision.' }), event(24, 'commands_update', { commands: [] })], now + 1_200_001)
  let result = await projectedState(convex, started.messageId)
  expect(result.run?.status).toBe('waiting_for_approval')
  expect(result.session?.status).toBe('waiting_for_approval')
  expect(result.message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ state: 'pending' }) })]))
  const decision = await call('resolveRemoteRequestByServer', { actorUserId, workspaceId, conversationId: result.run!.conversationId,
    runId: 'run-remote-turn', requestKey: 'clone', decision: 'allow', now: now + 1_200_002 })
  expect(decision.applied).toBe(true)
  expect((await projectedState(convex, started.messageId)).run?.status).toBe('waiting_for_approval')
  const duplicate = await call('resolveRemoteRequestByServer', { actorUserId, workspaceId, conversationId: result.run!.conversationId,
    runId: 'run-remote-turn', requestKey: 'clone', decision: 'allow', now: now + 1_200_003 })
  expect(duplicate.commandId).toBe(decision.commandId)
  await events([event(25, 'completed', { summary: 'Done', usage: {} })], now + 1_200_004)
  result = await projectedState(convex, started.messageId)
  expect(result.run?.status).toBe('completed')
  expect(result.message?._id).toBe(started.messageId)
  expect(result.message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ state: 'resolved', resolution: expect.objectContaining({ decision: 'allow' }) }) })]))
})

test('durable stale attempts are rejected, double Resume is one operation and cancel fences completion', async () => {
  const { convex, seeded, call, lifecycle, started, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' })], now + 1)
  const control = { actorUserId, workspaceId, conversationId: seeded.conversationId, runId: 'run-remote-turn', action: 'resume', queueExpiresAt: now + 60_000, now: now + 2 }
  const first = await call('controlRemoteAgentTurnByServer', control)
  const second = await call('controlRemoteAgentTurnByServer', control)
  expect(first.operationId).toBe(second.operationId)
  expect(second.phase).toBe('recovering')
  expect(await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 3,
    events: [{ ...event(2, 'completed', { usage: {} }), execution: { attemptId: 'old-attempt', generation: 1 } }],
  })).toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 2, stale: 'stale_execution' }))
  await call('controlRemoteAgentTurnByServer', { ...control, action: 'cancel', now: now + 4 })
  await events([event(3, 'completed', { usage: { inputTokens: 9, outputTokens: 4 } })], now + 5)
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('cancelling')
  await events([event(4, 'cancelled', {})], now + 6)
  expect((await projectedState(convex, started.messageId)).run?.status).toBe('cancelled')
  expect((await projectedState(convex, started.messageId)).message?.tokens).toEqual({ input: 9, output: 4 })
  const attempts = await convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', 'run-remote-turn')).collect())
  expect(attempts).toHaveLength(1)
})

test('hard-deadline supervision persists a stop command while Workflow is unavailable', async () => {
  const { convex, call, lifecycle, events, started } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' })], now + 1)
  await call('sweepRemoteRunsByServer', { now: now + 3_600_001, hostOfflineBefore: now + 3_500_000, limit: 100 })
  const state = await projectedState(convex, started.messageId)
  expect(state.run?.remoteLifecycle?.phase).toBe('cancelling')
  expect(state.run?.remoteLifecycle?.cause).toBe('hard_deadline_expired')
  const stop = await convex.run(ctx => ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', 'stop:run-remote-turn:session-remote-turn')).unique())
  expect(stop?.type).toBe('cancel')
})

test('a settled hold or revoked binding cannot be revived by coordination or recovery', async () => {
  for (const reason of ['funding', 'binding']) {
    const { convex, lifecycle, started } = await durableFixture()
    await convex.run(async ctx => {
      if (reason === 'funding') {
        const reservation = await ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique()
        await ctx.db.patch(reservation!._id, { status: 'released' })
      } else {
        const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', 'binding-remote-turn')).unique()
        await ctx.db.patch(binding!._id, { enabled: false })
      }
    })
    const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
    await lifecycle('claim', owner); await lifecycle('advance', owner)
    expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('cancelled')
  }
})

test('terminal finalization persists and lost settlement acknowledgement leaves the same idempotent intent', async () => {
  const { convex, call, lifecycle, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }), event(2, 'completed', { usage: {} })], now + 1)
  const first = await convex.query(queryRef('pendingRemoteFinalizationsByServer'), { serverSecret: secret })
  const duplicate = await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }), event(2, 'completed', { usage: {} })], now + 2)
  expect(duplicate.duplicate).toBe(true)
  expect(await convex.query(queryRef('pendingRemoteFinalizationsByServer'), { serverSecret: secret })).toEqual(first)
  expect((first as unknown[])).toHaveLength(1)
  await call('sweepRemoteRunsByServer', { now: now + 3, hostOfflineBefore: 0, limit: 100 })
})

test('stale-hold expiry cannot release potentially consumed credit during a wait or pending stop', async () => {
  const { convex, call } = await durableFixture()
  await convex.run(async ctx => {
    const reservation = await ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique()
    await ctx.db.patch(reservation!._id, { expiresAt: now + 1, providerWorkStarted: true })
  })
  await call('sweepRemoteRunsByServer', { now: now + 3_600_001, hostOfflineBefore: 0, limit: 100 })
  await convex.mutation(makeFunctionReference<'mutation'>('platform/usage:reconcileExpiredBudgetReservationsByServer'), {
    serverSecret: secret, now: now + 3_600_002, limit: 10,
  })
  const reservation = await convex.run(ctx => ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique())
  expect(reservation?.status).toBe('reserved')
})

test('native durable-session reattachment can change receiver boot without accepting stale ACP output', async () => {
  const { convex, lifecycle, events, call, started } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'eve' })], now + 1)
  await convex.run(async ctx => {
    const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', 'session-remote-turn')).unique()
    await ctx.db.patch(attempt!._id, { capabilitySnapshot: { ...attempt!.capabilitySnapshot,
      startPayload: { adapterId: 'eve' }, adapters: [{ id: 'eve', protocol: 'eve', recovery: { interruptedTurnContinuation: true, approvalRestoration: true } }],
    } })
  })
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 2,
    events: [{ ...event(2, 'process_observation', { process: 'live', recoveryOutcome: 'attached_live' }), execution: { attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-2' } }],
  })
  expect(await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 3,
    events: [{ ...event(3, 'completed', { usage: {} }), execution: { attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-1' } }],
  })).toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 3, stale: 'stale_execution' }))
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 4,
    events: [{ ...event(4, 'completed', { usage: {} }), execution: { attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-2' } }],
  })
  expect((await projectedState(convex, started.messageId)).run?.status).toBe('completed')
})

test('a downgraded legacy host receives parseable shutdowns and an explicit canonical attention state', async () => {
  const { convex, call, lifecycle, started } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await convex.run(async ctx => {
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
    await ctx.db.patch(environment!._id, { capabilities: { adapters: ['acp'] } })
  })
  const commands = await call<Array<{ type: string; attemptId?: string }>>('claimCommandsByServer', { workspaceId, environmentId, now: now + 1, leaseMs: 5000, limit: 10 })
  expect(commands[0].type).toBe('shutdown')
  expect(commands[0].attemptId).toBeUndefined()
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('needs_attention')
})

test('expired wake/claim deadlines never launch late work or strand the reserved command sequence', async () => {
  for (const claimedOwner of [false, true]) {
    const { convex, call, lifecycle, started } = await durableFixture()
    if (claimedOwner) {
      const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
      await lifecycle('claim', owner); await lifecycle('advance', owner)
    }
    await call('sweepRemoteRunsByServer', { now: now + 60_001, hostOfflineBefore: 0, limit: 100 })
    const commands = await call<Array<{ type: string; sequence: number }>>('claimCommandsByServer', { workspaceId, environmentId, now: now + 60_002, leaseMs: 5000, limit: 10 })
    expect(commands[0]).toEqual(expect.objectContaining({ sequence: 1, type: 'shutdown' }))
    expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('needs_attention')
  }
})

test('overlapping durable permission and input wait for both host acknowledgements on the same row', async () => {
  const { convex, seeded, call, lifecycle, started, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([
    event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }),
    event(2, 'approval_requested', { requestKey: 'write', prompt: 'Write?', options: [{ id: 'allow', label: 'Allow' }], context: {} }),
    event(3, 'elicitation_requested', { requestKey: 'branch', prompt: 'Branch?', requestedSchema: { type: 'object' }, context: {} }),
  ], now + 1)
  const resolve = (requestKey: string, decision: string) => call('resolveRemoteRequestByServer', {
    actorUserId, workspaceId, conversationId: seeded.conversationId, runId: 'run-remote-turn', requestKey, decision, now: now + 2,
  })
  const ack = (commandId: unknown) => call('acknowledgeCommandByServer', { workspaceId, environmentId, commandId, accepted: true, now: now + 3 })
  const permission = await resolve('write', 'allow')
  await ack(permission.commandId)
  let snapshot = await projectedState(convex, started.messageId)
  expect(snapshot.run?.remoteLifecycle?.phase).toBe('waiting_for_input')
  expect(snapshot.session?.status).toBe('waiting_for_input')
  expect((await resolve('write', 'allow')).commandId).toBe(permission.commandId)
  const input = await resolve('branch', 'decline')
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('waiting_for_input')
  await ack(input.commandId)
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('running')
  await events([event(4, 'completed', { usage: {} })], now + 4)
  snapshot = await projectedState(convex, started.messageId)
  expect(snapshot.run?.status).toBe('completed')
  expect(snapshot.message?._id).toBe(started.messageId)
})

test('canonical request projection preserves decisions and closes lost execution context across later output', async () => {
  const { convex, seeded, call, lifecycle, started, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  const request = (sequence: number, requestKey: string) => event(sequence, 'approval_requested', {
    requestKey, prompt: 'Allow?', options: [{ id: 'allow', label: 'Allow' }], context: {},
  })
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }), request(2, 'answered'), request(3, 'lost')], now + 1)
  await call('resolveRemoteRequestByServer', { actorUserId, workspaceId, conversationId: seeded.conversationId,
    runId: 'run-remote-turn', requestKey: 'answered', decision: 'allow', now: now + 2 })
  await events([event(4, 'process_observation', { process: 'lost' }), event(5, 'text_checkpoint', { text: 'late buffered output' })], now + 3)
  const snapshot = await projectedState(convex, started.messageId)
  expect(snapshot.run?.remoteLifecycle?.cause).toBe('approval_context_lost')
  expect(snapshot.message?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ requestKey: 'answered', state: 'resolved', resolution: expect.objectContaining({ decision: 'allow' }) }) }),
    expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ requestKey: 'lost', state: 'resolved', resolution: expect.objectContaining({ decision: 'approval_context_lost' }) }) }),
  ]))
  await expect(call('resolveRemoteRequestByServer', { actorUserId, workspaceId, conversationId: seeded.conversationId,
    runId: 'run-remote-turn', requestKey: 'lost', decision: 'allow', now: now + 4 })).rejects.toThrow(/ALREADY_RESOLVED/)
})


test('cancellation before coordinator claim delivers shutdown and cancel without blocking later sequences', async () => {
  const { call, seeded, convex, started } = await durableFixture()
  await call('controlRemoteAgentTurnByServer', { actorUserId, workspaceId, conversationId: seeded.conversationId,
    runId: 'run-remote-turn', action: 'cancel', queueExpiresAt: now + 60_000, now: now + 1 })
  const commands = await call<Array<{ type: string; sequence: number }>>('claimCommandsByServer', {
    workspaceId, environmentId, now: now + 2, leaseMs: 5000, limit: 10,
  })
  expect(commands.map(command => command.type)).toEqual(['shutdown', 'cancel'])
  expect(commands.map(command => command.sequence)).toEqual([1, 2])
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('cancelled')
})

test('fresh lifecycle attempt uses a strict executable start rather than checkpoint references', async () => {
  const { convex, call, lifecycle, seeded, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await call('claimCommandsByServer', { workspaceId, environmentId, now, leaseMs: 5000, limit: 10 })
  await call('acknowledgeCommandByServer', { workspaceId, environmentId, commandId: 'command-remote-turn', accepted: true, now: now + 1 })
  await events([event(1, 'session_started', { remoteSessionId: 'old', adapterId: 'acp' }),
    event(2, 'approval_requested', { requestKey: 'old-write', prompt: 'Old write?', options: [{ id: 'allow', label: 'Allow' }], context: {} }),
    event(3, 'process_observation', { process: 'unknown' })], now + 2)
  const fresh = await call<{ applied: boolean; commandId: string }>('controlRemoteAgentTurnByServer', {
    actorUserId, workspaceId, conversationId: seeded.conversationId, runId: 'run-remote-turn',
    action: 'start_fresh', queueExpiresAt: now + 60_000, now: now + 3,
  })
  expect(fresh.applied).toBe(true)
  const run = await convex.run(ctx => ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).unique())
  const message = await convex.run(ctx => ctx.db.get(run!.assistantMessageId))
  expect(message?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ requestKey: 'old-write', state: 'resolved' }) }),
    expect.objectContaining({ type: 'data-remote-agent-status', data: expect.objectContaining({ state: 'recovering' }) }),
  ]))
  const oldRequest = await convex.run(ctx => ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', 'session-remote-turn').eq('requestKey', 'old-write')).unique())
  expect(oldRequest?.resolution?.decision).toBe('execution_replaced')
  const commands = await call<Array<{ id: string; runId: string; sequence: number; type: string; payload: unknown }>>('claimCommandsByServer', {
    workspaceId, environmentId, now: now + 4, leaseMs: 5000, limit: 10,
  })
  const command = commands.find(command => command.id === fresh.commandId)!
  const parsed = agentHostCommandSchema.safeParse({ protocolVersion: 1, commandId: command.id,
    environmentId, workspaceId, runId: command.runId, sequence: command.sequence, issuedAt: now,
    type: command.type, payload: command.payload })
  expect(parsed.success).toBe(true)
  expect(command.payload).toEqual(expect.objectContaining({ prompt: 'work', fresh: true, metadata: {} }))
  const replacement = run!.remoteLifecycle!.currentAttemptId
  const result = await call('applyRemoteEventsByServer', {
    workspaceId, environmentId, sessionId: replacement, now: now + 5,
    events: [event(1, 'session_started', { remoteSessionId: 'new', adapterId: 'acp' }),
      event(2, 'approval_requested', { requestKey: 'new-write', prompt: 'New write?', options: [{ id: 'allow', label: 'Allow' }], context: {} })]
      .map(e => ({ ...e, execution: { attemptId: replacement, generation: 2, hostBootId: 'boot-after-restart' } })),
  })
  expect(result).toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 2 }))
  expect(result).not.toHaveProperty('stale')
  const active = await projectedState(convex, run!.assistantMessageId)
  expect(active.run?.remoteLifecycle?.phase).toBe('waiting_for_approval')
  expect(active.message?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'data-remote-agent-request', data: expect.objectContaining({ requestKey: 'new-write', state: 'pending' }) }),
  ]))
  const mcp = { workspaceId, environmentId, runId: 'run-remote-turn', prompt: 'Allow old MCP call?', now: now + 6 }
  expect(await call('requestMcpApprovalByServer', { ...mcp, requestKey: 'mcp:replayed' })).toEqual({ state: 'unavailable' })
  expect(await call('requestMcpApprovalByServer', { ...mcp, requestKey: 'mcp:replayed', sessionId: 'session-remote-turn',
    execution: { attemptId: 'session-remote-turn', generation: 1 } })).toEqual({ state: 'unavailable' })
  expect(await convex.run(ctx => ctx.db.query('agentApprovalRequests')
    .withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', replacement).eq('requestKey', 'mcp:replayed')).unique())).toBeNull()
  expect(await call('requestMcpApprovalByServer', { ...mcp, requestKey: 'mcp:expired', sessionId: replacement,
    execution: { attemptId: replacement, generation: 2 }, expiresAt: now + 6 })).toEqual({ state: 'unavailable' })
  expect(await call('requestMcpApprovalByServer', { ...mcp, requestKey: 'mcp:current', sessionId: replacement,
    execution: { attemptId: replacement, generation: 2 }, expiresAt: now + 60000 })).toEqual({ state: 'pending' })
})

test('legacy Stop preserves text and tools, accepts buffered output until stop confirmation and fences later text', async () => {
  const convex = convexTest(schema, modules); const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput())
  const started = await call('startRemoteAgentTurnByServer', startInput(seeded)) as { messageId: string }
  const apply = (events: ReturnType<typeof event>[], at: number) => call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: at })
  await apply([event(1, 'text_checkpoint', { text: 'Keep this answer' }), event(2, 'action', { actionId: 'tool', title: 'Research', status: 'started' })], now + 1)
  await call('controlRemoteAgentTurnByServer', { actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn', action: 'cancel', queueExpiresAt: now + 60_000, now: now + 2 })
  let state = await projectedState(convex, started.messageId)
  expect(state.message?.content).toBe('Keep this answer')
  expect(state.message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool-invocation', toolInvocation: expect.objectContaining({ toolOutput: expect.objectContaining({ status: 'cancelled' }) }) })]))
  await apply([event(3, 'text_checkpoint', { text: 'Keep this answer and its buffered tail' }), event(4, 'completed', { usage: {} }), event(5, 'cancelled', {})], now + 3)
  state = await projectedState(convex, started.messageId)
  expect(state.run?.status).toBe('cancelled')
  expect(state.message?.content).toBe('Keep this answer and its buffered tail')
  await apply([event(6, 'text_checkpoint', { text: 'Should never replace cancelled output' })], now + 4)
  expect((await projectedState(convex, started.messageId)).message?.content).toBe('Keep this answer and its buffered tail')
})

test('Stop before any text uses Cancelled and observations do not rewrite an unchanged message', async () => {
  const convex = convexTest(schema, modules); const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput())
  const started = await call('startRemoteAgentTurnByServer', startInput(seeded)) as { messageId: string }
  const apply = (events: ReturnType<typeof event>[], at: number) => call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: at })
  await apply([event(1, 'session_started', { remoteSessionId: 'provider-session', adapterId: 'fake' })], now + 1)
  const before = await projectedState(convex, started.messageId)
  await apply([event(2, 'process_observation', { process: 'live' })], now + 2)
  const after = await projectedState(convex, started.messageId)
  expect(after.message?.updatedAt).toBe(before.message?.updatedAt)
  expect(after.run?.streamStats?.messageWrites).toBe(before.run?.streamStats?.messageWrites)
  await call('controlRemoteAgentTurnByServer', { actorUserId, conversationId: seeded.conversationId, workspaceId, runId: 'run-remote-turn', action: 'cancel', queueExpiresAt: now + 60_000, now: now + 3 })
  expect((await projectedState(convex, started.messageId)).message?.content).toBe('Cancelled')
})

test('negotiated deltas are idempotent and a refused offset leaves the event cursor available for retry', async () => {
  const convex = convexTest(schema, modules); const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput())
  const started = await call('startRemoteAgentTurnByServer', startInput(seeded)) as { messageId: string }
  const apply = (events: ReturnType<typeof event>[], at: number) => call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: at })
  await apply([event(1, 'text_checkpoint', { text: 'Hello' }), event(2, 'text_delta', { offset: 5, text: ' world' })], now + 1)
  expect((await projectedState(convex, started.messageId)).message?.content).toBe('Hello world')
  expect(await apply([event(2, 'text_delta', { offset: 5, text: ' world' })], now + 2)).toEqual(expect.objectContaining({ accepted: true, duplicate: true }))
  expect(await apply([event(3, 'text_delta', { offset: 100, text: 'gap' })], now + 3)).toEqual({ accepted: false, expectedSequence: 3 })
  const before = await projectedState(convex, started.messageId)
  await apply([event(3, 'heartbeat', { quietMs: 180000, openTools: [{ actionId: 'slow', title: 'Slow tool', runningMs: 180000 }], process: 'live', stalled: false })], now + 4)
  const after = await projectedState(convex, started.messageId)
  expect(after.message?.content).toBe('Hello world')
  expect(after.message?.updatedAt).toBe(before.message?.updatedAt)
  expect(after.run?.streamStats?.messageWrites).toBe(before.run?.streamStats?.messageWrites)
  expect(after.run?.liveness?.openTools[0]?.title).toBe('Slow tool')
  expect(after.run?.liveness?.stalled).toBe(false)
})

test('explicit remote-run readback is restricted to the authorized conversation', async () => {
  const convex = convexTest(schema, modules); const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput()); await call('startRemoteAgentTurnByServer', startInput(seeded))
  const ref = makeFunctionReference<'query'>('chat/conversations:getLatestAgentRun')
  const args = { serverSecret: secret, conversationId: seeded.conversationId, userId: actorUserId, remoteRunId: 'run-remote-turn' }
  expect(await convex.query(ref, args)).toEqual(expect.objectContaining({ externalRunId: 'run-remote-turn' }))
  expect(await convex.query(ref, { ...args, remoteRunId: 'foreign-run' })).toBeNull()
  await expect(convex.query(ref, { ...args, userId: 'another-person' })).rejects.toThrow(/Unauthorized/)
})

test('megabyte delta output stays lossless across storage, authorized reads, Stop and hard deletion with fewer message writes', async () => {
  const convex = convexTest(schema, modules)
  const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput())
  const started = await call('startRemoteAgentTurnByServer', startInput(seeded)) as { messageId: string }
  const delta = '🙂 markdown **continues** across packets\n'.repeat(50)
  let content = ''
  for (let index = 0; index < 560; index++) {
    const accepted = await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(index + 1, 'text_delta', { offset: content.length, text: delta })], now: now + index + 1 })
    expect(accepted).toEqual(expect.objectContaining({ accepted: true }))
    content += delta
  }
  expect(new TextEncoder().encode(content).byteLength).toBeGreaterThan(1_000_000)
  const stored = await projectedState(convex, started.messageId)
  expect(stored.message!.content.length).toBeLessThanOrEqual(2048)
  expect(stored.run!.streamStats!.messageWrites).toBeLessThan(56)
  const hydrated = await convex.run(async ctx => {
    const message = await ctx.db.get(started.messageId as never)
    if (!message) throw Error('missing message')
    return hydrateRemoteMessage(ctx, message)
  })
  expect(hydrated.content).toBe(content)
  expect(hydrated.parts?.filter(part => part.type === 'text')).toEqual([{ type: 'text', text: content }])
  const chunks = await convex.run(ctx => ctx.db.query('remoteMessageTextChunks').collect())
  expect(chunks.every(chunk => new TextEncoder().encode(JSON.stringify(chunk)).byteLength < 200_000)).toBe(true)
  const read = makeFunctionReference<'query'>('chat/conversations:getMessages')
  const args = { serverSecret: secret, conversationId: seeded.conversationId, userId: actorUserId }
  const messages = await convex.query(read, args) as Array<{ _id: string; content: string }>
  expect(messages.find(message => message._id === started.messageId)?.content).toBe(content)
  const roomHistory = await convex.query(makeFunctionReference<'query'>('collaboration/directMessages:listMessages'), {
    serverSecret: secret, actorUserId, workspaceId, conversationId: seeded.conversationId, limit: 100,
  })
  expect(roomHistory.find((row: { _id: string }) => row._id === started.messageId)?.content).toBe(content)
  expect(await convex.query(read, { ...args, userId: 'foreign-user' })).toEqual([])
  await call('controlRemoteAgentTurnByServer', { actorUserId, conversationId: seeded.conversationId, workspaceId,
    runId: 'run-remote-turn', action: 'cancel', queueExpiresAt: now + 60_000, now: now + 1000 })
  const stopped = await convex.query(read, args) as Array<{ _id: string; content: string }>
  expect(stopped.find(message => message._id === started.messageId)?.content).toBe(content)
  const buffered = 'buffered before Stop\n'.repeat(2000)
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
    events: [event(561, 'text_delta', { offset: content.length, text: buffered }), event(562, 'cancelled', {})], now: now + 1001 })
  const drained = await convex.query(read, args) as Array<{ _id: string; content: string }>
  expect(drained.find(message => message._id === started.messageId)?.content).toBe(content + buffered)
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
    events: [event(563, 'text_delta', { offset: content.length + buffered.length, text: 'must be fenced' })], now: now + 1002 })
  const fenced = await convex.query(read, args) as Array<{ _id: string; content: string }>
  expect(fenced.find(message => message._id === started.messageId)?.content).toBe(content + buffered)
  const message = stored.message!
  await convex.mutation(makeFunctionReference<'mutation'>('chat/conversations:deleteTurn'), { ...args, turnId: message.turnId })
  expect(await convex.run(ctx => ctx.db.query('remoteMessageTextChunks').collect())).toHaveLength(0)
}, 60000)

test('fresh heartbeat proof keeps a long lifecycle-v2 tool running without rewriting its transcript', async () => {
  const { convex, lifecycle, started, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }),
    event(2, 'action', { actionId: 'slow', title: 'Long tool', status: 'started' })], now + 1)
  const before = await projectedState(convex, started.messageId)
  await events([event(3, 'heartbeat', { process: 'live', quietMs: 180000, stalled: false,
    openTools: [{ actionId: 'slow', title: 'Long tool', runningMs: 180000 }] })], now + 180001)
  await lifecycle('advance', { ...owner, now: now + 180002 })
  const after = await projectedState(convex, started.messageId)
  expect(after.run?.status).toBe('running')
  expect(after.run?.remoteLifecycle?.lastHealthAt).toBe(now + 180001)
  expect(after.message?.updatedAt).toBe(before.message?.updatedAt)
  expect(after.run?.liveness?.stalled).toBe(false)
})

test('real room subscriptions supersede HTTP snapshots even for same-millisecond chunk-only updates', async () => {
  const convex = convexTest(schema, modules)
  const seeded = await seedRoom(convex)
  const call = (operation: string, args: Record<string, unknown>) => convex.mutation(mutationRef(operation), { ...args, serverSecret: secret })
  await call('upsertBindingByServer', bindingInput())
  const started = await call('startRemoteAgentTurnByServer', startInput(seeded))
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(actorUserId)
    .setIssuer('overlay-browser-convex').setAudience('overlay-convex').setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret))
  const watch = async () => {
    const result = await convex.query(makeFunctionReference<'query'>('collaboration/directMessages:watchRoomMessages'), {
      accessToken: token, actorUserId, workspaceId, conversationId: seeded.conversationId, limit: 100, mainOnly: true,
    })
    expect(result.ok).toBe(true)
    return result.messages.find((message: RoomMessageRecord) => message.id === started.messageId) as RoomMessageRecord
  }
  const firstText = 'a'.repeat(3000)
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
    events: [event(1, 'text_delta', { offset: 0, text: firstText })], now: now + 1 })
  const snapshot = await watch()
  const parentBefore = await convex.run(ctx => ctx.db.get(started.messageId))
  await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
    events: [event(2, 'text_delta', { offset: firstText.length, text: 'continued' })], now: now + 1 })
  const live = await watch()
  const parentAfter = await convex.run(ctx => ctx.db.get(started.messageId))
  expect(parentAfter).toEqual(parentBefore)
  expect(live.content).toBe(firstText + 'continued')
  expect(live.updatedAt).toBe(snapshot.updatedAt)
  expect(live.eventSequence).toBeGreaterThan(snapshot.eventSequence!)
  expect(mergeRoomMessages([live], [snapshot])[0]?.content).toBe(live.content)
  expect(mergeRoomMessages([snapshot], [live])[0]?.content).toBe(live.content)
  const httpRows = await convex.query(makeFunctionReference<'query'>('collaboration/directMessages:listMessages'), {
    serverSecret: secret, actorUserId, workspaceId, conversationId: seeded.conversationId, limit: 100,
  })
  const http = httpRows.find((row: { _id: string }) => row._id === started.messageId)
  expect(http?.eventSequence).toBe(live.eventSequence)
  expect(http?.content).toBe(live.content)
  await expect(convex.query(makeFunctionReference<'query'>('collaboration/directMessages:listMessages'), {
    serverSecret: secret, actorUserId: 'foreign-user', workspaceId, conversationId: seeded.conversationId, limit: 100,
  })).rejects.toThrow(/WORKSPACE_ACCESS_DENIED/)
})
