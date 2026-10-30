import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { HarnessAdmission, HarnessOperation } from '../packages/overlay-agent-runtime/src/harness-store'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'native-harness-delivery-test'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
const query = (path: string) => makeFunctionReference<'query'>(path)
type Convex = ReturnType<typeof convexTest>
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function seed(convex: Convex) {
  return convex.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspaces', { workspaceId: 'workspace', kind: 'organization', name: 'QA', slug: 'qa',
      status: 'active', createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { principalId: userId, workspaceId: 'workspace', type: 'human',
        userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: userId, workspaceId: 'workspace', principalId: userId,
        role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
    await ctx.db.insert('workspacePrincipals', { principalId: 'agent-principal', workspaceId: 'workspace', type: 'agent',
      agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    const agentId = await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'agent', workspaceId: 'workspace',
      principalId: 'agent-principal', name: 'Agent', instructions: '', harness: 'overlay', modelId: 'openrouter/free',
      allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'bob', createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'bob', workspaceId: 'workspace',
      conversationType: 'dm', title: 'Native harness QA', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    const participants: Record<string, string> = {}
    for (const principalId of ['alice', 'bob', 'agent-principal']) {
      participants[principalId] = await ctx.db.insert('conversationParticipants', { conversationId,
        workspaceId: 'workspace', principalId, principalType: principalId === 'agent-principal' ? 'agent' : 'human',
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'alice', turnId: 'question',
      role: 'user', mode: 'act', content: 'Read the synthetic record.', contentType: 'text', createdAt: now })
    return { conversationId, userMessageId, agentId, participants }
  })
}

async function open(
  convex: Convex,
  fixture: Awaited<ReturnType<typeof seed>>,
  actorUserId = 'alice',
  engine = true,
  key = actorUserId,
) {
  return convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId, agentId: 'agent', authorPrincipalId: 'agent-principal', conversationId: fixture.conversationId,
    clientNonce: `nonce-${key}`, turnId: `turn-${key}`, modelId: 'openrouter/free',
    userMessageId: fixture.userMessageId, workspaceId: 'workspace', serverSecret: secret,
    ...(engine ? { executionEngine: 'overlay_harness' } : {}),
  })
}

function admission(conversationId: string, deliveryAgentRunId: string): HarnessAdmission {
  return { runId: `workspace:${deliveryAgentRunId}`, deliveryAgentRunId, source: { conversationId }, goal: 'Read the record.',
    constraints: [], policy: { actorUserId: 'alice', workspaceId: 'workspace', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2 } }
}

test('legacy lease sweep preserves durable Harness waits and still expires legacy rooms', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await seed(convex)
  const harness = await open(convex, fixture, 'alice', true, 'durable')
  const legacy = await open(convex, fixture, 'alice', false, 'legacy')
  await convex.run(async ctx => {
    const durableRun = await ctx.db.get(harness.runId)
    expect(durableRun?.leaseExpiresAt).toBeUndefined()
    // Cover already-admitted Harness rows carrying an old executor lease.
    for (const runId of [harness.runId, legacy.runId]) {
      await ctx.db.patch(runId, { status: 'waiting_for_approval', leaseExpiresAt: Date.now() - 1 })
    }
  })
  const result = await convex.mutation(mutation('chat/conversations:expireToolLoopAgentRunLeases'), {})
  expect(result.expiredCount).toBe(1)
  await convex.run(async ctx => {
    expect((await ctx.db.get(harness.runId))?.status).toBe('waiting_for_approval')
    expect((await ctx.db.get(legacy.runId))?.status).toBe('failed')
  })
})

async function namedAdmissionFixture(convex: Convex, scenario?: string) {
  const fixture = await seed(convex)
  const parentTurn = await open(convex, fixture)
  const parent = admission(fixture.conversationId, parentTurn.runId)
  await convex.mutation(mutation('harness/runs:admit'), { ...parent, serverSecret: secret })
  const target = await convex.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspacePrincipals', { principalId: 'target-principal', workspaceId: 'workspace', type: 'agent',
      agentId: 'target', displayName: 'Target', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'target', workspaceId: 'workspace',
      principalId: 'target-principal', name: 'Target', instructions: '', harness: 'overlay', modelId: 'openrouter/free',
      allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'alice', createdAt: now, updatedAt: now })
    const sameRoom = scenario === 'same-room'
    const conversationId = sameRoom ? fixture.conversationId : await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId: 'workspace', conversationType: 'dm', title: 'Asked agent',
      lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free',
    })
    const participants: Record<string, string> = {}
    const roomParticipants = sameRoom
      ? [['target-principal', 'agent']] as const
      : [['alice', 'human'], ['agent-principal', 'agent'], ['target-principal', 'agent']] as const
    for (const [principalId, principalType] of roomParticipants) {
      participants[principalId] = await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'workspace',
        principalId, principalType, role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'alice',
      turnId: 'named-question', role: 'user', mode: 'act', content: 'Please inspect this.', contentType: 'text',
      authorKind: 'agent', authorPrincipalId: 'agent-principal', createdAt: now })
    return { conversationId, userMessageId, participants }
  })
  const targetTurn = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'alice', agentId: 'target', authorPrincipalId: 'target-principal',
    initiatorPrincipalId: 'agent-principal', conversationId: target.conversationId, clientNonce: 'named-child',
    turnId: 'target-turn', modelId: 'openrouter/free', userMessageId: target.userMessageId,
    workspaceId: 'workspace', ...(scenario === 'wrong-engine' ? {} : { executionEngine: 'overlay_harness' }),
    serverSecret: secret,
  })
  await convex.run(async ctx => {
    if (scenario === 'non-participant') {
      await ctx.db.patch(ctx.db.normalizeId('conversationParticipants', target.participants['target-principal']!)!, { status: 'removed' })
    }
    if (scenario === 'foreign-workspace') await ctx.db.patch(target.conversationId, { workspaceId: 'foreign-workspace' })
    if (scenario === 'trigger-author') await ctx.db.patch(target.userMessageId, { authorPrincipalId: 'other-agent' })
    if (scenario === 'already-bound') await ctx.db.patch(targetTurn.runId, { harnessRunId: 'workspace:already-bound' })
  })
  const childRunId = `workspace:${targetTurn.runId}`
  const operation: HarnessOperation = {
    type: 'admit_named_child',
    child: { id: childRunId, stepId: 'ask:call:target', allowedToolIds: [], maxCostMicros: 0,
      costMicros: 0, status: 'running', evidenceRefs: [] },
    step: { title: 'Ask Target', acceptanceCriteria: ['Target responds to the request.'] },
    goal: 'Please inspect this.', constraints: [],
    target: { deliveryAgentRunId: targetTurn.runId, conversationId: target.conversationId },
  }
  return { fixture, parent, parentTurn, target, targetTurn, childRunId, operation }
}

async function createNamedChild(
  convex: Convex,
  input: {
    conversationId: string
    parentRunId: string
    parentAgentPrincipalId: string
    targetAgentId: string
    targetPrincipalId: string
    key: string
  },
) {
  const userMessageId = await convex.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspacePrincipals', { principalId: input.targetPrincipalId, workspaceId: 'workspace',
      type: 'agent', agentId: input.targetAgentId, displayName: input.targetAgentId, createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: input.targetAgentId, workspaceId: 'workspace',
      principalId: input.targetPrincipalId, name: input.targetAgentId, instructions: '', harness: 'overlay',
      modelId: 'openrouter/free', allowedToolIds: [], invocationPolicy: 'mention',
      createdByPrincipalId: 'alice', createdAt: now, updatedAt: now })
    await ctx.db.insert('conversationParticipants', { conversationId: input.conversationId, workspaceId: 'workspace',
      principalId: input.targetPrincipalId, principalType: 'agent', role: 'member', status: 'active',
      notificationLevel: 'all', joinedAt: now, updatedAt: now })
    return await ctx.db.insert('conversationMessages', { conversationId: input.conversationId, userId: 'alice',
      turnId: `${input.key}-question`, role: 'user', mode: 'act', content: `Ask ${input.targetAgentId}.`,
      contentType: 'text', authorKind: 'agent', authorPrincipalId: input.parentAgentPrincipalId, createdAt: now })
  })
  const turn = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'alice', agentId: input.targetAgentId, authorPrincipalId: input.targetPrincipalId,
    initiatorPrincipalId: input.parentAgentPrincipalId, conversationId: input.conversationId,
    clientNonce: input.key, turnId: `${input.key}-turn`, modelId: 'openrouter/free', userMessageId,
    workspaceId: 'workspace', executionEngine: 'overlay_harness', serverSecret: secret,
  })
  const runId = `workspace:${turn.runId}`
  await apply(convex, input.parentRunId, {
    type: 'admit_named_child',
    child: { id: runId, stepId: `ask:${input.key}:${input.targetAgentId}`, allowedToolIds: [],
      maxCostMicros: 0, costMicros: 0, status: 'running', evidenceRefs: [] },
    step: { title: `Ask ${input.targetAgentId}`, acceptanceCriteria: [`${input.targetAgentId} responds.`] },
    goal: `Please ask ${input.targetAgentId}.`, constraints: [],
    target: { deliveryAgentRunId: turn.runId, conversationId: input.conversationId },
  })
  return { runId, turn }
}

async function claimAndAttachWorkflow(
  convex: Convex,
  runId: string,
  agentRunId: string,
  workflowRunId: string,
) {
  await apply(convex, runId, { type: 'claim_execution', workflowRunId })
  await convex.mutation(mutation('chat/conversations:attachAgentRunWorkflow'), {
    runId: agentRunId, serverSecret: secret, userId: 'alice', workflowRunId,
  })
}

async function apply(convex: Convex, runId: string, operation: HarnessOperation) {
  const state = await convex.query(query('harness/runs:get'), { actorUserId: 'alice', runId, serverSecret: secret })
  return convex.mutation(mutation('harness/runs:apply'), { actorUserId: 'alice', runId, expectedRevision: state.revision,
    operationId: `${operation.type}:${state.revision}`, operation, serverSecret: secret })
}

test('native admission binds one room delivery for its invoker, not its room creator', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await seed(convex)
  const turn = await open(convex, fixture)
  const input = { ...admission(fixture.conversationId, turn.runId), serverSecret: secret }
  const root = await convex.mutation(mutation('harness/runs:admit'), input)
  expect(root.runId).toBe(input.runId)
  expect((await convex.run(ctx => ctx.db.get(turn.runId)))?.harnessRunId).toBe(root.runId)
  expect((await convex.mutation(mutation('harness/runs:admit'), input)).revision).toBe(root.revision)
  expect((await open(convex, fixture)).resumed).toBe(true)
  await expect(convex.mutation(mutation('harness/runs:admit'), { ...input, runId: 'different-root' })).rejects.toThrow()
})

test('named admission binds a cross-room delivery authored by the current parent agent', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await seed(convex)
  const parentTurn = await open(convex, fixture)
  const parent = admission(fixture.conversationId, parentTurn.runId)
  await convex.mutation(mutation('harness/runs:admit'), { ...parent, serverSecret: secret })
  const target = await convex.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspacePrincipals', { principalId: 'target-principal', workspaceId: 'workspace', type: 'agent',
      agentId: 'target', displayName: 'Target', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'target', workspaceId: 'workspace',
      principalId: 'target-principal', name: 'Target', instructions: '', harness: 'overlay', modelId: 'openrouter/free',
      allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'alice', createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'workspace',
      conversationType: 'dm', title: 'Asked agent', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    for (const [principalId, principalType] of [['alice', 'human'], ['agent-principal', 'agent'], ['target-principal', 'agent']] as const) {
      await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'workspace', principalId, principalType,
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'alice',
      turnId: 'named-question', role: 'user', mode: 'act', content: 'Please inspect this.', contentType: 'text',
      authorKind: 'agent', authorPrincipalId: 'agent-principal', createdAt: now })
    return { conversationId, userMessageId }
  })
  const targetTurn = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'alice', agentId: 'target', authorPrincipalId: 'target-principal',
    initiatorPrincipalId: 'agent-principal', conversationId: target.conversationId, clientNonce: 'named-child',
    turnId: 'target-turn', modelId: 'openrouter/free', userMessageId: target.userMessageId,
    workspaceId: 'workspace', executionEngine: 'overlay_harness', serverSecret: secret,
  })
  const childRunId = `workspace:${targetTurn.runId}`
  const result = await convex.mutation(mutation('harness/runs:apply'), {
    actorUserId: 'alice', runId: parent.runId, expectedRevision: 0, operationId: 'named-child:call:target',
    operation: {
      type: 'admit_named_child',
      child: { id: childRunId, stepId: 'ask:call:target', allowedToolIds: [], maxCostMicros: 0,
        costMicros: 0, status: 'running', evidenceRefs: [] },
      step: { title: 'Ask Target', acceptanceCriteria: ['Target responds to the request.'] },
      goal: 'Please inspect this.', constraints: [],
      target: { deliveryAgentRunId: targetTurn.runId, conversationId: target.conversationId },
    },
    serverSecret: secret,
  })
  expect(result.snapshot.children).toEqual([expect.objectContaining({ id: childRunId, stepId: 'ask:call:target' })])
  expect((await convex.run(ctx => ctx.db.get(targetTurn.runId)))?.harnessRunId).toBe(childRunId)
  expect((await convex.query(query('harness/runs:get'), { actorUserId: 'alice', runId: childRunId, serverSecret: secret }))
    .parentRunId).toBe(parent.runId)
  await apply(convex, parent.runId, { type: 'claim_execution', workflowRunId: 'root-workflow' })
  await apply(convex, childRunId, { type: 'claim_execution', workflowRunId: 'named-child-workflow' })
  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.conversationId, userId: 'alice', serverSecret: secret,
  })
  expect(cancelled.cancelledHarnessRoots).toEqual(expect.arrayContaining([
    { agentRunId: parentTurn.runId, runId: parent.runId },
    { agentRunId: targetTurn.runId, runId: childRunId },
  ]))
  expect((await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: childRunId, serverSecret: secret,
  })).status).toBe('cancelled')
  const rootWorkflows = await convex.query(query('harness/runs:listDeliveryWorkflowRuns'), {
    actorUserId: 'alice', agentRunId: parentTurn.runId, rootRunId: parent.runId, cursor: null, serverSecret: secret,
  })
  expect(rootWorkflows.workflowRunIds).toEqual(['root-workflow'])
  const childWorkflows = await convex.query(query('harness/runs:listDeliveryWorkflowRuns'), {
    actorUserId: 'alice', agentRunId: targetTurn.runId, rootRunId: childRunId, cursor: null, serverSecret: secret,
  })
  expect(childWorkflows.workflowRunIds).toEqual(['named-child-workflow'])
})

test.each(['wrong-engine', 'non-participant', 'foreign-workspace', 'trigger-author', 'already-bound'])
  ('named admission rejects %s targets atomically', async scenario => {
    const convex = convexTest(schema, modules)
    const fixture = await namedAdmissionFixture(convex, scenario)
    await expect(apply(convex, fixture.parent.runId, fixture.operation)).rejects.toThrow()
    expect((await convex.query(query('harness/runs:get'), {
      actorUserId: 'alice', runId: fixture.parent.runId, serverSecret: secret,
    })).children).toEqual([])
    const targetRun = await convex.run(ctx => ctx.db.get(fixture.targetTurn.runId))
    if (scenario === 'already-bound') expect(targetRun?.harnessRunId).toBe('workspace:already-bound')
    else expect(targetRun?.harnessRunId).toBeUndefined()
  })

test('named-child Stop cancels only that cross-room subtree and leaves its parent active', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await namedAdmissionFixture(convex)
  await apply(convex, fixture.parent.runId, fixture.operation)
  const siblingTarget = await convex.run(async ctx => {
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'workspace',
      conversationType: 'dm', title: 'Sibling agent room', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    for (const [principalId, principalType] of [
      ['alice', 'human'], ['agent-principal', 'agent'], ['target-principal', 'agent'],
    ] as const) {
      await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'workspace', principalId,
        principalType, role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    const userMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'alice',
      turnId: 'sibling-question', role: 'user', mode: 'act', content: 'Inspect the sibling room.',
      contentType: 'text', authorKind: 'agent', authorPrincipalId: 'agent-principal', createdAt: now })
    return { conversationId, userMessageId }
  })
  const siblingTurn = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'alice', agentId: 'target', authorPrincipalId: 'target-principal',
    initiatorPrincipalId: 'agent-principal', conversationId: siblingTarget.conversationId,
    clientNonce: 'named-sibling', turnId: 'sibling-turn', modelId: 'openrouter/free',
    userMessageId: siblingTarget.userMessageId, workspaceId: 'workspace', executionEngine: 'overlay_harness',
    serverSecret: secret,
  })
  const siblingRunId = `workspace:${siblingTurn.runId}`
  await apply(convex, fixture.parent.runId, {
    type: 'admit_named_child',
    child: { id: siblingRunId, stepId: 'ask:sibling:target', allowedToolIds: [], maxCostMicros: 0,
      costMicros: 0, status: 'running', evidenceRefs: [] },
    step: { title: 'Ask sibling', acceptanceCriteria: ['The sibling responds.'] },
    goal: 'Inspect the sibling room.', constraints: [],
    target: { deliveryAgentRunId: siblingTurn.runId, conversationId: siblingTarget.conversationId },
  })
  await apply(convex, fixture.parent.runId, { type: 'claim_execution', workflowRunId: 'root-workflow' })
  await apply(convex, fixture.childRunId, { type: 'claim_execution', workflowRunId: 'named-child-workflow' })
  await apply(convex, siblingRunId, { type: 'claim_execution', workflowRunId: 'sibling-workflow' })
  await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.target.conversationId, userId: 'alice', serverSecret: secret,
  })
  expect((await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: fixture.childRunId, serverSecret: secret,
  })).status).toBe('cancelled')
  const parentState = await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: fixture.parent.runId, serverSecret: secret,
  })
  expect(parentState.status).toBe('running')
  expect(parentState.children).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: fixture.childRunId, status: 'running' }),
    expect.objectContaining({ id: siblingRunId, status: 'running' }),
  ]))
  expect((await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: siblingRunId, serverSecret: secret,
  })).status).toBe('running')
  expect((await convex.run(ctx => ctx.db.get(siblingTurn.runId)))?.status).toBe('queued')
  const workflows = await convex.query(query('harness/runs:listDeliveryWorkflowRuns'), {
    actorUserId: 'alice', agentRunId: fixture.targetTurn.runId, rootRunId: fixture.childRunId,
    cursor: null, serverSecret: secret,
  })
  expect(workflows.workflowRunIds).toEqual(['named-child-workflow'])
})

test('parent Stop cancels named descendants across conversations and leaves another tree active', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await namedAdmissionFixture(convex)
  await apply(convex, fixture.parent.runId, fixture.operation)
  const grandchild = await createNamedChild(convex, {
    conversationId: fixture.target.conversationId,
    parentRunId: fixture.childRunId,
    parentAgentPrincipalId: 'target-principal',
    targetAgentId: 'grandchild',
    targetPrincipalId: 'grandchild-principal',
    key: 'cross-room-grandchild',
  })
  const unrelatedUserMessageId = await convex.run(ctx => ctx.db.insert('conversationMessages', {
    conversationId: fixture.target.conversationId,
    userId: 'alice',
    turnId: 'unrelated-cross-room-question',
    role: 'user',
    mode: 'act',
    content: 'Inspect an unrelated tree.',
    contentType: 'text',
    authorKind: 'agent',
    authorPrincipalId: 'agent-principal',
    createdAt: Date.now(),
  }))
  const unrelatedTurn = await open(convex, {
    ...fixture.fixture,
    conversationId: fixture.target.conversationId,
    userMessageId: unrelatedUserMessageId,
  }, 'alice', true, 'unrelated-cross-room')
  const unrelatedHarness = admission(fixture.target.conversationId, unrelatedTurn.runId)
  await convex.mutation(mutation('harness/runs:admit'), { ...unrelatedHarness, serverSecret: secret })
  await claimAndAttachWorkflow(convex, fixture.parent.runId, fixture.parentTurn.runId, 'parent-workflow')
  await claimAndAttachWorkflow(convex, fixture.childRunId, fixture.targetTurn.runId, 'child-workflow')
  await claimAndAttachWorkflow(convex, grandchild.runId, grandchild.turn.runId, 'grandchild-workflow')
  await claimAndAttachWorkflow(convex, unrelatedHarness.runId, unrelatedTurn.runId, 'unrelated-workflow')

  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.fixture.conversationId,
    messageId: fixture.parentTurn.messageId,
    userId: 'alice',
    serverSecret: secret,
  })
  expect(cancelled.stoppedCount).toBe(3)
  expect(cancelled.cancelledRunIds).toEqual(expect.arrayContaining([
    fixture.parentTurn.runId, fixture.targetTurn.runId, grandchild.turn.runId,
  ]))
  expect(cancelled.cancelledRunIds).not.toContain(unrelatedTurn.runId)
  expect(cancelled.cancelledWorkflowRunIds).toEqual(expect.arrayContaining([
    'parent-workflow', 'child-workflow', 'grandchild-workflow',
  ]))
  expect(cancelled.cancelledWorkflows).toEqual(expect.arrayContaining([
    { agentRunId: fixture.parentTurn.runId, workflowRunId: 'parent-workflow' },
    { agentRunId: fixture.targetTurn.runId, workflowRunId: 'child-workflow' },
    { agentRunId: grandchild.turn.runId, workflowRunId: 'grandchild-workflow' },
  ]))
  expect(cancelled.cancelledHarnessRoots).toEqual(expect.arrayContaining([
    { agentRunId: fixture.parentTurn.runId, runId: fixture.parent.runId },
    { agentRunId: fixture.targetTurn.runId, runId: fixture.childRunId },
    { agentRunId: grandchild.turn.runId, runId: grandchild.runId },
  ]))

  const cancelledAgentRuns = await convex.run(ctx => Promise.all([
    fixture.parentTurn.runId, fixture.targetTurn.runId, grandchild.turn.runId,
  ].map(runId => ctx.db.get(runId))))
  expect(cancelledAgentRuns.map(run => run?.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  const cancelledMessages = await convex.run(ctx => Promise.all([
    fixture.parentTurn.messageId, fixture.targetTurn.messageId, grandchild.turn.messageId,
  ].map(messageId => ctx.db.get(messageId))))
  expect(cancelledMessages.map(message => message?.status)).toEqual(['completed', 'completed', 'completed'])
  expect(cancelledMessages.map(message => message?.content)).toEqual([
    expect.stringContaining('This response was interrupted. Should I continue?'),
    expect.stringContaining('This response was interrupted. Should I continue?'),
    expect.stringContaining('This response was interrupted. Should I continue?'),
  ])
  const cancelledHarnessStates = await Promise.all([
    fixture.parent.runId, fixture.childRunId, grandchild.runId,
  ].map(runId => convex.query(query('harness/runs:get'), { actorUserId: 'alice', runId, serverSecret: secret })))
  expect(cancelledHarnessStates.map(run => run.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  const finalCounts = await convex.run(async ctx => Promise.all([
    fixture.parent.runId, fixture.childRunId, grandchild.runId,
  ].map(runId => ctx.db.query('harnessRuns').withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', runId)).unique())))
  expect(finalCounts.map(run => run?.activeDescendantCount)).toEqual([0, 0, 0])
  expect((await convex.run(ctx => ctx.db.get(unrelatedTurn.runId)))?.status).toBe('running')
  expect((await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: unrelatedHarness.runId, serverSecret: secret,
  })).status).toBe('running')
})

test('parent Stop cancels its same-conversation named subtree deepest-first', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await namedAdmissionFixture(convex, 'same-room')
  await apply(convex, fixture.parent.runId, fixture.operation)
  const grandchild = await createNamedChild(convex, {
    conversationId: fixture.fixture.conversationId,
    parentRunId: fixture.childRunId,
    parentAgentPrincipalId: 'target-principal',
    targetAgentId: 'grandchild',
    targetPrincipalId: 'grandchild-principal',
    key: 'named-grandchild',
  })
  const unrelatedTurn = await open(convex, fixture.fixture, 'alice', true, 'unrelated-tree')
  const unrelatedHarness = admission(fixture.fixture.conversationId, unrelatedTurn.runId)
  await convex.mutation(mutation('harness/runs:admit'), { ...unrelatedHarness, serverSecret: secret })
  const anotherUserTurn = await open(convex, fixture.fixture, 'bob', false, 'another-user')
  await claimAndAttachWorkflow(convex, fixture.parent.runId, fixture.parentTurn.runId, 'parent-workflow')
  await claimAndAttachWorkflow(convex, fixture.childRunId, fixture.targetTurn.runId, 'child-workflow')
  await claimAndAttachWorkflow(convex, grandchild.runId, grandchild.turn.runId, 'grandchild-workflow')
  await claimAndAttachWorkflow(convex, unrelatedHarness.runId, unrelatedTurn.runId, 'unrelated-workflow')

  const beforeCounts = await convex.run(async ctx => Promise.all([
    fixture.parent.runId, fixture.childRunId, grandchild.runId,
  ].map(runId => ctx.db.query('harnessRuns').withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', runId)).unique())))
  expect(beforeCounts.map(run => run?.activeDescendantCount)).toEqual([2, 1, 0])

  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.fixture.conversationId,
    messageId: fixture.parentTurn.messageId,
    userId: 'alice',
    serverSecret: secret,
  })
  expect(cancelled.stoppedCount).toBe(3)
  expect(cancelled.cancelledRunIds).toEqual(expect.arrayContaining([
    fixture.parentTurn.runId, fixture.targetTurn.runId, grandchild.turn.runId,
  ]))
  expect(cancelled.cancelledRunIds).not.toContain(unrelatedTurn.runId)
  expect(cancelled.cancelledRunIds).not.toContain(anotherUserTurn.runId)
  expect(cancelled.cancelledWorkflowRunIds).toEqual(expect.arrayContaining([
    'parent-workflow', 'child-workflow', 'grandchild-workflow',
  ]))
  expect(cancelled.cancelledWorkflows).toEqual(expect.arrayContaining([
    { agentRunId: fixture.parentTurn.runId, workflowRunId: 'parent-workflow' },
    { agentRunId: fixture.targetTurn.runId, workflowRunId: 'child-workflow' },
    { agentRunId: grandchild.turn.runId, workflowRunId: 'grandchild-workflow' },
  ]))
  expect(cancelled.cancelledHarnessRoots).toEqual(expect.arrayContaining([
    { agentRunId: fixture.parentTurn.runId, runId: fixture.parent.runId },
    { agentRunId: fixture.targetTurn.runId, runId: fixture.childRunId },
    { agentRunId: grandchild.turn.runId, runId: grandchild.runId },
  ]))

  const cancelledAgentRuns = await convex.run(ctx => Promise.all([
    fixture.parentTurn.runId, fixture.targetTurn.runId, grandchild.turn.runId,
  ].map(runId => ctx.db.get(runId))))
  expect(cancelledAgentRuns.map(run => run?.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  const cancelledMessages = await convex.run(ctx => Promise.all([
    fixture.parentTurn.messageId, fixture.targetTurn.messageId, grandchild.turn.messageId,
  ].map(messageId => ctx.db.get(messageId))))
  expect(cancelledMessages.map(message => message?.status)).toEqual(['completed', 'completed', 'completed'])
  expect(cancelledMessages.map(message => message?.content)).toEqual([
    expect.stringContaining('This response was interrupted. Should I continue?'),
    expect.stringContaining('This response was interrupted. Should I continue?'),
    expect.stringContaining('This response was interrupted. Should I continue?'),
  ])

  const finalCounts = await convex.run(async ctx => Promise.all([
    fixture.parent.runId, fixture.childRunId, grandchild.runId,
  ].map(runId => ctx.db.query('harnessRuns').withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', runId)).unique())))
  expect(finalCounts.map(run => run?.activeDescendantCount)).toEqual([0, 0, 0])
  const cancelledHarnessStates = await Promise.all([
    fixture.parent.runId, fixture.childRunId, grandchild.runId,
  ].map(runId => convex.query(query('harness/runs:get'), { actorUserId: 'alice', runId, serverSecret: secret })))
  expect(cancelledHarnessStates.map(run => run.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  expect((await convex.run(ctx => ctx.db.get(unrelatedTurn.runId)))?.status).toBe('running')
  expect((await convex.run(ctx => ctx.db.get(anotherUserTurn.runId)))?.status).toBe('queued')
  expect((await convex.query(query('harness/runs:get'), {
    actorUserId: 'alice', runId: unrelatedHarness.runId, serverSecret: secret,
  })).status).toBe('running')
})

test('parent Stop leaves an already-terminal named child untouched', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await namedAdmissionFixture(convex, 'same-room')
  await apply(convex, fixture.parent.runId, fixture.operation)
  await claimAndAttachWorkflow(convex, fixture.parent.runId, fixture.parentTurn.runId, 'parent-workflow')
  await claimAndAttachWorkflow(convex, fixture.childRunId, fixture.targetTurn.runId, 'child-workflow')

  await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.fixture.conversationId,
    messageId: fixture.targetTurn.messageId,
    userId: 'alice',
    serverSecret: secret,
  })
  const childAfterOwnStop = await convex.run(ctx => ctx.db.get(fixture.targetTurn.runId))
  const messageAfterOwnStop = await convex.run(ctx => ctx.db.get(fixture.targetTurn.messageId))
  const harnessChildAfterOwnStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.childRunId))
    .unique())
  expect(childAfterOwnStop?.status).toBe('cancelled')

  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.fixture.conversationId,
    messageId: fixture.parentTurn.messageId,
    userId: 'alice',
    serverSecret: secret,
  })
  expect(cancelled.cancelledRunIds).toEqual([fixture.parentTurn.runId])
  expect(cancelled.cancelledHarnessRoots).toEqual([{ agentRunId: fixture.parentTurn.runId, runId: fixture.parent.runId }])
  expect(await convex.run(ctx => ctx.db.get(fixture.targetTurn.runId))).toEqual(childAfterOwnStop)
  expect(await convex.run(ctx => ctx.db.get(fixture.targetTurn.messageId))).toEqual(messageAfterOwnStop)
  expect(await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.childRunId))
    .unique())).toEqual(harnessChildAfterOwnStop)
  const rootAfterStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.parent.runId))
    .unique())
  expect(rootAfterStop?.activeDescendantCount).toBe(0)
})

test('child Stop cancels an active descendant after its Harness parent is terminal', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await namedAdmissionFixture(convex, 'same-room')
  await apply(convex, fixture.parent.runId, fixture.operation)
  await claimAndAttachWorkflow(convex, fixture.parent.runId, fixture.parentTurn.runId, 'parent-workflow')
  await claimAndAttachWorkflow(convex, fixture.childRunId, fixture.targetTurn.runId, 'child-workflow')
  await apply(convex, fixture.parent.runId, {
    type: 'terminate',
    status: 'cancelled',
    reason: 'Parent was terminated before child cleanup.',
  })

  const parentBeforeStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.parent.runId))
    .unique())
  const childBeforeStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.childRunId))
    .unique())
  expect(JSON.parse(parentBeforeStop!.metadataJson).status).toBe('cancelled')
  expect(parentBeforeStop?.activeDescendantCount).toBe(0)
  expect(JSON.parse(childBeforeStop!.metadataJson).status).toBe('running')

  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.fixture.conversationId,
    messageId: fixture.targetTurn.messageId,
    userId: 'alice',
    serverSecret: secret,
  })

  expect(cancelled.stoppedCount).toBe(1)
  expect(cancelled.cancelledRunIds).toEqual([fixture.targetTurn.runId])
  expect(cancelled.cancelledWorkflowRunIds).toContain('child-workflow')
  expect(cancelled.cancelledWorkflows).toContainEqual({
    agentRunId: fixture.targetTurn.runId,
    workflowRunId: 'child-workflow',
  })
  expect(cancelled.cancelledHarnessRoots).toEqual([{
    agentRunId: fixture.targetTurn.runId,
    runId: fixture.childRunId,
  }])
  const childAfterStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.childRunId))
    .unique())
  const parentAfterStop = await convex.run(ctx => ctx.db.query('harnessRuns')
    .withIndex('by_runId', queryBuilder => queryBuilder.eq('runId', fixture.parent.runId))
    .unique())
  expect(JSON.parse(childAfterStop!.metadataJson).status).toBe('cancelled')
  expect(childAfterStop?.activeDescendantCount).toBe(0)
  expect(parentAfterStop?.activeDescendantCount).toBe(0)
  expect((await convex.run(ctx => ctx.db.get(fixture.targetTurn.runId)))?.status).toBe('cancelled')
  expect((await convex.run(ctx => ctx.db.get(fixture.targetTurn.messageId)))?.content)
    .toContain('This response was interrupted. Should I continue?')
})

test.each(['legacy', 'foreign-actor', 'external-agent', 'archived-agent', 'wrong-principal', 'removed-agent', 'removed-invoker', 'foreign-message'])
  ('native admission rejects %s without leaving a root', async scenario => {
    const convex = convexTest(schema, modules)
    const fixture = await seed(convex)
    const turn = await open(convex, fixture, 'alice', scenario !== 'legacy')
    const input = admission(fixture.conversationId, turn.runId)
    await convex.run(async ctx => {
      if (scenario === 'foreign-actor') await ctx.db.patch(turn.runId, { userId: 'bob' })
      if (scenario === 'external-agent') await ctx.db.patch(fixture.agentId, { harness: 'codex' })
      if (scenario === 'archived-agent') await ctx.db.patch(fixture.agentId, { archivedAt: Date.now() })
      if (scenario === 'wrong-principal') await ctx.db.patch(fixture.agentId, { principalId: 'different-principal' })
      if (scenario === 'removed-agent' || scenario === 'removed-invoker') {
        const principalId = scenario === 'removed-agent' ? 'agent-principal' : 'alice'
        await ctx.db.patch(ctx.db.normalizeId('conversationParticipants', fixture.participants[principalId]!)!, { status: 'removed' })
      }
      if (scenario === 'foreign-message') await ctx.db.patch(turn.messageId, { authorPrincipalId: 'different-principal' })
    })
    await expect(convex.mutation(mutation('harness/runs:admit'), { ...input, serverSecret: secret })).rejects.toThrow()
    const rows = await convex.run(ctx => ctx.db.query('harnessRuns').collect())
    expect(rows).toHaveLength(0)
    expect((await convex.run(ctx => ctx.db.get(turn.runId)))?.harnessRunId).toBeUndefined()
    if (scenario === 'legacy') {
      expect((await open(convex, fixture)).resumed).toBe(true)
      expect((await convex.run(ctx => ctx.db.get(turn.runId)))?.executionEngine).toBeUndefined()
    }
  })

test('room Stop fences the invoker root and child even after agent revocation, without stopping another invoker', async () => {
  const convex = convexTest(schema, modules)
  const fixture = await seed(convex)
  const turn = await open(convex, fixture)
  const other = await open(convex, fixture, 'bob', false)
  const input = admission(fixture.conversationId, turn.runId)
  await convex.mutation(mutation('harness/runs:admit'), { ...input, serverSecret: secret })
  await apply(convex, input.runId, { type: 'claim_execution', workflowRunId: 'root-workflow' })
  await apply(convex, input.runId, { type: 'replace_plan', steps: [{ id: 'read', title: 'Read', dependsOn: [],
    acceptanceCriteria: ['Read the record'], requiresVerification: false }] })
  await apply(convex, input.runId, { type: 'admit_child', goal: 'Read', constraints: [], child: {
    id: 'child', stepId: 'read', allowedToolIds: [], maxCostMicros: 0, costMicros: 0, status: 'running', evidenceRefs: [],
  } })
  await apply(convex, 'child', { type: 'claim_execution', workflowRunId: 'child-workflow' })
  await convex.run(ctx => ctx.db.patch(fixture.agentId, { archivedAt: Date.now() }))
  const cancelled = await convex.mutation(mutation('chat/conversations:cancelAgentRuns'), {
    conversationId: fixture.conversationId, userId: 'alice', serverSecret: secret,
  })
  expect(cancelled.cancelledHarnessRoots).toEqual([{ agentRunId: turn.runId, runId: input.runId }])
  expect((await convex.run(ctx => ctx.db.get(other.runId)))?.status).toBe('queued')
  const child = await convex.query(query('harness/runs:get'), { actorUserId: 'alice', runId: 'child', serverSecret: secret })
  expect(child.status).toBe('cancelled')
  const workflows = await convex.query(query('harness/runs:listDeliveryWorkflowRuns'), {
    actorUserId: 'alice', agentRunId: turn.runId, rootRunId: input.runId, cursor: null, serverSecret: secret,
  })
  expect(workflows.workflowRunIds).toEqual(expect.arrayContaining(['root-workflow', 'child-workflow']))
  await expect(convex.query(query('harness/runs:listDeliveryWorkflowRuns'), {
    actorUserId: 'bob', agentRunId: turn.runId, rootRunId: input.runId, cursor: null, serverSecret: secret,
  })).rejects.toThrow()
})
