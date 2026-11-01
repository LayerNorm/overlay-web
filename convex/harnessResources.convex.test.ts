import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { HarnessAdmission } from '../packages/overlay-agent-runtime/src/harness-store'
import type { HarnessSnapshot } from '../packages/overlay-agent-runtime/src/harness-state'
import { ensureWorkspaceBillingAccount } from './billing/accountModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'harness-storage-test-secret'
const admit = makeFunctionReference<'mutation'>('harness/runs:admit')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function seedConversation(convex: ReturnType<typeof convexTest>, workspaceId?: string) {
  const now = Date.now()
  return await convex.run(ctx => ctx.db.insert('conversations', {
    userId: 'alice', title: 'Resource pause source', lastModified: now, createdAt: now, updatedAt: now,
    ...(workspaceId ? { workspaceId, conversationType: 'personal' as const } : {}),
    lastMode: 'act', askModelIds: ['fixture/model'], actModelId: 'fixture/model',
  }))
}

function resourceAdmission(conversationId: string, version?: 1): HarnessAdmission {
  return {
    runId: `resource-${conversationId}`,
    goal: 'Continue the work.',
    constraints: [],
    policy: {
      actorUserId: 'alice', workspaceId: 'personal-alice', allowedToolIds: [],
      requiresPlan: false, deadlineAt: Date.now() + 60_000, maxCostMicros: 1_000,
      maxParallelChildren: 0, maxDepth: 0, ...(version ? { resourcePauseVersion: version } : {}),
    },
    source: { conversationId },
    ...(version ? { deliveryAgentRunId: 'resource-delivery' } : {}),
    resourcePauseAuthority: 'personal_chat_work',
  }
}

async function seedEligibleAuthority(convex: ReturnType<typeof convexTest>) {
  const now = Date.now()
  const { membershipId, accountId } = await convex.run(async ctx => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'personal-alice', kind: 'personal', name: 'Personal', slug: 'personal-alice',
      status: 'active', personalOwnerUserId: 'alice', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'personal-alice-principal', workspaceId: 'personal-alice', type: 'human', userId: 'alice',
      displayName: 'Alice', createdAt: now, updatedAt: now,
    })
    const membershipId = await ctx.db.insert('workspaceMemberships', {
      membershipId: 'personal-alice-membership', workspaceId: 'personal-alice',
      principalId: 'personal-alice-principal', role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceUserPreferences', {
      userId: 'alice', activeWorkspaceId: 'personal-alice', updatedAt: now,
    })
    const account = await ensureWorkspaceBillingAccount(ctx, { primaryBillingContactUserId: 'alice', workspaceId: 'personal-alice' })
    return { membershipId, accountId: account._id }
  })
  const conversationId = await seedConversation(convex, 'personal-alice')
  const deliveryId = await convex.run(async ctx => {
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: conversationId as never, userId: 'alice', turnId: 'resource-turn', role: 'user',
      mode: 'act', content: 'Run the harness.', contentType: 'text', createdAt: now,
    })
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: conversationId as never, userId: 'alice', turnId: 'resource-turn', role: 'assistant',
      mode: 'act', content: '', contentType: 'text', parts: [{ type: 'text', text: '' }],
      status: 'generating', createdAt: now, updatedAt: now,
    })
    return await ctx.db.insert('conversationAgentRuns', {
      conversationId: conversationId as never, turnId: 'resource-turn', userId: 'alice', userMessageId,
      assistantMessageId, mode: 'work', runner: 'workflow', executionEngine: 'overlay_harness',
      status: 'queued', createdAt: now, updatedAt: now,
    })
  })
  return { conversationId, deliveryId, membershipId, accountId }
}

async function resourceApply(
  convex: ReturnType<typeof convexTest>,
  input: HarnessAdmission,
  workflowRunId: string,
  expectedRevision: number,
  operation: Record<string, unknown>,
) {
  const result = await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:apply'), {
    actorUserId: 'alice', runId: input.runId, operationId: `op-${expectedRevision}-${String(operation.type)}`,
    expectedRevision, operation, serverSecret: secret,
  }) as { snapshot: HarnessSnapshot }
  if (operation.type === 'claim_execution') {
    await convex.mutation(makeFunctionReference<'mutation'>('chat/conversations:attachAgentRunWorkflow'), {
      runId: input.deliveryAgentRunId as never,
      userId: 'alice',
      workflowRunId,
      serverSecret: secret,
    })
  }
  return result
}

test('unversioned admissions cannot smuggle the resource authority marker', async () => {
  const convex = convexTest(schema, modules)
  const conversationId = await seedConversation(convex)
  await expect(convex.mutation(admit, { ...resourceAdmission(conversationId), serverSecret: secret }))
    .rejects.toThrow('Resource-pause admission authority requires version 1')
})

test('version-one admissions reject a source without an owned active personal workspace', async () => {
  const convex = convexTest(schema, modules)
  const conversationId = await seedConversation(convex)
  await expect(convex.mutation(admit, { ...resourceAdmission(conversationId, 1), serverSecret: secret }))
    .rejects.toThrow('HARNESS_RESOURCE_WORKSPACE_DENIED')
})

test.each(['child_depth', 'child_slots', 'room', 'automation', 'surface', 'workspace'] as const)('version-one admission rejects unsupported %s before persisting a run', async scope => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  if (scope === 'child_depth') input.policy.maxDepth = 1
  if (scope === 'child_slots') input.policy.maxParallelChildren = 1
  if (scope === 'room') await convex.run(async ctx => {
    await ctx.db.patch(conversationId, { conversationType: 'channel' })
    await ctx.db.patch(deliveryId, { mode: 'room' })
  })
  if (scope === 'automation') await convex.run(ctx => ctx.db.patch(conversationId, { isAutomation: true }))
  if (scope === 'surface') await convex.run(ctx => ctx.db.patch(conversationId, { surfaceBindingId: 'surface-binding' }))
  if (scope === 'workspace') await convex.run(ctx => ctx.db.patch(conversationId, { workspaceId: undefined }))
  await expect(convex.mutation(admit, { ...input, serverSecret: secret })).rejects.toThrow(
    ['room', 'automation', 'surface', 'workspace'].includes(scope)
      ? 'HARNESS_RESOURCE_ADMISSION_DENIED' : 'Resource-pause admission is limited',
  )
  expect(await convex.run(ctx => ctx.db.query('harnessRuns').collect())).toEqual([])
  expect(await convex.run(ctx => ctx.db.query('harnessResourceRequests').collect())).toEqual([])
})

test('an ordinary unversioned root cannot opt into resource waits after admission', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId), deliveryAgentRunId: deliveryId, resourcePauseAuthority: undefined }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  const deliveryTransition = makeFunctionReference<'mutation'>('chat/conversations:transitionAgentRun')
  await expect(convex.mutation(deliveryTransition, {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: 'resource-workflow',
    status: 'waiting_for_resources', serverSecret: secret,
  })).rejects.toThrow('Resource pauses may only be changed by resource mutations.')
  await expect(convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', expectedRevision: state.revision,
    token: 'resource-unversioned', reason: 'model_spend', requiredCostMicros: 1_001, serverSecret: secret,
  })).rejects.toThrow('HARNESS_RESOURCE_NOT_AUTHORIZED')
  expect(await convex.run(ctx => ctx.db.query('harnessResourceRequests').collect())).toEqual([])
})

test.each(['input', 'approval', 'stuck'] as const)('resource authorization restores a suspended %s wait without answering or replacing it', async kind => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  const reference = { actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', serverSecret: secret }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, reference.workflowRunId, state.revision, {
    type: 'claim_execution', workflowRunId: reference.workflowRunId,
  })).snapshot
  const blocker = { kind, question: 'Review the next action.' }
  state = (await resourceApply(convex, input, reference.workflowRunId, state.revision, { type: 'block', blocker })).snapshot
  const requestKind = kind === 'approval' ? 'approval' as const : 'input' as const
  const requestedAt = Date.now()
  const inputRequest = { token: 'ordinary-wait', requestedAt, question: blocker.question }
  const approval = {
    token: 'ordinary-wait', requestedAt, title: 'Review the next action.',
    requests: [{ approvalId: 'approval:one', toolCallId: 'tool:one', toolName: 'read', input: { path: '/tmp/report.txt' } }],
  }
  const deliveryStatus = requestKind === 'approval' ? 'waiting_for_approval' as const : 'waiting_for_input' as const
  const deliveryTransition = makeFunctionReference<'mutation'>('chat/conversations:transitionAgentRun')
  await convex.mutation(deliveryTransition, {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: reference.workflowRunId,
    status: 'running', serverSecret: secret,
  })
  await convex.mutation(deliveryTransition, {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: reference.workflowRunId,
    status: deliveryStatus,
    ...(requestKind === 'approval' ? { approval } : { inputRequest }),
    serverSecret: secret,
  })
  const request = requestKind === 'input'
    ? { kind: 'input' as const, token: inputRequest.token }
    : { kind: 'approval' as const, token: approval.token, requests: approval.requests }
  const wait = await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:publishWait'), { ...reference, request })
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    ...reference, expectedRevision: state.revision, token: 'resource-suspended', reason: 'model_spend', requiredCostMicros: 1_001,
  })
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:grantResources'), {
    ...reference, workspaceId: 'personal-alice', token: 'resource-suspended', policyRevision: 0,
    grant: { kind: 'model_spend', newMaxCostMicros: 2_000 },
  })
  const paused = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: reference.actorUserId, runId: reference.runId, serverSecret: secret,
  }) as HarnessSnapshot
  expect(paused.status).toBe('waiting_for_resources')
  const pausedDelivery = await convex.run(ctx => ctx.db.get(deliveryId))
  expect(pausedDelivery?.resourceRequest).toMatchObject({ request: { token: 'resource-suspended' } })
  if (requestKind === 'approval') expect(pausedDelivery?.approval).toEqual(approval)
  else expect(pausedDelivery?.inputRequest).toEqual(inputRequest)
  for (const operation of [{ type: 'resume' }, { type: 'block', blocker }]) {
    await expect(resourceApply(convex, input, reference.workflowRunId, paused.revision, operation)).rejects.toThrow('A resource pause must be consumed')
  }
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:consumeResourceGrant'), {
    ...reference, token: 'resource-suspended',
  })
  const restored = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: reference.actorUserId, runId: reference.runId, serverSecret: secret,
  }) as HarnessSnapshot
  const restoredDelivery = await convex.run(ctx => ctx.db.get(deliveryId))
  expect(restored).toMatchObject({
    status: kind === 'stuck' ? 'waiting_for_input' : `waiting_for_${kind}`,
    blocker, workflowRunId: reference.workflowRunId,
  })
  expect(restored.resourceRequestToken).toBeUndefined()
  expect(restoredDelivery?.status).toBe(deliveryStatus)
  expect(restoredDelivery?.resourceRequest).toBeUndefined()
  if (requestKind === 'approval') expect(restoredDelivery?.approval).toEqual(approval)
  else expect(restoredDelivery?.inputRequest).toEqual(inputRequest)
  expect(await convex.query(makeFunctionReference<'query'>('harness/runs:listPendingWaits'), reference)).toEqual([wait])
  expect(restored.progressRevision).toBe(state.progressRevision)
})

test('pending consume projects reservation settlement without subscription churn', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'reserve_model', id: 'model:pending', maxCostMicros: 500,
  })).snapshot
  const reference = { actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', serverSecret: secret }
  const token = 'resource-awaiting-receipt'
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    ...reference, expectedRevision: state.revision, token, reason: 'model_spend', requiredCostMicros: 600,
  })
  let delivery = await convex.run(ctx => ctx.db.get(deliveryId))
  expect(delivery).toMatchObject({ resourceRequest: { request: { token }, awaitingReceipt: true } })
  const pausedState = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  await resourceApply(convex, input, 'resource-workflow', pausedState.revision, {
    type: 'record_receipt',
    receipt: { id: 'model:pending', modelId: 'fixture/model', provider: 'fixture', inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000, costMicros: 1 },
  })
  const consumeArgs = { ...reference, token }
  expect(await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:consumeResourceGrant'), consumeArgs))
    .toEqual({ status: 'pending' })
  delivery = await convex.run(ctx => ctx.db.get(deliveryId))
  expect(delivery).toMatchObject({
    status: 'waiting_for_resources',
    resourceRequest: { request: { token }, awaitingReceipt: false },
  })
  const projectedAt = delivery?.updatedAt
  expect(await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:consumeResourceGrant'), consumeArgs))
    .toEqual({ status: 'pending' })
  expect((await convex.run(ctx => ctx.db.get(deliveryId)))?.updatedAt).toBe(projectedAt)
})

test('an eligible personal root pauses, grants once, and consumes after an unresolved receipt settles', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId, membershipId, accountId } = await seedEligibleAuthority(convex)
  const deliveryTransition = makeFunctionReference<'mutation'>('chat/conversations:transitionAgentRun')
  const input = {
    ...resourceAdmission(conversationId, 1),
    deliveryAgentRunId: deliveryId,
  }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'record_evidence',
    evidence: { id: 'saved-evidence', kind: 'tool_result', summary: 'Observed a source result.', source: 'tool:read',
      verdict: 'observed', createdAt: Date.now() },
  })).snapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'reserve_model', id: 'model:pending', maxCostMicros: 500,
  })).snapshot
  const pauseArgs = {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', expectedRevision: state.revision,
    token: 'resource-token', reason: 'model_spend' as const, requiredCostMicros: 600, serverSecret: secret,
  }
  const pause = makeFunctionReference<'mutation'>('harness/runs:pauseForResources')
  const request = await convex.mutation(pause, pauseArgs)
  expect(request).toMatchObject({ state: 'pending', wakePending: false })
  expect(await convex.run(ctx => ctx.db.get(deliveryId))).toMatchObject({
    status: 'waiting_for_resources',
    resourceRequest: { request: { token: 'resource-token' }, awaitingReceipt: true },
  })
  await expect(convex.mutation(deliveryTransition, {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: 'resource-workflow',
    status: 'running', serverSecret: secret,
  })).rejects.toThrow('Resource pauses may only be changed by resource mutations.')
  await expect(convex.mutation(deliveryTransition, {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: 'resource-workflow',
    status: 'completed', serverSecret: secret,
  })).rejects.toThrow('Resource pauses may only be changed by resource mutations.')
  await expect(convex.mutation(makeFunctionReference<'mutation'>('chat/conversations:completeAgentRun'), {
    runId: deliveryId, userId: 'alice', content: '', parts: [], tokens: { input: 0, output: 0 }, serverSecret: secret,
  })).rejects.toThrow('Invalid AgentRun transition: waiting_for_resources -> completed')
  expect(await convex.mutation(pause, pauseArgs)).toEqual(request)
  await expect(convex.mutation(pause, { ...pauseArgs, requiredCostMicros: 601 }))
    .rejects.toThrow('HARNESS_RESOURCE_TOKEN_CONFLICT')
  expect((await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot).status).toBe('waiting_for_resources')
  const grant = makeFunctionReference<'mutation'>('harness/runs:grantResources')
  const grantArgs = {
    actorUserId: 'alice', workspaceId: 'personal-alice', runId: input.runId,
    workflowRunId: 'resource-workflow', token: 'resource-token', policyRevision: 0,
    grant: { kind: 'model_spend' as const, newMaxCostMicros: 2_000 }, serverSecret: secret,
  }
  await expect(convex.mutation(grant, { ...grantArgs, actorUserId: 'another-user' }))
    .rejects.toThrow('HARNESS_ACCESS_DENIED')
  await expect(convex.mutation(grant, { ...grantArgs, policyRevision: 1 }))
    .rejects.toThrow('HARNESS_RESOURCE_STALE')
  await convex.run(ctx => ctx.db.patch(membershipId, { status: 'suspended' }))
  await expect(convex.mutation(grant, grantArgs)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await convex.run(ctx => ctx.db.patch(membershipId, { status: 'active' }))
  await convex.run(ctx => ctx.db.patch(accountId, { workspaceId: 'different-payer-workspace' }))
  await expect(convex.mutation(grant, grantArgs)).rejects.toThrow('HARNESS_RESOURCE_PAYER_DENIED')
  const deniedSnapshot = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  expect(deniedSnapshot).toMatchObject({ status: 'waiting_for_resources', policyRevision: 0 })
  const revokedRequest = await convex.query(makeFunctionReference<'query'>('harness/runs:getResourceRequest'), {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', token: 'resource-token',
    serverSecret: secret,
  })
  expect(revokedRequest?.state).toBe('pending')
  expect(revokedRequest?.receipt).toBeUndefined()
  await convex.run(ctx => ctx.db.patch(accountId, { workspaceId: 'personal-alice' }))
  await expect(convex.mutation(grant, {
    ...grantArgs, grant: { kind: 'model_spend', newMaxCostMicros: 1_050 },
  })).rejects.toThrow('cover current commitments')
  const receipt = await convex.mutation(grant, grantArgs)
  expect(receipt).toMatchObject({ policyRevisionBefore: 0, policyRevisionAfter: 1, maxCostMicros: 2_000 })
  expect(await convex.run(ctx => ctx.db.get(deliveryId))).toMatchObject({
    status: 'waiting_for_resources',
    resourceRequest: { receipt, awaitingReceipt: true },
  })
  expect(await convex.mutation(grant, grantArgs)).toEqual(receipt)
  await expect(convex.mutation(grant, { ...grantArgs, grant: { kind: 'model_spend', newMaxCostMicros: 3_000 } }))
    .rejects.toThrow('HARNESS_RESOURCE_GRANT_CONFLICT')
  const consume = makeFunctionReference<'mutation'>('harness/runs:consumeResourceGrant')
  const consumeArgs = { actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow',
    token: 'resource-token', serverSecret: secret }
  expect(await convex.mutation(consume, consumeArgs)).toMatchObject({ status: 'pending', reason: 'awaiting_receipt' })
  const loaded = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  const receiptState = await resourceApply(convex, input, 'resource-workflow', loaded.revision, {
    type: 'record_receipt',
    receipt: { id: 'model:pending', modelId: 'fixture/model', provider: 'fixture', inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 32_000, costMicros: 1 },
  })
  expect(await convex.mutation(consume, consumeArgs)).toMatchObject({ status: 'consumed', request: { wakePending: false } })
  const consumedDelivery = await convex.run(ctx => ctx.db.get(deliveryId))
  expect(consumedDelivery?.status).toBe('running')
  expect(consumedDelivery?.resourceRequest).toBeUndefined()
  expect(await convex.mutation(consume, consumeArgs)).toMatchObject({ status: 'consumed' })
  const final = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  expect(final).toMatchObject({ runId: input.runId, status: 'running', policy: { maxCostMicros: 2_000 }, evidence: [{ id: 'saved-evidence' }] })
  expect(final.revision).toBeGreaterThan(receiptState.snapshot.revision)
  const nextPause = await convex.mutation(pause, {
    ...pauseArgs, expectedRevision: final.revision, token: 'resource-token-after-consume', requiredCostMicros: 3_000,
  })
  expect(nextPause).toMatchObject({ state: 'pending' })
  const pausedAgain = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  const cancelled = await resourceApply(convex, input, 'resource-workflow', pausedAgain.revision, {
    type: 'terminate', status: 'cancelled', reason: 'Cancellation safety fixture.',
  })
  await expect(convex.mutation(grant, {
    ...grantArgs, token: 'resource-token-after-consume', policyRevision: 1,
    grant: { kind: 'model_spend', newMaxCostMicros: 4_000 },
  })).rejects.toThrow('HARNESS_RESOURCE_NOT_AUTHORIZED')
  const cancelledState = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  expect(cancelledState).toMatchObject({ status: 'cancelled', policy: { maxCostMicros: 2_000 }, policyRevision: 1 })
  expect(cancelled.snapshot.status).toBe('cancelled')
})

test.each(['workflow', 'terminal', 'automation', 'surface', 'workspace'] as const)('resource authority rejects changed delivery/source %s without creating a request', async kind => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  if (kind === 'workflow') {
    await convex.run(ctx => ctx.db.patch(deliveryId, { workflowRunId: 'other-workflow' }))
  } else if (kind === 'terminal') {
    await convex.run(ctx => ctx.db.patch(deliveryId, { status: 'failed' }))
  } else {
    await convex.run(ctx => ctx.db.patch(conversationId, kind === 'automation'
      ? { isAutomation: true }
      : kind === 'surface' ? { surfaceBindingId: 'surface-binding' } : { workspaceId: undefined }))
  }
  await expect(convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', expectedRevision: state.revision,
    token: `resource-${kind}`, reason: 'model_spend', requiredCostMicros: 1_001, serverSecret: secret,
  })).rejects.toThrow(kind === 'workspace' ? 'CONVERSATION_ACCESS_DENIED' : 'HARNESS_RESOURCE_SOURCE_DENIED')
  expect(await convex.run(ctx => ctx.db.query('harnessResourceRequests').collect())).toEqual([])
})

test('grant callback rejects terminal delivery without changing policy or receipt', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  const token = 'terminal-delivery-grant'
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', expectedRevision: state.revision,
    token, reason: 'model_spend', requiredCostMicros: 1_001, serverSecret: secret,
  })
  await convex.mutation(makeFunctionReference<'mutation'>('chat/conversations:transitionAgentRun'), {
    runId: deliveryId, userId: 'alice', expectedWorkflowRunId: 'resource-workflow',
    status: 'failed', serverSecret: secret,
  })
  expect((await convex.run(ctx => ctx.db.get(deliveryId)))?.resourceRequest).toBeUndefined()
  await expect(convex.mutation(makeFunctionReference<'mutation'>('harness/runs:grantResources'), {
    actorUserId: 'alice', workspaceId: 'personal-alice', runId: input.runId, workflowRunId: 'resource-workflow',
    token, policyRevision: 0, grant: { kind: 'model_spend', newMaxCostMicros: 2_000 }, serverSecret: secret,
  })).rejects.toThrow('HARNESS_RESOURCE_SOURCE_DENIED')
  const snapshot = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  expect(snapshot).toMatchObject({ status: 'waiting_for_resources', policyRevision: 0 })
  const ungrantedRequest = await convex.query(makeFunctionReference<'query'>('harness/runs:getResourceRequest'), {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', token, serverSecret: secret,
  })
  expect(ungrantedRequest?.state).toBe('pending')
  expect(ungrantedRequest?.receipt).toBeUndefined()
})

test('grant and consume reject a changed delivery workflow without committing resource state', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId } = await seedEligibleAuthority(convex)
  const input = { ...resourceAdmission(conversationId, 1), deliveryAgentRunId: deliveryId }
  let state = await convex.mutation(admit, { ...input, serverSecret: secret }) as HarnessSnapshot
  state = (await resourceApply(convex, input, 'resource-workflow', state.revision, {
    type: 'claim_execution', workflowRunId: 'resource-workflow',
  })).snapshot
  const token = 'changed-delivery-workflow'
  const reference = {
    actorUserId: 'alice', runId: input.runId, workflowRunId: 'resource-workflow', token, serverSecret: secret,
  }
  await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:pauseForResources'), {
    ...reference, expectedRevision: state.revision, reason: 'model_spend', requiredCostMicros: 1_001,
  })
  const beforeSnapshot = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  const beforeDelivery = await convex.run(ctx => ctx.db.get(deliveryId))
  const beforeRequest = await convex.run(ctx => ctx.db.query('harnessResourceRequests')
    .withIndex('by_token', q => q.eq('token', token)).unique())
  await convex.run(ctx => ctx.db.patch(deliveryId, { workflowRunId: 'other-workflow' }))
  await expect(convex.mutation(makeFunctionReference<'mutation'>('harness/runs:grantResources'), {
    actorUserId: 'alice', workspaceId: 'personal-alice', ...reference, policyRevision: 0,
    grant: { kind: 'model_spend', newMaxCostMicros: 2_000 },
  })).rejects.toThrow('HARNESS_RESOURCE_SOURCE_DENIED')
  await expect(convex.mutation(makeFunctionReference<'mutation'>('harness/runs:consumeResourceGrant'), reference))
    .rejects.toThrow('HARNESS_RESOURCE_SOURCE_DENIED')
  const afterSnapshot = await convex.query(makeFunctionReference<'query'>('harness/runs:get'), {
    actorUserId: 'alice', runId: input.runId, serverSecret: secret,
  }) as HarnessSnapshot
  const afterDelivery = await convex.run(ctx => ctx.db.get(deliveryId))
  const afterRequest = await convex.run(ctx => ctx.db.query('harnessResourceRequests')
    .withIndex('by_token', q => q.eq('token', token)).unique())
  expect(afterSnapshot).toMatchObject({
    status: beforeSnapshot.status, revision: beforeSnapshot.revision, policy: beforeSnapshot.policy,
    policyRevision: beforeSnapshot.policyRevision, resourceRequestToken: token,
  })
  expect(afterDelivery?.status).toBe(beforeDelivery?.status)
  expect(afterDelivery?.workflowRunId).toBe('other-workflow')
  expect(afterDelivery?.resourceRequest).toEqual(beforeDelivery?.resourceRequest)
  expect(afterDelivery?.updatedAt).toBe(beforeDelivery?.updatedAt)
  expect(afterRequest).toEqual(beforeRequest)
  expect(afterRequest).toMatchObject({ state: 'pending', wakePending: false })
  expect(afterRequest?.receiptJson).toBeUndefined()
})
