import { SignJWT } from 'jose'
import { mergeRoomMessages, type RoomMessageRecord } from '../src/features/chat/components/collaboration/room-message-view'
import { agentHostCommandSchema, nativeStartAdmissionSchema } from '../packages/overlay-agent-bridge-protocol/src/index'
import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { internal } from './_generated/api'
import { hydrateRemoteMessage } from './lib/remoteMessageText'
import {nativeRestorationSnapshotSchema} from './lib/nativeRecoveryPayload'

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
  test('a legacy fresh retry retains the committed prefix and receives its canonical offset', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    const prefix = 'Preserve this answer 🙂'
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(1, 'text_checkpoint', { text: prefix }), event(2, 'failed', { code: 'offline', message: 'Offline', retryable: true })], now: now + 1 })
    const fresh = await call<{ applied: boolean; commandId: string }>('controlRemoteAgentTurnByServer', {
      actorUserId, workspaceId, conversationId: seeded.conversationId, runId: 'run-remote-turn',
      action: 'start_fresh', queueExpiresAt: now + 60_000, now: now + 2,
    })
    expect(fresh.applied).toBe(true)
    const commands = await call<Array<{ id: string; payload: { metadata: Record<string, unknown> } }>>('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 3, leaseMs: 5000, limit: 10,
    })
    expect(commands.find(command => command.id === fresh.commandId)?.payload.metadata.recoveryTextOffset).toBe(prefix.length)
    await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(3, 'session_started', { remoteSessionId: 'new', adapterId: 'acp' }),
        event(4, 'text_delta', { offset: prefix.length, text: '\nNew output' })], now: now + 4 })
    expect((await projectedState(convex, started.messageId)).message?.content).toBe(prefix + '\nNew output')
  })

  test('drive progress persists on the original assistant row and a retried batch settles exactly once', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
    const entries = [{ fileId: 'report-file', path: 'report.md', kind: 'file' }]
    const events = [event(1, 'text_checkpoint', { text: 'Report complete' }),
      event(2, 'drive_sync', { state: 'saving' }),
      event(3, 'drive_sync', { state: 'unsaved', code: 'DRIVE_SYNC_FAILED', message: 'Local copies kept' }),
      event(4, 'drive_sync', { state: 'saved', fileCount: 1, folderCount: 0, entries }),
      event(5, 'completed', { usage: {} })]
    const progress = { workspaceId, environmentId, sessionId: 'session-remote-turn', events: events.slice(0, 3), now: now + 99 }
    expect(await call('applyRemoteEventsByServer', progress)).toMatchObject({ accepted: true, duplicate: false })
    const pending = await projectedState(convex, started.messageId)
    expect(pending.message?.parts?.find(part => part.type === 'data-remote-agent-drive')?.data).toMatchObject({ state: 'unsaved' })
    const input = { workspaceId, environmentId, sessionId: 'session-remote-turn', events: events.slice(3), now: now + 100 }
    expect(await call('applyRemoteEventsByServer', input)).toMatchObject({ accepted: true, duplicate: false })
    const state = await projectedState(convex, started.messageId)
    expect(state.message?.content).toBe('Report complete')
    expect(state.message?.parts?.filter(part => part.type === 'data-remote-agent-drive')).toEqual([
      { type: 'data-remote-agent-drive', data: { key: 'drive', state: 'saved', fileCount: 1, folderCount: 0, entries } },
    ])
    expect(await call('applyRemoteEventsByServer', { ...input, now: now + 101 })).toMatchObject({ accepted: true, duplicate: true })
    expect((await projectedState(convex, started.messageId)).eventCount).toBe(state.eventCount)
  })

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

async function durableFixture(overrides: Record<string, unknown> = {}) {
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
  const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded, { lifecycleVersion: 2, maxRunTimeMs: 3_600_000, reservationId: 'reservation-remote-turn', ...overrides }))
  const events = (items: Array<ReturnType<typeof event>>, at: number) => call('applyRemoteEventsByServer', {
    workspaceId, environmentId, sessionId: 'session-remote-turn', now: at,
    events: items.map(e => ({ ...e, execution: { attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-1' } })),
  })
  return { convex, seeded, call, lifecycle, started, events }
}

async function providerStopFixture() {
  const fixture = await durableFixture({sandboxBilling: {leaseId: 'recovery-lease'}})
  const owner = {runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now}
  await fixture.lifecycle('claim', owner)
  await fixture.lifecycle('advance', owner)
  await fixture.events([event(1, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp'}),
    event(2, 'process_observation', {process: 'unknown'})], now + 2)
  const lease = {leaseId: 'recovery-lease', workspaceId, environmentId, provider: 'box', providerReference: 'owned-machine',
    status: 'running', reservedUntil: now + 3_600_000, usage: {}, cleanupAttempts: 0, createdAt: now - 100, updatedAt: now}
  const leaseDocId = await fixture.convex.run(ctx => ctx.db.insert('agentSandboxLeases', lease))
  const snapshot = await projectedState(fixture.convex, fixture.started.messageId)
  if (!snapshot.run?.remoteLifecycle) throw Error('Missing lifecycle fixture')
  return {...fixture, lease, leaseDocId, input: {runId: 'run-remote-turn', environmentId, leaseId: lease.leaseId,
    providerReference: lease.providerReference, attemptId: 'session-remote-turn', generation: 1,
    expectedRevision: snapshot.run.remoteLifecycle.revision, now: now + 3}}
}

test('provider stop proof is durable and idempotent for its exact execution, but cannot revive cancellation', async () => {
  const {convex, lifecycle, call, seeded, started, input} = await providerStopFixture()
  const before = await projectedState(convex, started.messageId)
  expect(await lifecycle('recordProviderStop', input)).toBe(true)
  expect(await lifecycle('recordProviderStop', input)).toBe(true)
  const after = await projectedState(convex, started.messageId)
  expect(after.run?.remoteLifecycle).toMatchObject({phase: 'needs_attention', revision: input.expectedRevision + 1,
    providerStop: {provider: 'box', environmentId, leaseId: input.leaseId, providerReference: input.providerReference,
      attemptId: input.attemptId, executionGeneration: input.generation, observedAt: input.now, recordedAtRevision: input.expectedRevision}})
  expect(after.message).toEqual(before.message)
  await call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: seeded.conversationId,
    runId: input.runId, action: 'cancel', queueExpiresAt: now + 60_000, now: now + 4})
  expect(await lifecycle('recordProviderStop', input)).toBe(false)
})

test('provider stop proof rejects stale and cross-scope facts and requires the server credential', async () => {
  const {convex, lifecycle, started, input} = await providerStopFixture()
  for (const change of [{attemptId: 'old-attempt'}, {generation: 2}, {expectedRevision: input.expectedRevision - 1},
    {environmentId: 'other-environment'}, {leaseId: 'other-lease'}, {providerReference: 'other-machine'},
    {runId: 'other-run'}, {now: now - 1}, {now: now + 3_600_001}]) {
    expect(await lifecycle('recordProviderStop', {...input, ...change})).toBe(false)
  }
  await expect(convex.mutation(makeFunctionReference<'mutation'>('agents/remoteRuns:recordProviderStopByServer'), {
    ...input, serverSecret: 'wrong-secret',
  })).rejects.toThrow(/Unauthorized/)
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.providerStop).toBeUndefined()
})

test('a fresh attempt clears the previous provider stop receipt', async () => {
  const {convex, lifecycle, call, seeded, started, input} = await providerStopFixture()
  expect(await lifecycle('recordProviderStop', input)).toBe(true)
  expect(await call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: seeded.conversationId,
    runId: input.runId, action: 'start_fresh', queueExpiresAt: now + 60_000, now: now + 4})).toMatchObject({applied: true})
  const state = (await projectedState(convex, started.messageId)).run?.remoteLifecycle
  expect(state?.executionGeneration).toBe(2)
  expect(state?.providerStop).toBeUndefined()
  expect(await lifecycle('recordProviderStop', input)).toBe(false)
})

test('stopping a replacement or ambiguous machine cannot authorize the original native execution', async () => {
  const {convex, lifecycle, input, lease, leaseDocId} = await providerStopFixture()
  await convex.run(ctx => ctx.db.insert('agentSandboxLeases', {...lease, leaseId: 'replacement-lease',
    providerReference: 'replacement-machine', createdAt: now + 1, updatedAt: now + 1}))
  expect(await lifecycle('recordProviderStop', input)).toBe(false)
  await convex.run(ctx => ctx.db.patch(leaseDocId, {status: 'released'}))
  expect(await lifecycle('recordProviderStop', {...input, leaseId: 'replacement-lease', providerReference: 'replacement-machine'})).toBe(false)
})

test('provider stop proof refuses a foreign, released, unsupported or revoked machine scope', async () => {
  const {convex, lifecycle, input, lease, leaseDocId} = await providerStopFixture()
  for (const change of [{provider: 'e2b'}, {workspaceId: 'other-workspace'}, {environmentId: 'other-environment'}, {status: 'released'}]) {
    await convex.run(ctx => ctx.db.patch(leaseDocId, change))
    expect(await lifecycle('recordProviderStop', input)).toBe(false)
    await convex.run(ctx => ctx.db.patch(leaseDocId, lease))
  }
  await convex.run(async ctx => {
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
    if (!environment) throw Error('Missing environment fixture')
    await ctx.db.patch(environment._id, {revokedAt: now + 2})
  })
  expect(await lifecycle('recordProviderStop', input)).toBe(false)
})

async function nativeQueueFixture() {
  const f = await providerStopFixture()
  await f.convex.run(async ctx => {
    await ctx.db.insert('workspaceAgentDefinitions', {agentId, workspaceId, principalId: agentPrincipalId,
      name: 'Native recovery fixture', instructions: '', harness: 'codex', modelId: 'byo/codex', allowedToolIds: [], visibility: 'creator',
      createdByPrincipalId: actorPrincipalId, invocationPolicy: 'mention', createdAt: now, updatedAt: now})
    const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.input.attemptId)).unique()
    const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', 'command-remote-turn')).unique()
    if (!attempt || !command) throw Error('Missing native fixture')
    await ctx.db.patch(attempt._id, {capabilitySnapshot: {...attempt.capabilitySnapshot,
      adapters: [{id: 'acp', protocol: 'acp', recovery: {sessionLoading: true, fencedSessionRestoration: true}}]}})
    await ctx.db.patch(command._id, {payload: {...command.payload, metadata: {...command.payload.metadata,
      model: 'original-model', effort: 'high', overlayMcp: {url: 'https://preview.invalid/api/agent-mcp', token: 'original-grant'},
      overlayDrive: {version: 1, sessionId: f.input.attemptId, location: 'cloud'}}}})
  })
  const prefix = 'Keep the full answer before interruption 🙂\n'.repeat(100)
  await f.events([event(3, 'text_delta', {offset: 0, text: prefix})], now + 3)
  const before = await projectedState(f.convex, f.started.messageId)
  if (!before.run?.remoteLifecycle) throw Error('Missing lifecycle')
  const stop = {...f.input, expectedRevision: before.run.remoteLifecycle.revision, now: now + 4}
  expect(await f.lifecycle('recordProviderStop', stop)).toBe(true)
  const input = {runId: stop.runId, attemptId: stop.attemptId, generation: stop.generation, leaseId: stop.leaseId,
    providerReference: stop.providerReference, coordinatorId: 'owner', coordinatorGeneration: 1,
    expectedRevision: stop.expectedRevision + 1, now: now + 5}
  const begin = (change: Record<string, unknown> = {}) => f.convex.mutation(makeFunctionReference<'mutation'>('agents/nativeRecovery:beginByServer'),
    {...input, ...change, serverSecret: secret})
  return {...f, input, begin, prefix}
}

test('native continuation queues one new generation on the same assistant with original settings and fresh drive scope', async () => {
  const {convex, started, begin, prefix, input} = await nativeQueueFixture()
  expect(await begin()).toBe(true)
  expect(await begin()).toBe(true)
  const result = await projectedState(convex, started.messageId)
  expect(result.run?.assistantMessageId).toBe(started.messageId)
  const hydrated = await convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', input.runId)).unique()
    const message = run && await ctx.db.get(run.assistantMessageId)
    if (!message) throw Error('Missing restored message')
    return hydrateRemoteMessage(ctx, message)
  })
  expect(hydrated.content).toBe(prefix)
  expect(result.run?.remoteLifecycle).toMatchObject({executionGeneration: 2, phase: 'recovering', cause: 'native_restoration',
    hardDeadlineAt: now + 3_600_000, claimDeadlineAt: input.now + 120_000})
  const commands = await convex.run(ctx => ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', input.runId)).take(10))
  const continuation = commands.find(command => command.type === 'start')
  expect(continuation?.payload).toMatchObject({sessionId: 'native-session', fresh: false,
    metadata: {model: 'original-model', effort: 'high', recoveryTextOffset: prefix.length,
      overlayMcp: {token: 'original-grant'}, overlayDrive: {sessionId: result.run?.remoteLifecycle?.currentAttemptId}},
    restore: {previousExecution: {attemptId: input.attemptId, generation: 1, hostBootId: 'boot-1'},
      providerStop: {leaseId: input.leaseId, providerReference: input.providerReference}}})
  expect(continuation?.payload.prompt).toContain('You were interrupted')
  expect(commands.filter(command => command.type === 'start')).toHaveLength(1)
  expect(commands.find(command => command.commandId === 'command-remote-turn')?.type).toBe('shutdown')
  const attempts = await convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', input.runId)).take(10))
  expect(attempts).toHaveLength(2)
})

test('native continuation refuses stale coordinator, execution, receipt and machine facts', async () => {
  const {begin, input} = await nativeQueueFixture()
  for (const change of [{coordinatorId: 'other'}, {coordinatorGeneration: 2}, {attemptId: 'other'}, {generation: 2},
    {expectedRevision: input.expectedRevision - 1}, {leaseId: 'other'}, {providerReference: 'other'}, {now: now + 3_600_001}])
    expect(await begin(change)).toBe(false)
})

async function nativeRetryFixture() {
  const f = await nativeQueueFixture()
  expect(await f.begin()).toBe(true)
  await f.call('claimCommandsByServer', {workspaceId, environmentId, now: now + 6, leaseMs: 5000, limit: 10})
  const command = await f.convex.run(async ctx => {
    const commands = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', f.input.runId)).take(10)
    const start = commands.find(command => command.type === 'start')
    if (!start?.attemptId) throw Error('Missing continuation command')
    return start
  })
  const reject = (commandId = command.commandId, code = 'native_preparation_retryable', at = now + 10) =>
    f.call('acknowledgeCommandByServer', {workspaceId, environmentId, commandId, accepted: false, errorCode: code, now: at})
  return {...f, command, reject}
}

async function admitNativeFixture(f: Pick<Awaited<ReturnType<typeof nativeQueueFixture>>, 'convex' | 'call' | 'started'>,
  boot = 'new-boot', at = now + 7) {
  const current = await f.convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).unique()
    if (!run?.remoteLifecycle) throw Error('Missing lifecycle')
    const attemptId = run.remoteLifecycle.currentAttemptId
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', attemptId)).unique()
    if (!session?.restorationCommandId) throw Error('Missing restoration delivery')
    const restoration = nativeRestorationSnapshotSchema.parse(session.capabilitySnapshot).nativeRestoration
    const source = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', restoration.previousExecution.attemptId)).unique()
    if (!source) throw Error('Missing restoration source')
    return {session, source, restoration}
  })
  const request = {workspaceId, environmentId, sessionId: current.session.sessionId, now: at,
    events: [{...event(current.session.eventCursor + 1, 'native_start_requested', {commandId: current.session.restorationCommandId,
      remoteSessionId: current.restoration.nativeSessionId, adapterId: 'acp', sourceEventCursor: current.source.eventCursor}),
      eventId: `admit-${current.session.sessionId}`, execution: {attemptId: current.session.sessionId,
        generation: current.session.executionGeneration, hostBootId: boot}}]}
  const response = await f.call('applyRemoteEventsByServer', request)
  return {request, admitted: nativeStartAdmissionSchema.parse(response.nativeStartAdmission)}
}

test('native start admission binds a drained source and full canonical cursor without claiming health, and its lost ACK is idempotent', async () => {
  const f = await nativeRetryFixture()
  const {request, admitted} = await admitNativeFixture(f)
  expect(admitted).toMatchObject({commandId: f.command.commandId, attemptId: f.command.attemptId, generation: 2,
    hostBootId: 'new-boot', sourceEventCursor: 3, canonicalTextOffset: f.prefix.length, hardDeadlineAt: now + 3600000})
  const before = await projectedState(f.convex, f.started.messageId)
  expect(before.run?.remoteLifecycle?.lastHealthAt).toBeUndefined()
  expect(before.run?.remoteLifecycle?.recoveryOutcome).toBeUndefined()
  expect(await f.call('applyRemoteEventsByServer', request)).toMatchObject({accepted: true, duplicate: true, nativeStartAdmission: admitted})
  expect((await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle?.revision).toBe(before.run?.remoteLifecycle?.revision)
  expect(await f.begin({observedStoppedAt: now + 9, now: now + 10})).toBe(false, 'an admitted provider start is no longer retryable preparation')
  await f.call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: f.seeded.conversationId,
    runId: f.input.runId, action: 'cancel', queueExpiresAt: now + 60000, now: now + 11})
  expect(await f.call('applyRemoteEventsByServer', {...request, now: now + 12})).not.toHaveProperty('nativeStartAdmission')
})

test('drained native admission settles interrupted work without losing completed work or closing the next writer', async () => {
  const f = await nativeRetryFixture()
  const buffered = [event(4, 'action', {actionId: 'interrupted', title: 'Old terminal', status: 'started'}),
    event(5, 'terminal', {terminalId: 'interrupted', title: 'Old terminal', status: 'running', text: 'Retained terminal output'}),
    event(6, 'action', {actionId: 'finished', title: 'Finished work', status: 'started'}),
    event(7, 'action', {actionId: 'finished', title: 'Finished work', status: 'completed'})]
    .map(item => ({...item, occurredAt: now + 3, execution: {attemptId: 'session-remote-turn', generation: 1, hostBootId: 'boot-1'}}))
  expect(await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: 'session-remote-turn', events: buffered, now: now + 6})).toMatchObject({accepted: true})
  const before = await projectedState(f.convex, f.started.messageId)
  expect(before.run?.streamStats?.openTools.map(tool => tool.actionId)).toEqual(['interrupted'])
  await expect(f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.command.attemptId, now: now + 7,
    events: [{...event(1, 'native_start_requested', {commandId: f.command.commandId, remoteSessionId: 'native-session', adapterId: 'acp', sourceEventCursor: 6}),
      execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'new-boot'}}],
  })).rejects.toThrow('AGENT_NATIVE_SOURCE_NOT_DRAINED')
  const rejected = await projectedState(f.convex, f.started.messageId)
  expect(rejected.message).toEqual(before.message)
  expect(rejected.run?.streamStats).toEqual(before.run?.streamStats)
  const {request, admitted} = await admitNativeFixture(f)
  const after = await projectedState(f.convex, f.started.messageId)
  expect(after.run?.streamStats?.openTools).toEqual([])
  expect(after.run?.streamStats?.events).toBe((before.run?.streamStats?.events ?? 0) + 1)
  expect(after.run?.streamStats?.longestToolMs).toBe(1)
  expect(after.message?.parts).toContainEqual(expect.objectContaining({type: 'tool-invocation', toolInvocation: expect.objectContaining({
    toolCallId: 'interrupted', state: 'output-error', toolOutput: expect.objectContaining({status: 'cancelled', reason: 'execution_interrupted'}),
  })}))
  expect(after.message?.parts).toContainEqual(expect.objectContaining({type: 'data-remote-agent-terminal', data: expect.objectContaining({
    terminalId: 'interrupted', status: 'failed', resolution: 'interrupted', text: 'Retained terminal output',
  })}))
  const finished = (parts: NonNullable<typeof before.message>['parts']) => parts?.find(part => part.type === 'tool-invocation'
    && part.toolInvocation?.toolCallId === 'finished')
  expect(finished(after.message?.parts)).toEqual(finished(before.message?.parts))
  expect(await f.call('applyRemoteEventsByServer', request)).toMatchObject({accepted: true, duplicate: true})
  expect((await projectedState(f.convex, f.started.messageId)).message).toEqual(after.message)
  expect(await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: admitted.attemptId, now: now + 9,
    events: [event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: admitted.commandId}),
      event(3, 'action', {actionId: 'new-work', title: 'New terminal', status: 'started'})]
      .map(item => ({...item, eventId: `continued-${item.eventId}`, execution: {attemptId: admitted.attemptId, generation: 2, hostBootId: admitted.hostBootId}})),
  })).toMatchObject({accepted: true})
  const running = await projectedState(f.convex, f.started.messageId)
  expect(running.run?.streamStats?.openTools.map(tool => tool.actionId)).toEqual(['new-work'])
  expect(running.run?.remoteLifecycle?.recoveryOutcome).toBe('restored')
  expect(await f.call('applyRemoteEventsByServer', request)).toMatchObject({accepted: true, duplicate: true})
  const duplicate = await projectedState(f.convex, f.started.messageId)
  expect(duplicate.message).toEqual(running.message)
  expect(duplicate.run?.streamStats).toEqual(running.run?.streamStats)
  expect(await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: admitted.attemptId, now: now + 10,
    events: [event(4, 'action', {actionId: 'new-work', title: 'New terminal', status: 'completed'}), event(5, 'completed', {usage: {}})]
      .map(item => ({...item, eventId: `continued-${item.eventId}`, execution: {attemptId: admitted.attemptId, generation: 2, hostBootId: admitted.hostBootId}})),
  })).toMatchObject({accepted: true})
  const completed = await projectedState(f.convex, f.started.messageId)
  expect(completed.run?.status).toBe('completed')
  expect(completed.message?.parts).toContainEqual(expect.objectContaining({type: 'tool-invocation', toolInvocation: expect.objectContaining({
    toolCallId: 'interrupted', state: 'output-error', toolOutput: expect.objectContaining({status: 'cancelled', outcomeKnown: false}),
  })}))
  const content = await f.convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).unique()
    if (!run) throw Error('Missing run')
    const message = await ctx.db.get(run.assistantMessageId)
    if (!message) throw Error('Missing message')
    return (await hydrateRemoteMessage(ctx, message)).content
  })
  expect(content).toBe(f.prefix)
})

test('native admission refuses an undrained source without consuming the request or recording startup', async () => {
  const f = await nativeRetryFixture()
  const request = {workspaceId, environmentId, sessionId: f.command.attemptId, now: now + 7,
    events: [{...event(1, 'native_start_requested', {commandId: f.command.commandId, remoteSessionId: 'native-session', adapterId: 'acp', sourceEventCursor: 4}),
      execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'new-boot'}}]}
  await expect(f.call('applyRemoteEventsByServer', request)).rejects.toThrow('AGENT_NATIVE_SOURCE_NOT_DRAINED')
  const session = await f.convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.command.attemptId ?? '')).unique())
  expect(session?.nativeStartAdmission).toBeUndefined()
  expect(session?.eventCursor).toBe(0)
  expect(session?.hostBootId).toBeUndefined()
  expect(session?.startedAt).toBeUndefined()
  await admitNativeFixture(f)
})

test('native admission rechecks current access and funding even after the restoration command was claimed', async () => {
  for (const scenario of ['binding', 'funding', 'principal']) {
    const f = await nativeRetryFixture()
    await f.convex.run(async ctx => {
      if (scenario === 'binding') {
        const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', 'binding-remote-turn')).unique()
        if (!binding) throw Error('Missing binding')
        await ctx.db.patch(binding._id, {enabled: false})
      } else if (scenario === 'funding') {
        const reservation = await ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique()
        if (!reservation) throw Error('Missing reservation')
        await ctx.db.patch(reservation._id, {status: 'released'})
      } else {
        const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', actorPrincipalId)).unique()
        if (!principal) throw Error('Missing principal')
        await ctx.db.patch(principal._id, {archivedAt: now + 6})
      }
    })
    await expect(admitNativeFixture(f)).rejects.toThrow('AGENT_NATIVE_START_NOT_ADMITTED')
  }
})

test('a lost native-admission ACK cannot reauthorize a revoked binding', async () => {
  const f = await nativeRetryFixture(), {request} = await admitNativeFixture(f)
  await f.convex.run(async ctx => {
    const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', 'binding-remote-turn')).unique()
    if (!binding) throw Error('Missing binding')
    await ctx.db.patch(binding._id, {enabled: false})
  })
  await expect(f.call('applyRemoteEventsByServer', request)).rejects.toThrow('AGENT_NATIVE_START_NOT_ADMITTED')
})

test('a same-batch failure cannot return permission to launch a native process', async () => {
  const f = await nativeRetryFixture()
  const response = await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.command.attemptId, now: now + 7,
    events: [event(1, 'native_start_requested', {commandId: f.command.commandId, remoteSessionId: 'native-session', adapterId: 'acp', sourceEventCursor: 3}),
      event(2, 'failed', {code: 'preparation_failed', message: 'The preparation failed', retryable: false})]
      .map(item => ({...item, execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'new-boot'}}))})
  expect(response).toMatchObject({accepted: true})
  expect(response).not.toHaveProperty('nativeStartAdmission')
  expect((await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle?.phase).toBe('needs_attention')
})

test('a confirmed preparation failure queues one new delivery on the same execution without extending its hard deadline', async () => {
  const {convex, started, command, reject, begin, input, prefix} = await nativeRetryFixture()
  expect(await reject()).toBe(true)
  expect(await reject()).toBe(false)
  const projected = await projectedState(convex, started.messageId), state = projected.run?.remoteLifecycle
  expect(state).toMatchObject({phase: 'recovering', cause: 'native_restoration', currentAttemptId: command.attemptId,
    executionGeneration: 2, hardDeadlineAt: now + 3_600_000, claimDeadlineAt: now + 120010})
  expect(projected.message?.parts).toContainEqual(expect.objectContaining({type: 'data-remote-agent-status', data: expect.objectContaining({
    state: 'recovering', queueExpiresAt: now + 120010, hardDeadlineAt: now + 3_600_000,
  })}))
  const result = await convex.run(async ctx => {
    const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', command.attemptId ?? '')).unique()
    const commands = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', input.runId)).take(10)
    const message = projected.run && await ctx.db.get(projected.run.assistantMessageId)
    return {attempt, commands, text: message && (await hydrateRemoteMessage(ctx, message)).content}
  })
  const retried = result.commands.find(candidate => candidate.status === 'pending' && candidate.type === 'start')
  expect(result.text).toBe(prefix)
  expect(retried?.commandId).not.toBe(command.commandId)
  expect(retried?.payload).toEqual(command.payload)
  expect(retried?.attemptId).toBe(command.attemptId)
  expect(retried?.executionGeneration).toBe(2)
  expect(retried?.sequence).toBeGreaterThan(command.sequence)
  expect(result.attempt?.restorationCommandId).toBe(retried?.commandId)
  expect(result.attempt?.preparationRetryCount).toBe(1)
  expect(await begin(), 'stopped-machine replay authorizes the latest pending delivery, preserving the source proof').toBe(true)
})

test('preparation retry is bounded and never fabricates another execution or a fresh native conversation', async () => {
  const {convex, call, reject, command, started, input} = await nativeRetryFixture()
  let currentId = command.commandId
  for (let count = 0; count < 4; count++) {
    expect(await reject(currentId, 'native_preparation_retryable', now + 10 + count * 10)).toBe(true)
    const pending = await convex.run(async ctx => (await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', input.runId)).take(20))
      .filter(candidate => candidate.type === 'start' && candidate.status === 'pending'))
    expect(pending).toHaveLength(count < 3 ? 1 : 0)
    if (count < 3) {
      const retry = pending[0]
      if (!retry) throw Error('Missing bounded retry')
      currentId = retry.commandId
      await call('claimCommandsByServer', {workspaceId, environmentId, now: now + 11 + count * 10, leaseMs: 5000, limit: 10})
    }
  }
  const state = (await projectedState(convex, started.messageId)).run?.remoteLifecycle
  expect(state?.phase).toBe('needs_attention')
  expect(state?.currentAttemptId).toBe(command.attemptId)
  expect(state?.executionGeneration).toBe(2)
  expect(await convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', input.runId)).take(10))).toHaveLength(2)
})

test('a retry-delivery sequence gap is not a provider health verdict and leaves the same command claimable', async () => {
  const {convex, reject, started, command} = await nativeRetryFixture()
  const before = (await projectedState(convex, started.messageId)).run?.remoteLifecycle
  expect(await reject(command.commandId, 'command_sequence_gap')).toBe(true)
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle).toEqual(before)
  const pending = await convex.run(ctx => ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', command.commandId)).unique())
  expect(pending?.status).toBe('claimed')
  expect(await reject()).toBe(true)
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.phase).toBe('recovering')
})

test('preparation rejection cannot retry unknown native starts, permanent failures, revocation, cancellation, approvals or a replaced machine', async () => {
  for (const scenario of ['unknown', 'permanent', 'started', 'binding', 'funding', 'cancel', 'approval', 'machine', 'deadline', 'principal', 'workspace', 'agent']) {
    const f = await nativeRetryFixture()
    await f.convex.run(async ctx => {
      if (scenario === 'binding') {
        const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', 'binding-remote-turn')).unique()
        if (!binding) throw Error('Missing binding')
        await ctx.db.patch(binding._id, {enabled: false})
      }
      if (scenario === 'funding') {
        const reservation = await ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', 'reservation-remote-turn')).unique()
        if (!reservation) throw Error('Missing reservation')
        await ctx.db.patch(reservation._id, {status: 'released'})
      }
      if (scenario === 'machine') await ctx.db.patch(f.leaseDocId, {providerReference: 'replacement-machine'})
      if (scenario === 'principal') {
        const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', actorPrincipalId)).unique()
        if (!principal) throw Error('Missing principal')
        await ctx.db.patch(principal._id, {archivedAt: now + 7})
      }
      if (scenario === 'workspace') {
        const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
        if (!workspace) throw Error('Missing workspace')
        await ctx.db.patch(workspace._id, {archivedAt: now + 7})
      }
      if (scenario === 'agent') {
        const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
        if (!agent) throw Error('Missing agent')
        await ctx.db.patch(agent._id, {archivedAt: now + 7})
      }
      if (scenario === 'approval') await ctx.db.insert('agentApprovalRequests', {approvalId: 'pending-retry-approval', workspaceId,
        runId: f.input.runId, remoteSessionId: f.command.attemptId ?? '', requestKey: 'pending', prompt: 'Allow?', options: ['allow'], payload: {}, requestedAt: now})
    })
    if (scenario === 'cancel') await f.call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: f.seeded.conversationId,
      runId: f.input.runId, action: 'cancel', queueExpiresAt: now + 60000, now: now + 7})
    if (scenario === 'started') await admitNativeFixture(f)
    if (scenario === 'started') await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.command.attemptId,
      events: [{...event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: f.command.commandId}), eventId: 'already-started',
        execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'new-boot'}}], now: now + 7})
    await f.reject(f.command.commandId, scenario === 'unknown' ? 'command_outcome_unknown' : scenario === 'permanent' ? 'command_rejected' : 'native_preparation_retryable',
      scenario === 'deadline' ? now + 3_600_001 : now + 10)
    const pending = await f.convex.run(async ctx => (await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', f.input.runId)).take(20))
      .filter(command => command.type === 'start' && command.status === 'pending'))
    expect(pending).toHaveLength(0)
    expect((await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle?.currentAttemptId).toBe(f.command.attemptId)
  }
})

test('preparation does not bind a receiver boot or provider start time, and the native start fences later foreign boot output', async () => {
  const {convex, call, command, started, prefix} = await nativeRetryFixture()
  const send = (sequence: number, type: string, payload: Record<string, unknown>, boot: string) => call('applyRemoteEventsByServer', {
    workspaceId, environmentId, sessionId: command.attemptId, now: now + 6 + sequence,
    events: [{...event(sequence, type, payload), eventId: `new-attempt-${sequence}`,
      execution: {attemptId: command.attemptId, generation: 2, hostBootId: boot}}],
  })
  expect(await send(1, 'session_preparing', {}, 'preparation-boot')).toMatchObject({accepted: true})
  const attempt = await convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', command.attemptId ?? '')).unique())
  expect(attempt?.hostBootId).toBeUndefined()
  expect(attempt?.startedAt).toBeUndefined()
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.lastHealthAt).toBeUndefined()
  expect(await send(2, 'session_preparing', {}, 'resumed-preparation-boot')).not.toHaveProperty('stale')
  await admitNativeFixture({convex, call, started}, 'resumed-preparation-boot', now + 9)
  expect(await send(4, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: command.commandId}, 'resumed-preparation-boot')).not.toHaveProperty('stale')
  expect(await send(5, 'session_preparing', {}, 'preparation-boot')).not.toHaveProperty('stale')
  expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle).toMatchObject({phase: 'running', lastHealthAt: now + 10})
  expect(await send(6, 'text_delta', {offset: prefix.length, text: 'old writer'}, 'preparation-boot')).toMatchObject({stale: 'stale_execution'})
  const current = await convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', command.attemptId ?? '')).unique())
  expect(current?.hostBootId).toBe('resumed-preparation-boot')
  expect(current?.startedAt).toBe(now + 10)
})

test('a queued native continuation appends on the original assistant and fences buffered old execution output', async () => {
  const {convex, call, events, begin, prefix, input, started} = await nativeQueueFixture()
  expect(await begin()).toBe(true)
  const state = (await projectedState(convex, started.messageId)).run?.remoteLifecycle
  if (!state) throw Error('Missing recovery state')
  expect(state.recoveryOutcome).toBeUndefined()
  await call('claimCommandsByServer', {workspaceId, environmentId, now: now + 6, leaseMs: 5000, limit: 10})
  const {admitted} = await admitNativeFixture({convex, call, started})
  expect(await events([event(4, 'text_delta', {offset: prefix.length, text: 'STALE_WRITER'})], now + 8))
    .toMatchObject({accepted: true, stale: 'stale_attempt'})
  const tail = '\nContinued in the original native conversation.'
  const continuationEvents = [event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: admitted.commandId}),
    event(3, 'text_delta', {offset: prefix.length, text: tail}), event(4, 'completed', {usage: {}})]
    .map(e => ({...e, eventId: `restored-${e.eventId}`, execution: {attemptId: state.currentAttemptId,
      generation: state.executionGeneration, hostBootId: 'new-boot'}}))
  expect(await call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: state.currentAttemptId,
    events: continuationEvents, now: now + 7})).toMatchObject({accepted: true})
  await convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', input.runId)).unique()
    if (!run) throw Error('Missing run')
    expect(run.assistantMessageId).toBe(started.messageId)
    expect(run.status).toBe('completed')
    expect(run.remoteLifecycle?.recoveryOutcome).toBe('restored')
    expect(run.remoteLifecycle?.lastPreparationAt).toBeUndefined()
    const message = await ctx.db.get(run.assistantMessageId)
    if (!message) throw Error('Missing message')
    expect((await hydrateRemoteMessage(ctx, message)).content).toBe(prefix + tail)
  })
})

test('a new stopped-machine readback can redeliver claimed preparation without replacing its execution or source proof', async () => {
  const f = await nativeRetryFixture()
  const before = (await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle
  for (const observedStoppedAt of [now + 4, now + 11, NaN]) {
    expect(await f.begin({observedStoppedAt, now: now + 10})).toBe(false)
  }
  expect(await f.begin({observedStoppedAt: now + 9, now: now + 10})).toBe(true)
  expect(await f.begin({observedStoppedAt: now + 9, now: now + 10})).toBe(true)
  const after = await projectedState(f.convex, f.started.messageId)
  expect(after.run?.remoteLifecycle).toMatchObject({currentAttemptId: before?.currentAttemptId,
    executionGeneration: before?.executionGeneration, providerStop: before?.providerStop, hardDeadlineAt: before?.hardDeadlineAt})
  const result = await f.convex.run(async ctx => ({
    session: await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.command.attemptId ?? '')).unique(),
    commands: await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', f.input.runId)).take(20),
  }))
  expect(result.commands.find(command => command.commandId === f.command.commandId)?.status).toBe('cancelled')
  expect(result.commands.filter(command => command.type === 'start' && command.status === 'pending')).toHaveLength(1)
  expect(result.session).toMatchObject({preparationRetryCount: 1, lastPreparationStopAt: now + 9})
  await f.call('claimCommandsByServer', {workspaceId, environmentId, now: now + 11, leaseMs: 5000, limit: 10})
  expect(await f.begin({observedStoppedAt: now + 9, now: now + 12})).toBe(false)
})

async function isolatedNativeFixture() {
  const f = await nativeRetryFixture()
  await admitNativeFixture(f, 'pre-stop-boot')
  expect(await f.begin({observedStoppedAt: now + 9, now: now + 10})).toBe(false)
  const before = (await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle
  if (!before) throw Error('Missing admitted lifecycle')
  expect(await f.lifecycle('recordProviderStop', {runId: f.input.runId, environmentId, leaseId: f.input.leaseId,
    providerReference: f.input.providerReference, attemptId: before.currentAttemptId, generation: 2,
    expectedRevision: before.revision, now: now + 9})).toBe(true)
  expect(await f.begin({attemptId: before.currentAttemptId, generation: 2, expectedRevision: before.revision + 1, now: now + 10})).toBe(true)
  return {...f, sourceAttemptId: before.currentAttemptId}
}

test('buffered native startup and output survive isolation when startup acknowledgement had not reached the server', async () => {
  const f = await isolatedNativeFixture()
  const tail = '\nDurable output produced before the second machine stop.'
  await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.command.attemptId, now: now + 11,
    events: [event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: f.command.commandId}),
      event(3, 'text_delta', {offset: f.prefix.length, text: tail})].map(item => ({...item, occurredAt: now + 8,
        eventId: `buffered-${item.eventId}`, execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'pre-stop-boot'}}))})
  const content = await f.convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', f.input.runId)).unique()
    const message = run && await ctx.db.get(run.assistantMessageId)
    if (!message) throw Error('Missing original assistant')
    return (await hydrateRemoteMessage(ctx, message)).content
  })
  expect(content).toBe(f.prefix + tail)
  const retained = await projectedState(f.convex, f.started.messageId)
  expect(retained.run?.remoteLifecycle).toMatchObject({phase: 'recovering', executionGeneration: 3})
  expect(retained.run?.remoteLifecycle?.lastHealthAt).toBeUndefined()
  expect(retained.run?.remoteLifecycle?.recoveryOutcome).toBeUndefined()
  await f.call('claimCommandsByServer', {workspaceId, environmentId, now: now + 12, leaseMs: 5000, limit: 10})
  const {admitted} = await admitNativeFixture(f, 'second-native-boot', now + 13)
  expect(admitted.canonicalTextOffset).toBe(f.prefix.length + tail.length)
  expect(admitted.sourceEventCursor).toBe(3)
  const source = await f.convex.run(ctx => ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.sourceAttemptId)).unique())
  expect(source).toMatchObject({status: 'failed', recoveryCause: 'provider_isolated', hostBootId: 'pre-stop-boot'})
  const nextTail = '\nContinued after the fully drained source.'
  expect(await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: admitted.attemptId, now: now + 14,
    events: [event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: admitted.commandId}),
      event(3, 'text_delta', {offset: admitted.canonicalTextOffset, text: nextTail}), event(4, 'completed', {usage: {}})]
      .map(item => ({...item, eventId: `next-${item.eventId}`, execution: {attemptId: admitted.attemptId, generation: 3, hostBootId: admitted.hostBootId}}))})).toMatchObject({accepted: true})
  const final = await projectedState(f.convex, f.started.messageId)
  expect(final.run?.remoteLifecycle).toMatchObject({phase: 'completed', recoveryOutcome: 'restored', lastHealthAt: now + 14})
  const text = await f.convex.run(async ctx => {
    const message = final.run && await ctx.db.get(final.run.assistantMessageId)
    if (!message) throw Error('Missing final assistant')
    return (await hydrateRemoteMessage(ctx, message)).content
  })
  expect(text).toBe(f.prefix + tail + nextTail)
})

test('isolated-source completion, failure and approval history never recreates live health or executable requests', async () => {
  for (const outcome of ['completed', 'failed', 'cancelled', 'approval_requested']) {
    const f = await isolatedNativeFixture(), tail = `\nRetained ${outcome} history.`
    const payload = outcome === 'approval_requested' ? {requestKey: 'old-risky-action', prompt: 'Allow the old action?', options: [{id: 'allow_once', label: 'Allow once'}]}
      : outcome === 'failed' ? {code: 'provider_failed', message: 'Old provider failed', retryable: false} : {}
    const events = [event(2, 'session_started', {remoteSessionId: 'native-session', adapterId: 'acp', restorationCommandId: f.command.commandId}),
      event(3, 'text_delta', {offset: f.prefix.length, text: tail}), event(4, outcome, payload)]
      .map(item => ({...item, eventId: `old-${item.eventId}`, execution: {attemptId: f.sourceAttemptId, generation: 2, hostBootId: 'pre-stop-boot'}}))
    const request = {workspaceId, environmentId, sessionId: f.sourceAttemptId, events, now: now + 11}
    expect(await f.call('applyRemoteEventsByServer', request)).toMatchObject({accepted: true})
    expect(await f.call('applyRemoteEventsByServer', request)).toMatchObject({accepted: true, duplicate: true})
    const result = await projectedState(f.convex, f.started.messageId)
    expect(result.run?.remoteLifecycle?.lastHealthAt).toBeUndefined()
    expect(result.run?.remoteLifecycle?.recoveryOutcome).toBeUndefined()
    const rows = await f.convex.run(async ctx => {
      const message = result.run && await ctx.db.get(result.run.assistantMessageId)
      if (!message) throw Error('Missing retained assistant')
      return {text: (await hydrateRemoteMessage(ctx, message)).content,
        current: await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', result.run?.remoteLifecycle?.currentAttemptId ?? '')).unique(),
        approvals: await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', f.sourceAttemptId)).take(10)}
    })
    expect(rows.text).toContain(f.prefix + tail)
    expect(rows.current?.hostBootId).toBeUndefined()
    expect(rows.current?.startedAt).toBeUndefined()
    expect(rows.current?.nativeStartAdmission).toBeUndefined()
    if (outcome === 'completed') expect(result.run?.remoteLifecycle?.phase).toBe('completed')
    else expect(result.run?.remoteLifecycle?.phase).toBe('needs_attention')
    if (outcome === 'approval_requested') {
      expect(result.run?.remoteLifecycle?.cause).toBe('approval_context_lost')
      expect(rows.approvals).toHaveLength(1)
      expect(rows.approvals[0].resolution?.decision).toBe('approval_context_lost')
      expect(result.message?.parts?.filter(part => part.type === 'data-remote-agent-request')).toMatchObject([{data: {state: 'resolved'}}])
    }
  }
})

test('cancel wins over isolated-source outcomes while already-produced text still drains after confirmed stop', async () => {
  const f = await isolatedNativeFixture()
  await f.call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: f.seeded.conversationId,
    runId: f.input.runId, action: 'cancel', queueExpiresAt: now + 60000, now: now + 11})
  const send = (sequence: number, text: string, offset: number) => f.call('applyRemoteEventsByServer', {workspaceId, environmentId,
    sessionId: f.sourceAttemptId, now: now + 12 + sequence,
    events: [{...event(sequence, 'text_delta', {offset, text}), execution: {attemptId: f.sourceAttemptId, generation: 2, hostBootId: 'pre-stop-boot'}}]})
  expect(await send(2, '\nBefore stop.', f.prefix.length)).toMatchObject({accepted: true})
  const cancelling = (await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle
  if (!cancelling) throw Error('Missing cancellation')
  expect(cancelling.phase).toBe('cancelling')
  await f.lifecycle('confirmStopped', {runId: f.input.runId, attemptId: cancelling.currentAttemptId, generation: 3, now: now + 15})
  expect(await send(3, '\nBuffered tail.', f.prefix.length + '\nBefore stop.'.length)).toMatchObject({accepted: true})
  const result = await projectedState(f.convex, f.started.messageId)
  expect(result.run?.remoteLifecycle?.phase).toBe('cancelled')
  expect(result.run?.remoteLifecycle?.lastHealthAt).toBeUndefined()
  const text = await f.convex.run(async ctx => {
    const message = result.run && await ctx.db.get(result.run.assistantMessageId)
    if (!message) throw Error('Missing cancelled assistant')
    return (await hydrateRemoteMessage(ctx, message)).content
  })
  expect(text).toBe(f.prefix + '\nBefore stop.\nBuffered tail.')
})

test('historical ingestion rejects another source, receipt, boot or legacy admission contract', async () => {
  for (const scenario of ['receipt', 'source', 'source_running', 'legacy', 'boot']) {
    const f = await isolatedNativeFixture()
    await f.convex.run(async ctx => {
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', f.input.runId)).unique()
      if (!run?.remoteLifecycle?.providerStop) throw Error('Missing receipt')
      const state = run.remoteLifecycle, id = state.currentAttemptId
      const current = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', id)).unique()
      const source = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.sourceAttemptId)).unique()
      if (!current || !source) throw Error('Missing isolated source')
      if (scenario === 'receipt') await ctx.db.patch(run._id, {remoteLifecycle: {...state, providerStop: {...run.remoteLifecycle.providerStop, providerReference: 'foreign-machine'}}})
      if (scenario === 'source') await ctx.db.patch(source._id, {bindingId: 'foreign-binding'})
      if (scenario === 'source_running') await ctx.db.patch(source._id, {status: 'running'})
      if (scenario === 'legacy') await ctx.db.patch(current._id, {nativeStartAdmissionRequired: undefined})
    })
    const response = await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.sourceAttemptId, now: now + 11,
      events: [{...event(2, 'text_delta', {offset: f.prefix.length, text: 'MUST_NOT_APPEND'}), execution: {
        attemptId: f.sourceAttemptId, generation: 2, hostBootId: scenario === 'boot' ? 'foreign-boot' : 'pre-stop-boot'}}]})
    expect(response).toHaveProperty('stale')
    const run = (await projectedState(f.convex, f.started.messageId)).run
    const text = await f.convex.run(async ctx => {
      const message = run && await ctx.db.get(run.assistantMessageId)
      if (!message) throw Error('Missing assistant')
      return (await hydrateRemoteMessage(ctx, message)).content
    })
    expect(text).toBe(f.prefix)
  }
})

test('preparation timeout requires a fresh isolation receipt before another delivery can resume the same execution', async () => {
  for (const cause of ['preparation_health_required', 'command_unclaimed']) {
    const f = await nativeRetryFixture()
    await f.convex.run(async ctx => {
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', f.input.runId)).unique()
      if (!run?.remoteLifecycle) throw Error('Missing lifecycle')
      await ctx.db.patch(run._id, {remoteLifecycle: {...run.remoteLifecycle, phase: 'needs_attention', cause}})
      if (cause === 'command_unclaimed') await ctx.db.patch(f.command._id, {status: 'pending'})
    })
    expect(await f.begin({now: now + 130000})).toBe(false)
    expect(await f.begin({observedStoppedAt: now + 129999, now: now + 130000})).toBe(true)
    const current = (await projectedState(f.convex, f.started.messageId)).run?.remoteLifecycle
    expect(current).toMatchObject({phase: 'recovering', cause: 'native_restoration', currentAttemptId: f.command.attemptId,
      executionGeneration: 2, claimDeadlineAt: now + 250000, hardDeadlineAt: now + 3600000})
    expect(current?.lastHealthAt).toBeUndefined()
  }
})

test('native restoration start rejects a replacement conversation, adapter, delivery, source receipt or machine', async () => {
  for (const scenario of ['conversation', 'missing_identity', 'adapter', 'pending_delivery', 'superseded_delivery', 'missing_receipt', 'machine', 'approval']) {
    const f = await nativeRetryFixture()
    await admitNativeFixture(f)
    await f.convex.run(async ctx => {
      if (scenario === 'pending_delivery') await ctx.db.patch(f.command._id, {status: 'pending'})
      if (scenario === 'machine') await ctx.db.patch(f.leaseDocId, {providerReference: 'another-machine'})
      if (scenario === 'approval') await ctx.db.insert('agentApprovalRequests', {approvalId: 'unrestored-approval', workspaceId,
        runId: f.input.runId, remoteSessionId: f.command.attemptId ?? '', requestKey: 'pending', prompt: 'Allow?', options: ['allow'], payload: {}, requestedAt: now})
      if (scenario === 'superseded_delivery') {
        const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', f.command.attemptId ?? '')).unique()
        if (!session) throw Error('Missing current attempt')
        await ctx.db.patch(session._id, {restorationCommandId: 'another-delivery'})
      }
      if (scenario === 'missing_receipt') {
        const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', f.input.runId)).unique()
        if (!run?.remoteLifecycle) throw Error('Missing current lifecycle')
        const lifecycle = {...run.remoteLifecycle}
        delete lifecycle.providerStop
        await ctx.db.patch(run._id, {remoteLifecycle: lifecycle})
      }
    })
    const result = await f.call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: f.command.attemptId, now: now + 7,
      events: [{...event(2, 'session_started', {restorationCommandId: f.command.commandId, remoteSessionId: scenario === 'conversation' ? 'replacement-native' : scenario === 'missing_identity' ? '' : 'native-session',
        adapterId: scenario === 'adapter' ? 'another-adapter' : 'acp'}), eventId: `invalid-start-${scenario}`,
        execution: {attemptId: f.command.attemptId, generation: 2, hostBootId: 'new-boot'}}]})
    expect(result).toMatchObject({accepted: true, stale: 'stale_execution'})
    const projected = await projectedState(f.convex, f.started.messageId)
    expect(projected.run?.remoteLifecycle?.phase).toBe('recovering')
    expect(projected.run?.remoteLifecycle?.recoveryOutcome).toBeUndefined()
    expect(projected.message?.parts?.some(part => part.type === 'data-remote-agent-status' && 'data' in part && part.data.recoveryOutcome === 'restored')).toBe(false)
  }
})

test('native continuation never replaces a cancelled run or a lost approval context', async () => {
  const cancelled = await nativeQueueFixture()
  await cancelled.call('controlRemoteAgentTurnByServer', {actorUserId, workspaceId, conversationId: cancelled.seeded.conversationId,
    runId: cancelled.input.runId, action: 'cancel', queueExpiresAt: now + 60_000, now: now + 6})
  expect(await cancelled.begin()).toBe(false)
  const approval = await nativeQueueFixture()
  await approval.convex.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', approval.input.runId)).unique()
    if (!run?.remoteLifecycle) throw Error('Missing lifecycle')
    await ctx.db.patch(run._id, {remoteLifecycle: {...run.remoteLifecycle, cause: 'approval_context_lost'}})
  })
  expect(await approval.begin()).toBe(false)
})

test('native continuation refuses unavailable capabilities, missing native identity and oversized commands', async () => {
  for (const scenario of ['unsupported', 'missing-identity', 'oversized']) {
    const {convex, begin, input, started} = await nativeQueueFixture()
    await convex.run(async ctx => {
      const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', input.attemptId)).unique()
      const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', 'command-remote-turn')).unique()
      if (!attempt || !command) throw Error('Missing native fixture')
      if (scenario === 'unsupported') await ctx.db.patch(attempt._id, {capabilitySnapshot: {...attempt.capabilitySnapshot,
        adapters: [{id: 'acp', protocol: 'acp', recovery: {sessionLoading: true}}]}})
      if (scenario === 'missing-identity') await ctx.db.patch(attempt._id, {remoteSessionId: undefined})
      if (scenario === 'oversized') await ctx.db.patch(command._id, {payload: {...command.payload,
        metadata: {...command.payload.metadata, oversized: 'x'.repeat(128 * 1024)}}})
    })
    expect(await begin()).toBe(false)
    expect((await projectedState(convex, started.messageId)).run?.remoteLifecycle?.currentAttemptId).toBe(input.attemptId)
  }
})

test('native continuation checks current membership, binding, funding and unresolved database approvals', async () => {
  for (const scenario of ['membership', 'binding', 'funding', 'approval']) {
    const {convex, begin, input} = await nativeQueueFixture()
    await convex.run(async ctx => {
      if (scenario === 'membership') {
        const member = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', actorPrincipalId)).unique()
        if (!member) throw Error('Missing membership')
        await ctx.db.delete(member._id)
      }
      if (scenario === 'binding') {
        const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', 'binding-remote-turn')).unique()
        if (!binding) throw Error('Missing binding')
        await ctx.db.patch(binding._id, {enabled: false})
      }
      if (scenario === 'funding') {
        const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', input.attemptId)).unique()
        if (!attempt) throw Error('Missing attempt')
        await ctx.db.patch(attempt._id, {capabilitySnapshot: {...attempt.capabilitySnapshot, billing: {reservationId: 'missing-reservation'}}})
      }
      if (scenario === 'approval') await ctx.db.insert('agentApprovalRequests', {approvalId: 'unresolved', workspaceId,
        runId: input.runId, remoteSessionId: input.attemptId, requestKey: 'pending-decision', prompt: 'Allow?',
        options: ['allow', 'deny'], payload: {}, requestedAt: now})
    })
    expect(await begin()).toBe(false)
  }
})

test('native continuation rejects claimed replay and receipts from another environment or the future', async () => {
  const queued = await nativeQueueFixture()
  expect(await queued.begin()).toBe(true)
  await queued.convex.run(async ctx => {
    const commands = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', queued.input.runId)).take(10)
    const command = commands.find(candidate => candidate.type === 'start')
    if (!command) throw Error('Missing continuation')
    await ctx.db.patch(command._id, {status: 'claimed'})
  })
  expect(await queued.begin()).toBe(false)
  for (const receipt of [{environmentId: 'foreign'}, {observedAt: now + 100}]) {
    const {convex, begin, input} = await nativeQueueFixture()
    await convex.run(async ctx => {
      const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', input.runId)).unique()
      if (!run?.remoteLifecycle?.providerStop) throw Error('Missing stop receipt')
      await ctx.db.patch(run._id, {remoteLifecycle: {...run.remoteLifecycle,
        providerStop: {...run.remoteLifecycle.providerStop, ...receipt}}})
    })
    expect(await begin()).toBe(false)
  }
})

test('fresh-drive preparation survives the two-minute claim window without granting authority to stale startup', async () => {
  const {convex, lifecycle, call, started, events} = await durableFixture()
  const previous = process.env.OVERLAY_CONNECTED_AGENT_DRIVE
  process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '1'
  try {
    await convex.run(async ctx => {
      const existing = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
      if (!existing) await ctx.db.insert('workspaceAgentDefinitions', {agentId, workspaceId, principalId: agentPrincipalId,
        name: 'Drive agent', instructions: '', harness: 'codex', modelId: 'byo/codex', allowedToolIds: [], visibility: 'creator',
        createdByPrincipalId: actorPrincipalId, invocationPolicy: 'mention', createdAt: now, updatedAt: now})
    })
    const owner = {runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1}
    await lifecycle('claim', {...owner, now})
    await lifecycle('advance', {...owner, now})
    const authority = () => convex.query(makeFunctionReference<'query'>('agents/agentDrive:credentialAuthorityByServer'), {
      serverSecret: secret, workspaceId, environmentId, runId: 'run-remote-turn', sessionId: 'session-remote-turn',
      execution: {attemptId: 'session-remote-turn', generation: 1},
    })
    await authority()
    const initial = await convex.run(async ctx => (await ctx.db.query('conversationMessages').collect()).find(row => row._id === started.messageId))
    expect(initial?.parts).toContainEqual(expect.objectContaining({type: 'data-remote-agent-status', data: expect.objectContaining({state: 'starting'})}))
    for (let sequence = 1; sequence <= 6; sequence++) {
      const receipt = now + sequence * 50_000
      await events([event(sequence, 'session_preparing', {})], receipt)
      const state = await lifecycle('advance', {...owner, now: receipt})
      expect(state).toMatchObject({phase: 'starting', lastPreparationAt: receipt, hardDeadlineAt: now + 3_600_000})
      expect(state.lastHealthAt).toBeUndefined()
      await authority()
    }
    const commands = await call<Array<{type: string}>>('claimCommandsByServer', {workspaceId, environmentId, now: now + 300_001, leaseMs: 5000, limit: 10})
    expect(commands[0]?.type).toBe('start')
    await call('applyRemoteEventsByServer', {workspaceId, environmentId, sessionId: 'session-remote-turn', now: now + 350_000,
      events: [{...event(7, 'session_preparing', {}), execution: {attemptId: 'session-remote-turn', generation: 0, hostBootId: 'old-boot'}}]})
    expect(await lifecycle('advance', {...owner, now: now + 350_000})).toMatchObject({phase: 'starting', lastPreparationAt: now + 300_000})
    const stale = await lifecycle('advance', {...owner, now: now + 390_000})
    expect(stale).toMatchObject({phase: 'needs_attention', cause: 'preparation_health_required'})
    await expect(authority()).rejects.toMatchObject({data: 'DRIVE_RUN_UNAVAILABLE'})
    await events([event(7, 'session_preparing', {})], now + 390_001)
    await expect(authority()).rejects.toMatchObject({data: 'DRIVE_RUN_UNAVAILABLE'})
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_CONNECTED_AGENT_DRIVE
    else process.env.OVERLAY_CONNECTED_AGENT_DRIVE = previous
  }
})

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
  expect((await projectedState(convex, started.messageId)).message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({
    type: 'data-remote-agent-status', data: expect.objectContaining({hardDeadlineAt: now + 3_600_000}),
  })]))
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  await events([event(1, 'session_started', { remoteSessionId: 'native', adapterId: 'fake' }), event(2, 'approval_requested', {
    requestKey: 'clone', prompt: 'Allow clone?', options: [{ id: 'allow', label: 'Allow' }], context: {},
  })], now + 1)
  const beforeHealth = await projectedState(convex, started.messageId)
  expect(beforeHealth.message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({
    type: 'data-remote-agent-status', data: expect.objectContaining({hardDeadlineAt: now + 3_600_000}),
  })]))
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
  expect(result.message?.parts).toEqual(expect.arrayContaining([expect.objectContaining({
    type: 'data-remote-agent-status', data: expect.objectContaining({hardDeadlineAt: now + 3_600_000}),
  })]))
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

test('fresh lifecycle attempt appends to the full canonical text after a lost process', async () => {
  const { convex, call, lifecycle, seeded, events } = await durableFixture()
  const owner = { runId: 'run-remote-turn', coordinatorId: 'owner', generation: 1, now }
  await lifecycle('claim', owner); await lifecycle('advance', owner)
  const prefix = 'Committed before restart 🙂\n'.repeat(4000)
  await events([event(1, 'session_started', { remoteSessionId: 'old', adapterId: 'acp' }),
    event(2, 'text_delta', { offset: 0, text: prefix }),
    event(3, 'process_observation', { process: 'unknown' })], now + 2)
  const fresh = await call<{ applied: boolean; commandId: string }>('controlRemoteAgentTurnByServer', {
    actorUserId, workspaceId, conversationId: seeded.conversationId, runId: 'run-remote-turn',
    action: 'start_fresh', queueExpiresAt: now + 60_000, now: now + 3,
  })
  expect(fresh.applied).toBe(true)
  const commands = await call<Array<{ id: string; payload: { metadata: Record<string, unknown> } }>>('claimCommandsByServer', {
    workspaceId, environmentId, now: now + 4, leaseMs: 5000, limit: 10,
  })
  const command = commands.find(command => command.id === fresh.commandId)!
  expect(command.payload.metadata.recoveryTextOffset).toBe(prefix.length)
  const run = await convex.run(ctx => ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', 'run-remote-turn')).unique())
  const replacement = run!.remoteLifecycle!.currentAttemptId
  expect(await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: replacement, now: now + 5,
    events: [event(1, 'session_started', { remoteSessionId: 'new', adapterId: 'acp' }),
      event(2, 'text_delta', { offset: command.payload.metadata.recoveryTextOffset, text: '\nRecovered output ✓' })]
      .map(e => ({ ...e, execution: { attemptId: replacement, generation: 2, hostBootId: 'new-boot' } })),
  })).toMatchObject({ accepted: true, acknowledgedSequence: 2 })
  const message = await convex.run(async ctx => hydrateRemoteMessage(ctx, (await ctx.db.get(run!.assistantMessageId))!))
  expect(message.content).toBe(prefix + '\nRecovered output ✓')
  expect(message._id).toBe(run!.assistantMessageId)
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
