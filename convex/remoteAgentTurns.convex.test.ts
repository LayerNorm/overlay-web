import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

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

    expect(await call('claimCommandsByServer', {
      workspaceId, environmentId, now: now + 60_001, leaseMs: 5_000, limit: 10,
    })).toEqual([])
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
    expect(await call('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(1, 'cancelled', { reason: 'Cancelled from Overlay' })], now: now + 60_005 }))
      .toEqual(expect.objectContaining({ accepted: true, acknowledgedSequence: 1, duplicate: false }))
  })

  test('contiguous events project once and duplicate terminal delivery is harmless', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await seedRoom(convex)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(mutationRef(operation), { ...args, serverSecret: secret }) as Promise<T>
    await call('upsertBindingByServer', bindingInput())
    const started = await call<{ messageId: string }>('startRemoteAgentTurnByServer', startInput(seeded))
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
    expect(beforeDuplicate.command?.status).toBe('acknowledged')

    const duplicate = await call<{ accepted: boolean; duplicate: boolean }>('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn', events, now: now + 101,
    })
    expect(duplicate).toEqual(expect.objectContaining({ accepted: true, duplicate: true }))
    const afterDuplicate = await projectedState(convex, started.messageId)
    expect(afterDuplicate.eventCount).toBe(beforeDuplicate.eventCount)
    await expect(call('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-remote-turn',
      events: [event(4, 'text_checkpoint', { text: 'must not apply' })], now: now + 102,
    })).rejects.toThrow(/AGENT_RUN_TERMINAL/)
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
    await call('createArtifactByServer', { id: 'artifact-remote-turn', workspaceId, environmentId,
      runId: 'run-remote-turn', remoteSessionId: 'session-remote-turn', name: 'report.txt', mediaType: 'text/plain',
      size: 6, sha256: 'a'.repeat(64), objectKey: 'scoped/report', status: 'clean', scanResult: 'clean',
      expiresAt: now + 60_000, createdAt: now, updatedAt: now })
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
    }) as { expiredRunIds: string[] }
    expect(swept.expiredRunIds).toEqual(['run-remote-turn'])
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
    expect(fresh.applied).toBe(true)
    const freshCommand = await convex.run(async ctx => ctx.db.query('agentRunCommands')
      .withIndex('by_commandId', q => q.eq('commandId', fresh.commandId)).unique())
    expect(freshCommand).toEqual(expect.objectContaining({ type: 'start', payload: expect.objectContaining({ fresh: true }) }))
    expect((await call<{ expiredRunIds: string[] }>('sweepRemoteRunsByServer', {
      now: now + 6, hostOfflineBefore: 0, limit: 10,
    })).expiredRunIds).toEqual([])
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
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: actorUserId, authorKind: 'human', authorPrincipalId: actorPrincipalId, turnId: 'turn-remote-turn', role: 'user', mode: 'act', content: '@Agent work', contentType: 'text', status: 'completed', createdAt: now, updatedAt: now })
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
    modelId: 'openrouter/free', prompt: 'work', queueExpiresAt: now + 60_000, reservationId: null,
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
