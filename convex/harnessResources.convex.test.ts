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
  return await convex.mutation(makeFunctionReference<'mutation'>('harness/runs:apply'), {
    actorUserId: 'alice', runId: input.runId, operationId: `op-${expectedRevision}-${String(operation.type)}`,
    expectedRevision, operation, serverSecret: secret,
  }) as { snapshot: HarnessSnapshot }
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

test('an eligible personal root pauses, grants once, and consumes after an unresolved receipt settles', async () => {
  const convex = convexTest(schema, modules)
  const { conversationId, deliveryId, membershipId, accountId } = await seedEligibleAuthority(convex)
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
  await convex.run(ctx => ctx.db.patch(accountId, { workspaceId: 'personal-alice' }))
  await expect(convex.mutation(grant, {
    ...grantArgs, grant: { kind: 'model_spend', newMaxCostMicros: 1_050 },
  })).rejects.toThrow('cover current commitments')
  const receipt = await convex.mutation(grant, grantArgs)
  expect(receipt).toMatchObject({ policyRevisionBefore: 0, policyRevisionAfter: 1, maxCostMicros: 2_000 })
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
