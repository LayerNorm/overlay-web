import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { gzipSync } from 'node:zlib'
import { assignmentCompletionIssues } from './collaboration/assignmentObligations'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-assignment-test-secret'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
const query = (path: string) => makeFunctionReference<'query'>(path)
const createAssignment = mutation('collaboration/agentAssignments:createAgentAssignment')
const forConversation = query('collaboration/agentAssignments:forConversation')
const inheritedRestrictions = mutation('harness/runs:refreshRoomContextRestrictions')
const preAdmissionRestrictions = mutation('harness/runs:resolveConversationRoomRestrictions')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture(v2 = false) {
  const convex = convexTest(schema, modules)
  const seeded = await convex.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspaces', {
      workspaceId: 'workspace', kind: 'organization', name: 'QA', slug: 'qa',
      status: 'active', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: ['conversations.read'],
      isSystem: false, createdAt: now, updatedAt: now,
    })
    for (const userId of ['alice', 'bob', 'charlie']) {
      await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId, createdAt: now })
      await ctx.db.insert('workspacePrincipals', {
        principalId: userId, workspaceId: 'workspace', type: 'human', userId,
        displayName: userId, createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: userId, workspaceId: 'workspace', principalId: userId,
        role: 'member', status: 'active', joinedAt: now, updatedAt: now,
      })
    }
    for (const [agentId, principalId, name, extras] of [
      ['caller', 'caller-principal', 'Caller', {}],
      ['target', 'target-principal', 'Target', {}],
      ['personal', 'personal-principal', 'Personal', {
        agentRole: 'personal_chief', chiefOwnerUserId: 'bob', visibility: 'creator',
      }],
    ] as Array<[string, string, string, Record<string, unknown>]>) {
      await ctx.db.insert('workspacePrincipals', {
        principalId, workspaceId: 'workspace', type: 'agent', agentId, displayName: name,
        createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `membership-${agentId}`, workspaceId: 'workspace', principalId,
        role: 'member', status: 'active', joinedAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId: 'workspace', principalId, name, instructions: '',
        harness: 'overlay', modelId: 'openrouter/free', allowedToolIds: [],
        invocationPolicy: 'mention', createdByPrincipalId: agentId === 'personal' ? 'bob' : 'alice',
        createdAt: now, updatedAt: now, ...extras,
      })
    }
    const parentConversationId = await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId: 'workspace', conversationType: 'dm', title: 'Parent',
      createdByPrincipalId: 'alice', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free',
    })
    for (const [principalId, principalType] of [
      ['alice', 'human'], ['bob', 'human'], ['caller-principal', 'agent'],
    ] as const) {
      await ctx.db.insert('conversationParticipants', {
        conversationId: parentConversationId, workspaceId: 'workspace', principalId, principalType,
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
      })
    }
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: parentConversationId, userId: 'alice', turnId: 'parent-turn',
      role: 'user', mode: 'act', content: 'Delegate this task', contentType: 'text', createdAt: now,
    })
    return { parentConversationId, userMessageId }
  })
  const turn = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'alice', agentId: 'caller', authorPrincipalId: 'caller-principal',
    clientNonce: 'caller-turn', conversationId: seeded.parentConversationId,
    initiatorPrincipalId: 'alice', modelId: 'openrouter/free', executionEngine: 'overlay_harness',
    turnId: `agent_${seeded.userMessageId}_caller`, userMessageId: seeded.userMessageId, workspaceId: 'workspace',
    serverSecret: secret,
  })
  const parentRunId = `workspace:${turn.runId}`
  await convex.mutation(mutation('harness/runs:admit'), {
    runId: parentRunId, deliveryAgentRunId: turn.runId, source: { conversationId: seeded.parentConversationId },
    goal: 'Delegate this task', constraints: [],
    policy: {
      actorUserId: 'alice', workspaceId: 'workspace', allowedToolIds: [], requiresPlan: false,
      ...(v2 ? { executionPolicyVersion: 2, spendingMode: 'none' } : {}),
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2,
    },
    serverSecret: secret,
  })
  expect(await convex.mutation(inheritedRestrictions, {
    actorUserId: 'alice', runId: parentRunId, serverSecret: secret,
  })).toEqual({ inheritedSharedRoom: true })
  return { convex, ...seeded, parentRunId }
}

function args(data: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  const toolCallId = String(overrides.toolCallId ?? 'call-1')
  return {
    serverSecret: secret,
    workspaceId: 'workspace',
    requesterUserId: 'alice',
    assignmentId: `assignment-${toolCallId}`,
    idempotencyKey: `harness-run:${data.parentRunId}:tool:${toolCallId}`,
    toolCallId,
    parentConversationId: data.parentConversationId,
    parentRunId: data.parentRunId,
    rootRunId: data.parentRunId,
    callerAgentId: 'caller',
    assignedAgentId: 'target',
    brief: 'Review this feature',
    questionTurnId: `ask-${toolCallId}`,
    ...overrides,
  }
}

async function dispatched(data: Awaited<ReturnType<typeof fixture>>, input = args(data)) {
  const assignment = await data.convex.mutation(createAssignment, input)
  const messageId = await data.convex.mutation(mutation('collaboration/directMessages:addAgentMessage'), {
    serverSecret: secret, actorUserId: 'alice', workspaceId: 'workspace', conversationId: assignment.conversationId,
    authorPrincipalId: 'caller-principal', clientNonce: input.questionTurnId, content: input.brief,
    turnId: input.questionTurnId, modelId: 'openrouter/free', messagePurpose: 'agent_request',
  })
  const turnId = `agent_${messageId}_target`
  const turn = await data.convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    serverSecret: secret, actorUserId: 'alice', workspaceId: 'workspace', conversationId: assignment.conversationId,
    agentId: 'target', authorPrincipalId: 'target-principal', initiatorPrincipalId: 'caller-principal',
    clientNonce: turnId, turnId, userMessageId: messageId, modelId: 'openrouter/free', executionEngine: 'overlay_harness',
  })
  const childRunId = `workspace:${turn.runId}`
  const parentState = await data.convex.run(async ctx => {
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', data.parentRunId)).unique()
    return JSON.parse(run!.metadataJson)
  })
  await data.convex.mutation(mutation('harness/runs:apply'), {
    actorUserId: 'alice', runId: data.parentRunId, serverSecret: secret, expectedRevision: parentState.revision,
    ...(parentState.policy.executionPolicyVersion === 2 ? { workflowRunId: parentState.workflowRunId, executionGeneration: parentState.executionGeneration ?? 0 } : {}),
    operationId: `dispatch:${input.toolCallId}`, operation: {
      type: 'admit_named_child', child: { id: childRunId, stepId: `ask:${input.toolCallId}`, allowedToolIds: [],
        maxCostMicros: 0, costMicros: 0, status: 'running', evidenceRefs: [] },
      step: { title: 'Review', acceptanceCriteria: ['Reply to the request'] }, goal: input.brief, constraints: [],
      target: { deliveryAgentRunId: turn.runId, conversationId: assignment.conversationId },
    },
  })
  return { ...assignment, childRunId, turnId, turn, messageId }
}

async function childState(data: Awaited<ReturnType<typeof fixture>>, child: Awaited<ReturnType<typeof dispatched>>, status: string, finalized: boolean, content = 'Full reply. '.repeat(2500)) {
  await data.convex.run(async ctx => {
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', child.childRunId)).unique()
    const state = JSON.parse(run!.metadataJson)
    await ctx.db.patch(run!._id, { metadataJson: JSON.stringify({ ...state, revision: state.revision + 1,
      status, resultSummary: 'A short summary', ...(status === 'failed' ? { terminalReason: 'Tool failed' } : {}) }) })
    if (finalized) {
      await ctx.db.patch(child.turn.messageId, { status: status === 'completed' ? 'completed' : 'error', content })
      await ctx.db.patch(child.turn.runId, { status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed' })
    }
  })
  await data.convex.mutation(mutation('collaboration/assignmentResults:settle'), { serverSecret: secret, childRunId: child.childRunId })
}

const readResult = query('collaboration/assignmentResults:read')
const readArtifact = query('collaboration/assignmentResults:settledArtifact')
const resultActor = { serverSecret: secret, actorUserId: 'alice', workspaceId: 'workspace' }

async function applyOperation(data: Awaited<ReturnType<typeof fixture>>, runId: string, operationId: string, operation: Record<string, unknown>) {
  const state = await data.convex.run(async ctx => {
    const row = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', runId)).unique()
    return JSON.parse(row!.metadataJson)
  })
  return await data.convex.mutation(mutation('harness/runs:apply'), { serverSecret: secret, actorUserId: 'alice', runId,
    expectedRevision: state.revision, operationId, operation,
    ...(state.workflowRunId || state.policy.executionPolicyVersion === 2 ? { workflowRunId: state.workflowRunId ?? operation.workflowRunId, executionGeneration: state.executionGeneration ?? 0 } : {}) })
}

async function resolution(data: Awaited<ReturnType<typeof fixture>>, child: { assignmentId: string; attemptId: string }, action: 'accept' | 'exclude' | 'cancel', reason?: string) {
  return await data.convex.mutation(mutation('collaboration/assignmentCoordination:resolve'), { ...resultActor,
    parentRunId: data.parentRunId, workflowRunId: 'coordinator', executionGeneration: 0, assignmentId: child.assignmentId,
    attemptId: child.attemptId, action, reason })
}

test('Phase 2: independent specialist conversations claim concurrently, and a duplicate workflow cannot win', async () => {
  const data = await fixture()
  const first = await dispatched(data)
  const second = await dispatched(data, args(data, { toolCallId: 'parallel' }))
  const acquire = mutation('collaboration/nativeTurnQueue:acquire')
  expect(await Promise.all([first, second].map(child => data.convex.mutation(acquire,
    { serverSecret: secret, actorUserId: 'alice', deliveryAgentRunId: child.turn.runId })))).toEqual([true, true])
  await applyOperation(data, first.childRunId, 'claim-first', { type: 'claim_execution', workflowRunId: 'winner' })
  await applyOperation(data, second.childRunId, 'claim-second', { type: 'claim_execution', workflowRunId: 'independent' })
  await expect(applyOperation(data, first.childRunId, 'claim-duplicate', { type: 'claim_execution', workflowRunId: 'loser' })).rejects.toThrow()
  await data.convex.run(async ctx => {
    const intents = await ctx.db.query('agentAssignmentLaunchIntents').collect()
    expect(intents.map(intent => intent.state)).toEqual(['launched', 'launched'])
    expect(intents.map(intent => intent.winnerWorkflowRunId).sort()).toEqual(['independent', 'winner'])
  })
})

test('Phase 2: persisted unlaunched work blocks finish and can be excluded without inventing success', async () => {
  const data = await fixture()
  await applyOperation(data, data.parentRunId, 'owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const assignment = await data.convex.mutation(createAssignment, args(data))
  await expect(applyOperation(data, data.parentRunId, 'premature-finish', { type: 'finish', resultSummary: 'Done' })).rejects.toThrow('ASSIGNMENTS_UNRESOLVED')
  await expect(resolution(data, assignment, 'accept')).rejects.toThrow('ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
  await expect(resolution(data, assignment, 'exclude', '   ')).rejects.toThrow('ASSIGNMENT_REASON_REQUIRED')
  expect(await resolution(data, assignment, 'exclude', 'Not needed for this outcome')).toMatchObject({ disposition: 'excluded' })
  expect(await applyOperation(data, data.parentRunId, 'one-finish', { type: 'finish', resultSummary: 'No specialist result was used.' })).toMatchObject({ applied: true, snapshot: { status: 'completed' } })
  await data.convex.run(async ctx => {
    const intent = (await ctx.db.query('agentAssignmentLaunchIntents').collect())[0]!
    expect(intent.state).toBe('cancelled')
    expect(await ctx.db.query('agentAssignmentResults').collect()).toHaveLength(0)
    expect((await ctx.db.query('harnessOperations').collect()).filter(row => JSON.parse(row.operationJson).type === 'finish')).toHaveLength(1)
  })
})

test('Phase 2: success requires publication and acceptance, failure requires reasoned exclusion', async () => {
  const data = await fixture()
  await applyOperation(data, data.parentRunId, 'owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const success = await dispatched(data)
  const failed = await dispatched(data, args(data, { toolCallId: 'failure' }))
  await childState(data, success, 'completed', false)
  await childState(data, failed, 'failed', true, 'Partial text is not success')
  await expect(resolution(data, success, 'accept')).rejects.toThrow('ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
  await expect(resolution(data, failed, 'accept')).rejects.toThrow('ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
  await childState(data, success, 'completed', true, 'The complete specialist answer')
  await resolution(data, success, 'accept')
  await expect(applyOperation(data, data.parentRunId, 'still-unresolved', { type: 'finish' })).rejects.toThrow('ASSIGNMENTS_UNRESOLVED')
  await resolution(data, failed, 'exclude', 'Proceed without the failed specialist')
  expect(await applyOperation(data, data.parentRunId, 'finish', { type: 'finish', resultSummary: 'One result accepted, one failed result excluded.' })).toMatchObject({ snapshot: { status: 'completed' } })
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: failed.childRunId })).toMatchObject({ runStatus: 'failed', reply: 'Partial text is not success' })
})

test('Phase 2: cancellation uses the subtree machinery and invalidates pending parent launches', async () => {
  const data = await fixture()
  await applyOperation(data, data.parentRunId, 'owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const child = await dispatched(data)
  const pending = await data.convex.mutation(createAssignment, args(data, { toolCallId: 'not-launched' }))
  await resolution(data, child, 'cancel', 'Stop this specialist')
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).toMatchObject({ runStatus: 'cancelled', terminal: true })
  const outstanding = await dispatched(data, args(data, { toolCallId: 'outstanding' }))
  await applyOperation(data, data.parentRunId, 'parent-cancel', { type: 'terminate', status: 'cancelled', reason: 'Requester stopped the parent' })
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: outstanding.childRunId })).toMatchObject({ runStatus: 'cancelled', terminal: true })
  await data.convex.run(async ctx => {
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', pending.attemptId)).unique()
    expect(intent?.state).toBe('cancelled')
    expect(intent?.generation).toBeGreaterThan(0)
  })
})

test('Phase 2: recovery reconstructs persisted dispatch identity and ignores stale generations', async () => {
  const data = await fixture()
  await applyOperation(data, data.parentRunId, 'owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const child = await data.convex.mutation(createAssignment, args(data))
  const intent = await data.convex.run(async ctx => (await ctx.db.query('agentAssignmentLaunchIntents').collect())[0]!)
  const work = mutation('collaboration/assignmentRecovery:work')
  expect(await data.convex.mutation(work, { serverSecret: secret, kind: 'assignment', id: intent._id, generation: 0 })).toMatchObject({
    kind: 'assignment', actorUserId: 'alice', parentRunId: data.parentRunId, toolCallId: 'call-1', agentId: 'target', brief: 'Review this feature' })
  expect(await data.convex.mutation(work, { serverSecret: secret, kind: 'assignment', id: intent._id, generation: 1 })).toBeNull()
  await resolution(data, child, 'exclude', 'No longer needed')
  expect(await data.convex.mutation(work, { serverSecret: secret, kind: 'assignment', id: intent._id, generation: 0 })).toBeNull()
})

test('Phase 2: queued assignment follow-ups retain each requester and resume only after publication', async () => {
  const data = await fixture()
  const first = await dispatched(data)
  const second = await data.convex.run(async ctx => {
    await ctx.db.insert('conversationParticipants', { conversationId: first.conversationId, workspaceId: 'workspace',
      principalId: 'bob', principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: Date.now(), updatedAt: Date.now() })
    return await ctx.db.insert('conversationMessages', { conversationId: first.conversationId, userId: 'bob', turnId: 'follow-up',
      role: 'user', authorKind: 'human', authorPrincipalId: 'bob', mode: 'act', content: 'Another request', contentType: 'text', createdAt: Date.now() })
  })
  const turn = await data.convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), { serverSecret: secret,
    actorUserId: 'bob', workspaceId: 'workspace', conversationId: first.conversationId, agentId: 'target',
    authorPrincipalId: 'target-principal', initiatorPrincipalId: 'bob', userMessageId: second,
    turnId: 'follow-up-target', clientNonce: 'follow-up-target', modelId: 'openrouter/free', executionEngine: 'overlay_harness' })
  const acquire = mutation('collaboration/nativeTurnQueue:acquire')
  expect(await data.convex.mutation(acquire, { serverSecret: secret, actorUserId: 'alice', deliveryAgentRunId: first.turn.runId })).toBe(true)
  expect(await data.convex.mutation(acquire, { serverSecret: secret, actorUserId: 'bob', deliveryAgentRunId: turn.runId })).toBe(false)
  await childState(data, first, 'completed', false)
  expect(await data.convex.mutation(acquire, { serverSecret: secret, actorUserId: 'bob', deliveryAgentRunId: turn.runId })).toBe(false)
  await childState(data, first, 'completed', true)
  expect(await data.convex.mutation(acquire, { serverSecret: secret, actorUserId: 'bob', deliveryAgentRunId: turn.runId })).toBe(true)
  await data.convex.run(async ctx => {
    expect((await ctx.db.get(first.turn.runId))?.userId).toBe('alice')
    expect((await ctx.db.get(turn.runId))?.userId).toBe('bob')
    const rows = await ctx.db.query('agentConversationTurnQueue').collect()
    expect(rows.map(row => [row.requesterUserId, row.state])).toEqual([['alice', 'settled'], ['bob', 'claimed']])
  })
})

test('Phase 2: an interrupted assignment transfers its winner through the existing continuation outbox', async () => {
  const data = await fixture(true)
  await applyOperation(data, data.parentRunId, 'parent-owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const child = await dispatched(data)
  await applyOperation(data, child.childRunId, 'child-owner', { type: 'claim_execution', workflowRunId: 'original-child' })
  await data.convex.run(ctx => ctx.db.patch(child.turn.runId, { workflowRunId: 'original-child' }))
  const blocked = await applyOperation(data, child.childRunId, 'child-blocked', { type: 'block', blocker: { kind: 'input', question: 'Need a decision' } })
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).toMatchObject({ state: 'working', runStatus: 'waiting_for_input', blocker: { question: 'Need a decision' } })
  const storageId = await data.convex.run(ctx => ctx.storage.store(new Blob([new Uint8Array(gzipSync(Buffer.from(JSON.stringify({
    checkpoint: { version: 1, messages: [], invocation: 1, modelCall: 0, stagnantSegments: 0, finalAnswerRequired: false, truncatedResponse: false, segmentStartedAt: Date.now() },
    launchInput: { access: { actorUserId: 'alice', workspaceId: 'workspace', runId: child.childRunId, executionGeneration: 1 } },
  }))))], { type: 'application/gzip' })))
  await data.convex.mutation(mutation('harness/continuations:handoff'), { serverSecret: secret, actorUserId: 'alice', runId: child.childRunId,
    workflowRunId: 'original-child', executionGeneration: 0, expectedRevision: blocked.snapshot.revision, workflowKind: 'native', checkpointStorageId: storageId })
  await applyOperation(data, child.childRunId, 'resumed-owner', { type: 'claim_execution', workflowRunId: 'resumed-child' })
  await applyOperation(data, child.childRunId, 'resume', { type: 'resume' })
  await expect(data.convex.mutation(mutation('harness/runs:apply'), { serverSecret: secret, actorUserId: 'alice', runId: child.childRunId,
    workflowRunId: 'original-child', executionGeneration: 0, expectedRevision: blocked.snapshot.revision, operationId: 'stale-resume', operation: { type: 'resume' } })).rejects.toThrow('HARNESS_EXECUTION_NOT_OWNED')
  await data.convex.run(async ctx => {
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', child.attemptId)).unique()
    expect(intent).toMatchObject({ generation: 1, winnerWorkflowRunId: 'resumed-child', state: 'launched' })
    expect(await ctx.db.query('agentAssignmentAttempts').collect()).toHaveLength(1)
    expect((await ctx.db.get(child.turn.runId))?.workflowRunId).toBe('resumed-child')
  })
  await applyOperation(data, child.childRunId, 'child-finish', { type: 'finish', resultSummary: 'Resumed result' })
  await childState(data, child, 'completed', true, 'Full resumed result')
  await resolution(data, child, 'accept')
  expect(await applyOperation(data, data.parentRunId, 'parent-finish', { type: 'finish', resultSummary: 'Consolidated resumed result' })).toMatchObject({ snapshot: { status: 'completed' } })
})

test('Phase 2: completion ignores unrelated historical runs and the queue excludes ordinary native collaboration', async () => {
  const data = await fixture()
  await data.convex.mutation(createAssignment, args(data))
  expect(await data.convex.run(ctx => assignmentCompletionIssues(ctx, 'unrelated-future-run'))).toEqual([])
  expect(await data.convex.run(ctx => assignmentCompletionIssues(ctx, data.parentRunId))).toHaveLength(1)
  const run = await data.convex.run(async ctx => (await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', data.parentRunId)).unique())!)
  expect(await data.convex.mutation(mutation('collaboration/nativeTurnQueue:acquire'), { serverSecret: secret, actorUserId: 'alice', deliveryAgentRunId: run.deliveryAgentRunId })).toBe(true)
  expect(await data.convex.run(ctx => ctx.db.query('agentConversationTurnQueue').collect())).toEqual([])
})

test('Phase 2: recovery does not publish a generating successful reply from partial text', async () => {
  const data = await fixture()
  await applyOperation(data, data.parentRunId, 'owner', { type: 'claim_execution', workflowRunId: 'coordinator' })
  const child = await dispatched(data)
  await applyOperation(data, child.childRunId, 'child-owner', { type: 'claim_execution', workflowRunId: 'child-workflow' })
  await childState(data, child, 'completed', false)
  await data.convex.run(ctx => ctx.db.patch(child.turn.runId, { status: 'completed', workflowRunId: 'child-workflow' }))
  const intent = await data.convex.run(async ctx => (await ctx.db.query('agentAssignmentLaunchIntents').collect())[0]!)
  expect(await data.convex.mutation(mutation('collaboration/assignmentRecovery:work'), { serverSecret: secret, kind: 'assignment', id: intent._id, generation: 0 }))
    .toMatchObject({ kind: 'publication', runId: child.childRunId, workflowRunId: 'child-workflow' })
  expect(await data.convex.run(async ctx => (await ctx.db.get(child.turn.messageId))?.status)).toBe('generating')
  await expect(resolution(data, child, 'accept')).rejects.toThrow('ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
})

test('attempt replay has one brief and delivery; revisions preserve the conversation and immutable provenance', async () => {
  const data = await fixture()
  const original = await dispatched(data)
  const replay = await dispatched(data)
  expect(replay).toEqual({ ...original, turn: { ...original.turn, resumed: true } })
  const nextInput = args(data, { toolCallId: 'revision', assignmentId: original.assignmentId,
    revisionOfAssignmentId: original.assignmentId, expectedAttemptId: original.attemptId, brief: 'Please revise' })
  const next = await dispatched(data, nextInput)
  expect(next.conversationId).toBe(original.conversationId)
  expect(next.attemptId).not.toBe(original.attemptId)
  expect(next.childRunId).not.toBe(original.childRunId)
  expect(next.turnId).not.toBe(original.turnId)
  await childState(data, next, 'completed', true, 'Current result')
  await childState(data, original, 'completed', true, 'Old result')
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: original.childRunId })).toMatchObject({ reply: 'Old result', superseded: true })
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: next.childRunId })).toMatchObject({ reply: 'Current result', superseded: false })
  await expect(data.convex.mutation(createAssignment, { ...nextInput, toolCallId: 'stale', idempotencyKey: `harness-run:${data.parentRunId}:tool:stale` }))
    .rejects.toThrow('ASSIGNMENT_REVISION_CONFLICT')
  await data.convex.run(async ctx => {
    expect(await ctx.db.query('agentAssignments').collect()).toHaveLength(1)
    expect(await ctx.db.query('agentAssignmentAttempts').collect()).toHaveLength(2)
    const assignment = (await ctx.db.query('agentAssignments').collect())[0]!
    expect(assignment.currentAttemptId).toBe(next.attemptId)
    expect(assignment.questionTurnId).toBe('ask-call-1')
    const messages = await ctx.db.query('conversationMessages').withIndex('by_conversationId_createdAt', q => q.eq('conversationId', original.conversationId)).collect()
    expect(messages).toHaveLength(4)
  })
})

test('competing revisions claim the expected attempt once and cannot retarget or change requester/caller authority', async () => {
  const data = await fixture()
  const original = await data.convex.mutation(createAssignment, args(data))
  const revision = { assignmentId: original.assignmentId, revisionOfAssignmentId: original.assignmentId, expectedAttemptId: original.attemptId }
  await expect(data.convex.mutation(createAssignment, args(data, { ...revision, toolCallId: 'retarget', assignedAgentId: 'caller' }))).rejects.toThrow()
  await expect(data.convex.mutation(createAssignment, args(data, { ...revision, toolCallId: 'other-requester', requesterUserId: 'bob' }))).rejects.toThrow('HARNESS_ACCESS_DENIED')
  await expect(data.convex.mutation(createAssignment, args(data, { ...revision, toolCallId: 'other-caller', callerAgentId: 'target', assignedAgentId: 'caller' }))).rejects.toThrow('HARNESS_ACCESS_DENIED')
  const competing = await Promise.allSettled(['revision-a', 'revision-b'].map(toolCallId =>
    data.convex.mutation(createAssignment, args(data, { ...revision, toolCallId }))))
  expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(competing.filter(result => result.status === 'rejected')).toHaveLength(1)
  await data.convex.run(async ctx => {
    expect(await ctx.db.query('agentAssignmentAttempts').collect()).toHaveLength(2)
  })
})

test('legacy assignments stay read projections and are never lazily materialized into attempts', async () => {
  const data = await fixture()
  const legacy = await data.convex.mutation(createAssignment, args(data))
  await data.convex.run(async ctx => {
    const assignment = (await ctx.db.query('agentAssignments').collect())[0]!
    await ctx.db.patch(assignment._id, { currentAttemptId: undefined })
    for (const attempt of await ctx.db.query('agentAssignmentAttempts').collect()) await ctx.db.delete(attempt._id)
  })
  expect(await data.convex.query(readResult, { ...resultActor, conversationId: legacy.conversationId, turnId: 'legacy-reply' })).toBeNull()
  expect(await data.convex.mutation(createAssignment, args(data))).not.toHaveProperty('attemptId')
  await expect(data.convex.mutation(createAssignment, args(data, { toolCallId: 'legacy-revision', assignmentId: legacy.assignmentId,
    revisionOfAssignmentId: legacy.assignmentId, expectedAttemptId: 'unmaterialized' }))).rejects.toThrow('LEGACY_ASSIGNMENT_REVISION_UNSUPPORTED')
  await data.convex.run(async ctx => { expect(await ctx.db.query('agentAssignmentAttempts').collect()).toHaveLength(0) })
})

test('publication is pending until delivery finalizes; both handles return the entire persisted reply and terminal receipts freeze', async () => {
  const data = await fixture()
  const child = await dispatched(data)
  await childState(data, child, 'completed', false)
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).toMatchObject({ state: 'publication_pending', terminal: true })
  const full = 'Full reply. '.repeat(2500)
  await childState(data, child, 'completed', true, full)
  const native = await data.convex.query(readResult, { ...resultActor, parentRunId: data.parentRunId, childRunId: child.childRunId })
  const tool = await data.convex.query(readResult, { ...resultActor, conversationId: child.conversationId, turnId: child.turnId })
  expect(native).toEqual(tool)
  expect(tool.reply).toBe(full)
  expect(tool.state).toBe('ready')
  await childState(data, child, 'running', false)
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).toEqual(tool)
  await expect(data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId, parentRunId: 'forged' })).rejects.toThrow('ASSIGNMENT_LINEAGE_DENIED')
})

test('real child settlement publishes pending state and duplicate receipts do not change the envelope', async () => {
  const data = await fixture()
  const child = await dispatched(data)
  const state = await data.convex.run(async ctx => {
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', child.childRunId)).unique()
    return JSON.parse(run!.metadataJson)
  })
  await data.convex.mutation(mutation('harness/runs:apply'), { serverSecret: secret, actorUserId: 'alice',
    runId: child.childRunId, operationId: 'finish-child', expectedRevision: state.revision,
    operation: { type: 'finish', resultSummary: 'Actual child summary' } })
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId }))
    .toMatchObject({ state: 'publication_pending', summary: 'Actual child summary' })
  const before = await data.convex.run(ctx => ctx.db.query('agentAssignmentResults').collect())
  await data.convex.mutation(mutation('collaboration/assignmentResults:settle'), { serverSecret: secret, childRunId: child.childRunId })
  expect(await data.convex.run(ctx => ctx.db.query('agentAssignmentResults').collect())).toEqual(before)
})

test.each(['failed', 'cancelled'])('%s with text remains failed execution, and empty completed replies are ready', async status => {
  const data = await fixture()
  const child = await dispatched(data)
  await childState(data, child, status, true, 'This claims success')
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).toMatchObject({ runStatus: status, state: 'ready', reply: 'This claims success' })
  const empty = await dispatched(data, args(data, { toolCallId: 'empty' }))
  await childState(data, empty, 'completed', true, '')
  expect(await data.convex.query(readResult, { ...resultActor, childRunId: empty.childRunId })).toMatchObject({ runStatus: 'completed', state: 'ready', reply: '' })
})

test('settled artifact reads require both source and child ACLs, bound provenance and expiry without opening the active-run API', async () => {
  const data = await fixture()
  const child = await dispatched(data)
  await data.convex.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['Artifact']))
    await ctx.db.insert('harnessContextArtifacts', { artifactId: 'artifact', runId: child.childRunId,
      workflowRunId: 'workflow', toolCallId: 'tool', toolName: 'search', digest: 'digest', storageId,
      byteSize: 8, mediaPartCount: 0, createdAt: Date.now(), expiresAt: Date.now() + 60_000 })
  })
  await childState(data, child, 'completed', true)
  const request = { ...resultActor, attemptId: child.attemptId, artifactId: 'artifact' }
  expect(await data.convex.query(readArtifact, request)).toMatchObject({ artifactId: 'artifact' })
  const chunkReader = makeFunctionReference<'action'>('harness/artifacts:readSettledResultChunk')
  expect(new TextDecoder().decode(await data.convex.action(chunkReader, { ...request, offset: 0, length: 8 }))).toBe('Artifact')
  await expect(data.convex.action(chunkReader, { ...request, offset: -1, length: 8 })).rejects.toThrow('HARNESS_ARTIFACT_RANGE_INVALID')
  await expect(data.convex.query(query('harness/artifactMetadata:getMetadataForServer'), {
    serverSecret: secret, actorUserId: 'alice', runId: child.childRunId, workflowRunId: 'workflow', artifactId: 'artifact',
  })).rejects.toThrow('HARNESS_ARTIFACT_UNAUTHORIZED')
  for (const actorUserId of ['bob', 'charlie']) {
    await expect(data.convex.query(readResult, { ...resultActor, actorUserId, childRunId: child.childRunId })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(data.convex.query(readArtifact, { ...request, actorUserId })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(data.convex.action(chunkReader, { ...request, actorUserId, offset: 0, length: 8 })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  }
  await data.convex.run(async ctx => {
    const artifact = (await ctx.db.query('harnessContextArtifacts').collect())[0]!
    await ctx.db.patch(artifact._id, { expiresAt: Date.now() - 1 })
  })
  expect(await data.convex.query(readArtifact, request)).toBeNull()
  expect(await data.convex.action(chunkReader, { ...request, offset: 0, length: 8 })).toBeNull()
  expect((await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).artifactRefs).toEqual([])
  await data.convex.run(async ctx => {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId).eq('principalId', 'alice')).unique()
    await ctx.db.patch(participant!._id, { status: 'removed' })
  })
  await expect(data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('settled artifact resource access is rechecked after source visibility is revoked', async () => {
  const data = await fixture()
  const child = await dispatched(data)
  const fileId = await data.convex.run(async ctx => {
    const id = await ctx.db.insert('files', { userId: 'charlie', workspaceId: 'workspace', scope: 'workspace',
      name: 'Shared note', type: 'file', kind: 'note', createdAt: 1, updatedAt: 1 })
    const storageId = await ctx.storage.store(new Blob(['Note']))
    await ctx.db.insert('harnessContextArtifacts', { artifactId: 'file-artifact', runId: child.childRunId,
      workflowRunId: 'workflow', toolCallId: 'file-tool', toolName: 'get_note', digest: 'digest', storageId,
      byteSize: 4, mediaPartCount: 0, createdAt: Date.now(), expiresAt: Date.now() + 60_000, resource: { id } })
    return id
  })
  await childState(data, child, 'completed', true)
  const request = { ...resultActor, attemptId: child.attemptId, artifactId: 'file-artifact' }
  expect(await data.convex.query(readArtifact, request)).toMatchObject({ resource: { id: fileId } })
  await data.convex.run(async ctx => { await ctx.db.patch(fileId, { scope: 'personal' }) })
  await expect(data.convex.query(readArtifact, request)).rejects.toThrow('HARNESS_ARTIFACT_SOURCE_UNAVAILABLE')
  expect((await data.convex.query(readResult, { ...resultActor, childRunId: child.childRunId })).artifactRefs).toEqual([])
})

test('origin is inherited only while the viewer can access the source', async () => {
  const data = await fixture()
  const child = await data.convex.mutation(createAssignment, args(data))
  await data.convex.run(async ctx => {
    await ctx.db.insert('surfaceConnections', { id: 'connection', workspaceId: 'workspace', platform: 'slack', externalTeamId: 'T',
      status: 'active', installedByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceThreadLinks', { workspaceId: 'workspace', platform: 'slack', connectionId: 'connection', externalTeamId: 'T',
      channelId: 'C', threadId: 'thread', conversationId: data.parentConversationId, channelName: 'private-name',
      originalBindingId: 'binding', createdAt: 1, updatedAt: 1 })
  })
  const alice = data.convex.withIdentity({ subject: 'alice', issuer: 'https://issuer.example.test' })
  expect((await alice.query(forConversation, { workspaceId: 'workspace', conversationId: child.conversationId })).origin).toMatchObject({ platform: 'slack', channelName: 'private-name' })
  await data.convex.run(async ctx => {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId).eq('principalId', 'alice')).unique()
    await ctx.db.patch(participant!._id, { status: 'removed' })
  })
  const hidden = await alice.query(forConversation, { workspaceId: 'workspace', conversationId: child.conversationId })
  expect(hidden.origin).toBeUndefined()
  expect(JSON.stringify(hidden)).not.toContain('private-name')
})

test('exact replay reuses an isolated thread and changed input under the key rejects', async () => {
  const data = await fixture()
  const input = args(data)
  const first = await data.convex.mutation(createAssignment, input)
  const replay = await data.convex.mutation(createAssignment, input)
  expect(replay).toEqual(first)
  await expect(data.convex.mutation(createAssignment, { ...input, brief: 'Changed brief' }))
    .rejects.toThrow('ASSIGNMENT_IDEMPOTENCY_CONFLICT')
  await data.convex.mutation(createAssignment, args(data, { toolCallId: 'call-2' }))
  await data.convex.run(async ctx => {
    const rows = await ctx.db.query('agentAssignments').collect()
    expect(rows).toHaveLength(2)
    const child = await ctx.db.get(first.conversationId)
    expect(child?.agentId).toBe('target')
    expect(child?.dmIdentityKey).toBeUndefined()
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', first.conversationId))
      .collect()
    expect(participants.map(row => row.principalId).sort())
      .toEqual(['alice', 'caller-principal', 'target-principal'])
  })
})

test('requester, parent and target authority are checked before creation', async () => {
  const data = await fixture()
  await expect(data.convex.mutation(createAssignment, {
    ...args(data), requesterUserId: 'charlie',
  })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  await expect(data.convex.mutation(createAssignment, {
    ...args(data), assignedAgentId: 'personal',
  })).rejects.toThrow('PERSONAL_CHIEF_GRANT_REQUIRED')
  await expect(data.convex.mutation(createAssignment, {
    ...args(data), workspaceId: 'other-workspace',
  })).rejects.toThrow()
})

test('read model returns only authorized child and parent navigation', async () => {
  const data = await fixture()
  const assignment = await data.convex.mutation(createAssignment, args(data))
  const alice = data.convex.withIdentity({ subject: 'alice', issuer: 'https://issuer.example.test' })
  const parent = await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: data.parentConversationId,
  })
  expect(parent.assignments).toMatchObject([{
    assignmentId: 'assignment-call-1', agentId: 'target', agentName: 'Target',
    status: 'queued', scope: 'workspace',
  }])
  const bob = data.convex.withIdentity({ subject: 'bob', issuer: 'https://issuer.example.test' })
  expect((await bob.query(forConversation, {
    workspaceId: 'workspace', conversationId: data.parentConversationId,
  })).assignments).toEqual([])
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: assignment.conversationId,
  })).parent).toMatchObject({ scope: 'workspace', conversationId: data.parentConversationId })
  await data.convex.run(async ctx => {
    const parentParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId)
        .eq('principalId', 'alice')).unique()
    await ctx.db.patch(parentParticipant!._id, { status: 'removed' })
  })
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: assignment.conversationId,
  })).parent).toBeNull()
  await data.convex.run(async ctx => {
    const childParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', assignment.conversationId)
        .eq('principalId', 'alice')).unique()
    const parentParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId)
        .eq('principalId', 'alice')).unique()
    await ctx.db.patch(parentParticipant!._id, { status: 'active' })
    await ctx.db.patch(childParticipant!._id, { status: 'removed' })
  })
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: data.parentConversationId,
  })).assignments).toEqual([])
  await data.convex.run(async ctx => {
    const childParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', assignment.conversationId)
        .eq('principalId', 'alice')).unique()
    const parentParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId)
        .eq('principalId', 'alice')).unique()
    await ctx.db.patch(parentParticipant!._id, { status: 'active', workspaceId: 'other-workspace' })
    await ctx.db.patch(childParticipant!._id, { status: 'active' })
  })
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: assignment.conversationId,
  })).parent).toBeNull()
})

test('root followups in assignment conversations inherit persisted parent restrictions', async () => {
  const data = await fixture()
  const assignment = await data.convex.mutation(createAssignment, args(data))
  expect(await data.convex.mutation(preAdmissionRestrictions, {
    actorUserId: 'alice', workspaceId: 'workspace', conversationId: assignment.conversationId, serverSecret: secret,
  })).toEqual({ inheritedSharedRoom: true })
})

test('external surface identity is shared even when only one human remains', async () => {
  const data = await fixture()
  await data.convex.run(async ctx => {
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId)).collect()
    const bob = participants.find(row => row.principalId === 'bob')
    await ctx.db.patch(data.parentConversationId, { externalPlatform: 'slack', surfaceBindingId: 'binding' })
    if (bob) await ctx.db.patch(bob._id, { status: 'removed' })
  })
  expect(await data.convex.mutation(preAdmissionRestrictions, {
    actorUserId: 'alice', workspaceId: 'workspace', conversationId: data.parentConversationId, serverSecret: secret,
  })).toEqual({ inheritedSharedRoom: true })
})


test('assignment writes reject archived workspaces and unsupported harness targets', async () => {
  const archived = await fixture()
  await archived.convex.run(async ctx => {
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', 'workspace')).unique()
    await ctx.db.patch(workspace!._id, { status: 'archived', archivedAt: Date.now() })
  })
  await expect(archived.convex.mutation(createAssignment, args(archived))).rejects.toThrow('WORKSPACE_ACCESS_DENIED')

  const unsupported = await fixture()
  await unsupported.convex.run(async ctx => {
    const target = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', q => q.eq('agentId', 'target')).unique()
    await ctx.db.patch(target!._id, { harness: 'claude-code' })
  })
  await expect(unsupported.convex.mutation(createAssignment, args(unsupported))).rejects.toThrow('NATIVE_HARNESS_TARGET_REQUIRED')
})

test('creator-only ordinary agents use personal navigation scope', async () => {
  const data = await fixture()
  await data.convex.run(async ctx => {
    const target = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', q => q.eq('agentId', 'target')).unique()
    await ctx.db.patch(target!._id, { visibility: 'creator' })
  })
  await data.convex.mutation(createAssignment, args(data))
  const alice = data.convex.withIdentity({ subject: 'alice', issuer: 'https://issuer.example.test' })
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: data.parentConversationId,
  })).assignments[0]?.scope).toBe('personal')
})
