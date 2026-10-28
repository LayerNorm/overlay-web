import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import type {
  HarnessAdmission,
  HarnessMutationResult,
  HarnessOperation,
} from '../packages/overlay-agent-runtime/src/harness-store'
import type { HarnessSnapshot } from '../packages/overlay-agent-runtime/src/harness-state'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'harness-storage-test-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) => makeFunctionReference<'mutation'>(`harness/runs:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`harness/runs:${name}`)
type Convex = ReturnType<typeof convexTest>

async function seedConversation(convex: Convex, userId = 'alice', workspaceId?: string) {
  const now = Date.now()
  return await convex.run(ctx => ctx.db.insert('conversations', {
    userId,
    ...(workspaceId ? { workspaceId, conversationType: 'personal' as const } : {}),
    title: 'Harness source',
    lastModified: now,
    createdAt: now,
    updatedAt: now,
    lastMode: 'act',
    askModelIds: ['fixture/model'],
    actModelId: 'fixture/model',
  }))
}

function admission(runId: string, conversationId: string, overrides: Partial<HarnessAdmission['policy']> = {}): HarnessAdmission {
  return {
    runId,
    goal: 'Complete the requested work.',
    constraints: ['Preserve the source scope.'],
    policy: {
      actorUserId: 'alice',
      allowedToolIds: ['tool:read', 'tool:write'],
      requiresPlan: true,
      deadlineAt: Date.now() + 60_000,
      maxCostMicros: 1_000,
      maxParallelChildren: 2,
      maxDepth: 2,
      ...overrides,
    },
    source: { conversationId },
  }
}

async function admit(convex: Convex, input: HarnessAdmission, serverSecret = secret) {
  return await convex.mutation(mutation('admit'), { ...input, serverSecret }) as HarnessSnapshot
}

async function apply(
  convex: Convex,
  input: HarnessAdmission,
  operationId: string,
  expectedRevision: number,
  operation: HarnessOperation,
  actorUserId = input.policy.actorUserId,
  serverSecret = secret,
) {
  return await convex.mutation(mutation('apply'), {
    actorUserId,
    runId: input.runId,
    operationId,
    expectedRevision,
    operation,
    serverSecret,
  }) as HarnessMutationResult
}

async function get(convex: Convex, runId: string, actorUserId = 'alice', serverSecret = secret) {
  return await convex.query(query('get'), { actorUserId, runId, serverSecret }) as HarnessSnapshot | null
}

function oneStep(id: string, requiresVerification = false) {
  return [{
    id,
    title: `Complete ${id}`,
    dependsOn: [],
    acceptanceCriteria: ['The milestone is complete.'],
    requiresVerification,
  }]
}

describe('durable harness runs', () => {
  test.each(['budget', 'model_unavailable', 'route_capacity'] as const)('persists a zero-usage %s rejection through the mutation boundary', async rejectionReason => {
    const convex = convexTest(schema, modules)
    const input = admission('rejection', await seedConversation(convex))
    await admit(convex, input)
    let state = (await apply(convex, input, 'reserve', 0, { type: 'reserve_model', id: 'model:0', maxCostMicros: 600 })).snapshot
    if (rejectionReason !== 'budget') {
      state = (await apply(convex, input, 'dispatch', state.revision, { type: 'bind_model_dispatch', id: 'model:0',
        modelId: 'openrouter/free', billingReservationId: 'billing-reservation' })).snapshot
    }
    const receipt = { id: 'model:0', modelId: 'openrouter/free', provider: 'overlay-free-router',
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: null, costMicros: 0, costSource: 'catalog' as const, rejectionReason }
    await expect(apply(convex, input, 'invalid-rejection', state.revision, {
      type: 'record_receipt', receipt: { ...receipt, inputTokens: 1 },
    })).rejects.toThrow(/confirmed zero usage and cost/i)
    expect((await get(convex, input.runId))?.modelReservation).toEqual(state.modelReservation)
    const settled = await apply(convex, input, 'reject', state.revision, { type: 'record_receipt', receipt })
    expect(settled.snapshot.modelReservation).toBeUndefined()
    const reloaded = await get(convex, input.runId)
    expect(reloaded?.latestReceipt).toEqual(receipt)
    expect(reloaded?.usage.costMicros).toBe(0)
    expect(reloaded?.status).toBe('running')
    const replay = await apply(convex, input, 'reject', state.revision, { type: 'record_receipt', receipt })
    expect(replay.applied).toBe(false)
    expect(replay.snapshot.latestReceipt).toEqual(receipt)
  })

  test.each([
    { parentRequiresPlan: true, parentToolIds: ['write_file'], childToolIds: ['write_file'], requiresPlan: true },
    { parentRequiresPlan: true, parentToolIds: ['read_file', 'write_file'], childToolIds: ['read_file'], requiresPlan: false },
    { parentRequiresPlan: false, parentToolIds: ['write_file'], childToolIds: ['write_file'], requiresPlan: false },
  ])('children derive plan policy from native ancestry and their own tools: $childToolIds', async ({
    parentRequiresPlan, parentToolIds, childToolIds, requiresPlan,
  }) => {
    const convex = convexTest(schema, modules)
    const input = admission('planning-parent', await seedConversation(convex), {
      requiresPlan: parentRequiresPlan,
      allowedToolIds: parentToolIds,
    })
    await admit(convex, input)
    const planned = await apply(convex, input, 'plan', 0, { type: 'replace_plan', steps: oneStep('delegated') })
    await apply(convex, input, 'delegate', planned.snapshot.revision, {
      type: 'admit_child', child: { id: 'planning-child', stepId: 'delegated', allowedToolIds: childToolIds,
        maxCostMicros: 0, costMicros: 0, status: 'running', evidenceRefs: [] },
      goal: 'Return a short answer.', constraints: [],
    })
    const child = await get(convex, 'planning-child')
    expect(child?.policy.requiresPlan).toBe(requiresPlan)
    const finish = apply(convex, { ...input, runId: 'planning-child' }, 'finish', child!.revision,
      { type: 'finish', resultSummary: 'A short answer.' })
    if (requiresPlan) await expect(finish).rejects.toThrow(/plan is required/)
    else expect((await finish).snapshot.status).toBe('completed')
  })

  test('persists billing dispatch ownership for settlement after cancellation', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('dispatch', await seedConversation(convex))
    await admit(convex, input)
    const reserved = await apply(convex, input, 'reserve', 0, { type: 'reserve_model', id: 'receipt', maxCostMicros: 600 })
    const operation = { type: 'bind_model_dispatch' as const, id: 'receipt', modelId: 'fixture/model', billingReservationId: 'billing-reservation' }
    const bound = await apply(convex, input, 'dispatch', reserved.snapshot.revision, operation)
    expect((await get(convex, input.runId))?.modelReservation?.dispatch).toEqual({ modelId: 'fixture/model', billingReservationId: 'billing-reservation' })
    expect((await apply(convex, input, 'dispatch', reserved.snapshot.revision, operation)).applied).toBe(false)
    await expect(apply(convex, input, 'rebind', bound.snapshot.revision, { ...operation, billingReservationId: 'other' })).rejects.toThrow(/cannot change/)
    const cancelled = await apply(convex, input, 'cancel', bound.snapshot.revision, { type: 'terminate', status: 'cancelled', reason: 'User stopped.' })
    expect(cancelled.snapshot.modelReservation?.dispatch?.billingReservationId).toBe('billing-reservation')
    const settled = await apply(convex, input, 'settle', cancelled.snapshot.revision, { type: 'record_receipt', receipt: {
      id: 'receipt', modelId: 'fixture/model', provider: 'fixture', inputTokens: 10, outputTokens: 1, reasoningTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 500,
    } })
    expect(settled.snapshot.modelReservation).toBeUndefined()
    expect(settled.snapshot.status).toBe('cancelled')
  })
  test('persists in-flight model reservations and replaces them with late receipts after cancellation', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('reserved-model', await seedConversation(convex))
    await admit(convex, input)
    const plan = await apply(convex, input, 'plan', 0, { type: 'replace_plan', steps: oneStep('read') })
    const reserved = await apply(convex, input, 'reserve', plan.snapshot.revision, { type: 'reserve_model', id: 'model:0', maxCostMicros: 600 })
    expect((await get(convex, input.runId))?.modelReservation).toEqual({ id: 'model:0', maxCostMicros: 600 })
    const replay = await apply(convex, input, 'reserve', plan.snapshot.revision, { type: 'reserve_model', id: 'model:0', maxCostMicros: 600 })
    expect(replay.applied).toBe(false)
    await expect(apply(convex, input, 'delegate', reserved.snapshot.revision, {
      type: 'admit_child', child: { id: 'worker', stepId: 'read', allowedToolIds: ['tool:read'], maxCostMicros: 401, costMicros: 0, status: 'running', evidenceRefs: [] },
      goal: 'Read source', constraints: [],
    })).rejects.toThrow(/spending/)
    const cancelled = await apply(convex, input, 'cancel', reserved.snapshot.revision, { type: 'terminate', status: 'cancelled', reason: 'User stopped.' })
    expect(cancelled.snapshot.modelReservation?.maxCostMicros).toBe(600)
    const receipt = { id: 'model:0', modelId: 'fixture/model', provider: 'fixture', inputTokens: 10, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 500 }
    const settled = await apply(convex, input, 'receipt', cancelled.snapshot.revision, { type: 'record_receipt', receipt })
    expect(settled.snapshot.modelReservation).toBeUndefined()
    expect(settled.snapshot.usage.costMicros).toBe(500)
    expect(settled.snapshot.status).toBe('cancelled')
    await apply(convex, input, 'receipt-again', settled.snapshot.revision, { type: 'record_receipt', receipt })
    expect((await get(convex, input.runId))?.usage.costMicros).toBe(500)
  })

  test('failed runs release only zero-cost unbilled free-model reservations', async () => {
    const scenarios = [
      { runId: 'failed-free-model', modelId: 'openrouter/free', billingReservationId: null, maxCostMicros: 0, released: true },
      { runId: 'failed-paid-model', modelId: 'fixture/model', billingReservationId: null, maxCostMicros: 500, released: false },
      { runId: 'failed-billed-free-model', modelId: 'openrouter/free', billingReservationId: 'billing-hold', maxCostMicros: 0, released: false },
    ] as const

    for (const scenario of scenarios) {
      const convex = convexTest(schema, modules)
      const input = admission(scenario.runId, await seedConversation(convex))
      await admit(convex, input)
      const reserved = await apply(convex, input, 'reserve', 0, {
        type: 'reserve_model', id: `model:${scenario.runId}`, maxCostMicros: scenario.maxCostMicros,
      })
      await apply(convex, input, 'dispatch', reserved.snapshot.revision, {
        type: 'bind_model_dispatch', id: `model:${scenario.runId}`,
        modelId: scenario.modelId, billingReservationId: scenario.billingReservationId,
      })
      const failed = await apply(convex, input, 'failed', reserved.snapshot.revision + 1, {
        type: 'terminate', status: 'failed', reason: 'Provider execution failed.',
      })
      expect(failed.snapshot.status).toBe('failed')
      const reloaded = await get(convex, scenario.runId)
      if (scenario.released) {
        expect(reloaded?.modelReservation).toBeUndefined()
        expect(reloaded?.latestReceipt).toMatchObject({
          id: `model:${scenario.runId}`,
          modelId: 'openrouter/free',
          provider: 'overlay-free-router',
          inputTokens: 0,
          outputTokens: 0,
          costMicros: 0,
        })
        expect(reloaded?.latestReceipt).not.toHaveProperty('rejectionReason')
      } else {
        expect(reloaded?.modelReservation).toMatchObject({
          id: `model:${scenario.runId}`,
          maxCostMicros: scenario.maxCostMicros,
          dispatch: {
            modelId: scenario.modelId,
            billingReservationId: scenario.billingReservationId,
          },
        })
        expect(reloaded?.latestReceipt).toBeUndefined()
      }
    }
  })

  test('cancelled runs release a zero-cost unbilled free-model reservation without a summary id', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('cancelled-free-model', await seedConversation(convex))
    await admit(convex, input)
    const reserved = await apply(convex, input, 'reserve', 0, {
      type: 'reserve_model', id: 'model:10', maxCostMicros: 0,
    })
    const dispatched = await apply(convex, input, 'dispatch', reserved.snapshot.revision, {
      type: 'bind_model_dispatch', id: 'model:10',
      modelId: 'openrouter/free', billingReservationId: null,
    })
    const cancelled = await apply(convex, input, 'cancelled', dispatched.snapshot.revision, {
      type: 'terminate', status: 'cancelled', reason: 'User stopped.',
    })
    expect(cancelled.snapshot.status).toBe('cancelled')
    expect(cancelled.snapshot.modelReservation).toBeUndefined()
    expect(cancelled.snapshot.latestReceipt).toMatchObject({
      id: 'model:10',
      provider: 'overlay-free-router',
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    })
    expect(cancelled.snapshot.latestReceipt).not.toHaveProperty('rejectionReason')
  })

  test('reducer rejection exposes a typed operation error for workflow retry handling', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('rejected-operation', await seedConversation(convex))
    await admit(convex, input)
    const plan = await apply(convex, input, 'plan', 0, { type: 'replace_plan', steps: oneStep('inspect') })
    let rejection: unknown
    try {
      await apply(convex, input, 'invalid-evidence', plan.snapshot.revision, {
        type: 'transition_step',
        id: 'inspect',
        status: 'done',
        evidenceRefs: ['missing-evidence'],
      })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(ConvexError)
    expect(rejection).toMatchObject({
      data: {
        code: 'HARNESS_OPERATION_REJECTED',
        message: 'Evidence must reference successful observations from this run.',
      },
    })
  })
  test('binds one workflow owner atomically and keeps the claim on reload', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-owner', await seedConversation(convex))
    await admit(convex, input)
    await apply(convex, input, 'owner-first', 0, { type: 'claim_execution', workflowRunId: 'workflow-first' })
    expect((await get(convex, input.runId))?.workflowRunId).toBe('workflow-first')
    const retry = await apply(convex, input, 'owner-retry', 1, { type: 'claim_execution', workflowRunId: 'workflow-first' })
    expect(retry.snapshot.revision).toBe(1)
    await expect(apply(convex, input, 'owner-second', 1, { type: 'claim_execution', workflowRunId: 'workflow-second' }))
      .rejects.toThrow(/ALREADY_CLAIMED/)
  })

  test('round-trips normalized plans and requires current independent verification', async () => {
    const convex = convexTest(schema, modules)
    const conversationId = await seedConversation(convex)
    const input = admission('run-plan', conversationId)
    await admit(convex, input)

    const plan = await apply(convex, input, 'plan', 0, { type: 'replace_plan', steps: oneStep('inspect', true) })
    expect(plan.snapshot.planRevision).toBe(1)
    expect(plan.snapshot.plan[0]).toMatchObject({ id: 'inspect', status: 'pending', evidenceRefs: [] })

    const firstEvidence = {
      id: 'tool-output',
      kind: 'tool_result' as const,
      summary: 'The source was inspected.',
      source: 'tool:read',
      verdict: 'observed' as const,
      createdAt: Date.now(),
    }
    const recorded = await apply(convex, input, 'tool-output', 1, { type: 'record_evidence', evidence: firstEvidence })
    expect(recorded.snapshot.revision).toBe(2)
    await expect(apply(convex, input, 'premature-completion', 2, {
      type: 'transition_step',
      id: 'inspect',
      status: 'done',
      evidenceRefs: ['tool-output'],
    })).rejects.toThrow(/Independent verification/)

    const verification = {
      id: 'verification',
      kind: 'verification' as const,
      summary: 'An independent check passed.',
      source: 'reviewer:independent',
      verdict: 'passed' as const,
      createdAt: Date.now(),
      verification: { stepId: 'inspect', planRevision: 1 },
    }
    await apply(convex, input, 'verification', 2, { type: 'record_evidence', evidence: verification })
    const completed = await apply(convex, input, 'complete-inspect', 3, {
      type: 'transition_step',
      id: 'inspect',
      status: 'done',
      evidenceRefs: ['tool-output', 'verification'],
    })
    expect(completed.snapshot.plan[0]?.status).toBe('done')

    const fresh = await get(convex, input.runId)
    expect(fresh?.plan).toEqual(completed.snapshot.plan)
    expect(fresh?.evidence.map(item => item.id)).toEqual(['tool-output', 'verification'])
    const persisted = await convex.run(async ctx => ({
      planRows: await ctx.db.query('harnessPlanSteps').withIndex('by_runId', q => q.eq('runId', input.runId)).collect(),
      revisions: await ctx.db.query('harnessPlanRevisions')
        .withIndex('by_runId_planRevision', q => q.eq('runId', input.runId).eq('planRevision', 1)).collect(),
      metadata: await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', input.runId)).unique(),
    }))
    expect(persisted.planRows).toHaveLength(1)
    expect(persisted.revisions).toHaveLength(1)
    expect(JSON.parse(persisted.metadata!.metadataJson)).not.toHaveProperty('plan')
    expect(JSON.parse(persisted.metadata!.metadataJson)).not.toHaveProperty('evidence')
    expect(JSON.parse(persisted.metadata!.metadataJson)).not.toHaveProperty('children')
  })

  test('round-trips answer-only plans, completes them without evidence, and rejects verification requirements', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-answer-only', await seedConversation(convex))
    await admit(convex, input)
    const step = { ...oneStep('answer')[0]!, answerOnly: true }
    const planned = await apply(convex, input, 'answer-plan', 0, { type: 'replace_plan', steps: [step] })
    expect(planned.snapshot.plan[0]).toMatchObject({ id: 'answer', answerOnly: true, status: 'pending' })
    expect((await get(convex, input.runId))?.plan[0]).toMatchObject({ answerOnly: true, status: 'pending' })

    const finished = await apply(convex, input, 'answer-finish', planned.snapshot.revision, {
      type: 'finish', resultSummary: 'Answered from prior knowledge.',
    })
    expect(finished.snapshot.status).toBe('completed')
    expect(finished.snapshot.plan[0]).toMatchObject({ answerOnly: true, status: 'done' })
    expect((await get(convex, input.runId))?.plan[0]).toMatchObject({ answerOnly: true, status: 'done' })

    const rejectedInput = admission('run-answer-only-verification', await seedConversation(convex))
    await admit(convex, rejectedInput)
    await expect(apply(convex, rejectedInput, 'invalid-answer-plan', 0, {
      type: 'replace_plan', steps: [{ ...oneStep('answer', true)[0]!, answerOnly: true }],
    })).rejects.toThrow(/Answer-only/)
  })

  test('checks operation idempotency before CAS and leaves stale mutations without writes', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-cas', await seedConversation(convex))
    await admit(convex, input)

    const operation: HarnessOperation = { type: 'replace_plan', steps: oneStep('first') }
    const applied = await apply(convex, input, 'same-operation', 0, operation)
    expect(applied.applied).toBe(true)
    const replay = await apply(convex, input, 'same-operation', 0, operation)
    expect(replay).toMatchObject({ applied: false, conflict: false, snapshot: { revision: 1 } })
    await expect(apply(convex, input, 'same-operation', 1, {
      type: 'replace_plan',
      steps: oneStep('different'),
    })).rejects.toThrow(/HARNESS_OPERATION_ID_CONFLICT/)

    const stale = await apply(convex, input, 'stale-checkpoint', 0, { type: 'checkpoint', summary: 'stale' })
    expect(stale).toMatchObject({ applied: false, conflict: true, snapshot: { revision: 1 } })
    const persisted = await convex.run(async ctx => ({
      operations: await ctx.db.query('harnessOperations')
        .withIndex('by_runId_operationId', q => q.eq('runId', input.runId)).collect(),
      checkpoints: await ctx.db.query('harnessCheckpoints')
        .withIndex('by_runId_revision', q => q.eq('runId', input.runId)).collect(),
      evidence: await ctx.db.query('harnessEvidence')
        .withIndex('by_runId_createdAt', q => q.eq('runId', input.runId)).collect(),
    }))
    expect(persisted.operations).toHaveLength(1)
    expect(persisted.checkpoints).toHaveLength(0)
    expect(persisted.evidence).toHaveLength(0)
  })

  test('deduplicates receipt A, B, A across operation ids', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-receipts', await seedConversation(convex))
    await admit(convex, input)
    const receiptA = {
      id: 'receipt-a', modelId: 'fixture/a', provider: 'fixture',
      inputTokens: 10, outputTokens: 2, reasoningTokens: 1, cacheReadTokens: 3, cacheWriteTokens: 0,
      contextWindow: 1_000, costMicros: 100,
    }
    const receiptB = {
      id: 'receipt-b', modelId: 'fixture/b', provider: 'fixture',
      inputTokens: 20, outputTokens: 4, reasoningTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 1,
      contextWindow: null, costMicros: 200,
    }
    await apply(convex, input, 'receipt-a-first', 0, { type: 'record_receipt', receipt: receiptA })
    await apply(convex, input, 'receipt-b', 1, { type: 'record_receipt', receipt: receiptB })
    const duplicateA = await apply(convex, input, 'receipt-a-again', 2, { type: 'record_receipt', receipt: receiptA })
    expect(duplicateA).toMatchObject({ applied: false, conflict: false })
    expect(duplicateA.snapshot.usage).toEqual({
      inputTokens: 30,
      outputTokens: 6,
      reasoningTokens: 3,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
      costMicros: 300,
      externalCostMicros: 0,
      unpricedExternalCalls: 0,
    })
    const persisted = await convex.run(async ctx => ctx.db.query('harnessReceipts')
      .withIndex('by_runId_createdAt', q => q.eq('runId', input.runId)).collect())
    expect(persisted).toHaveLength(2)
  })

  test('settles a normally completed child without charging propagated receipts twice', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-settlement-root', await seedConversation(convex), { maxParallelChildren: 2 })
    await admit(convex, input)
    await apply(convex, input, 'settlement-root-plan', 0, {
      type: 'replace_plan', steps: oneStep('delegated'),
    })
    const childInput = { ...input, runId: 'run-settlement-child' }
    await apply(convex, input, 'settlement-admit-child', 1, {
      type: 'admit_child',
      child: {
        id: childInput.runId, stepId: 'delegated', allowedToolIds: ['tool:read'],
        maxCostMicros: 100, costMicros: 0, status: 'running', evidenceRefs: [],
      },
      goal: 'Complete the delegated milestone.',
      constraints: [],
    })
    await apply(convex, childInput, 'settlement-child-plan', 0, {
      type: 'replace_plan', steps: oneStep('work'),
    })
    const receipt = {
      id: 'settlement-receipt', modelId: 'fixture/model', provider: 'fixture',
      inputTokens: 4, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: null, costMicros: 60,
    }
    await apply(convex, childInput, 'settlement-receipt', 1, { type: 'record_receipt', receipt })
    const evidence = {
      id: 'settlement-proof', kind: 'tool_result' as const, summary: 'Work completed.',
      source: 'tool:read', verdict: 'observed' as const, createdAt: Date.now(),
    }
    await apply(convex, childInput, 'settlement-evidence', 2, { type: 'record_evidence', evidence })
    await apply(convex, childInput, 'settlement-step', 3, {
      type: 'transition_step', id: 'work', status: 'done', evidenceRefs: [evidence.id],
    })
    await apply(convex, childInput, 'settlement-checkpoint', 4, { type: 'checkpoint', summary: 'Intermediate working notes.' })
    await apply(convex, childInput, 'settlement-finish', 5, { type: 'finish', resultSummary: 'Verified child result.' })
    expect(await get(convex, childInput.runId)).toMatchObject({
      workingSummary: 'Intermediate working notes.', resultSummary: 'Verified child result.',
    })

    const settled = await apply(convex, input, 'settlement-join', 3, {
      type: 'settle_child', childRunId: childInput.runId,
    })
    expect(settled.snapshot.usage.costMicros).toBe(60)
    expect(settled.snapshot.latestReceipt).toBeUndefined()
    expect(settled.snapshot.children[0]).toMatchObject({
      status: 'completed',
      accountedUsage: { costMicros: 60 },
      summary: 'Verified child result.',
    })
    const parentStep = await apply(convex, input, 'settlement-parent-step', settled.snapshot.revision, {
      type: 'transition_step', id: 'delegated', status: 'done',
      evidenceRefs: settled.snapshot.evidence.map(item => item.id),
    })
    await apply(convex, input, 'settlement-parent-finish', parentStep.snapshot.revision, { type: 'finish', resultSummary: 'Integrated final result.' })
    expect((await get(convex, childInput.runId))?.status).toBe('completed')
    const completedChild = await get(convex, childInput.runId)
    await apply(convex, childInput, 'settlement-late-child-receipt', completedChild!.revision, {
      type: 'record_receipt', receipt: { ...receipt, id: 'settlement-late-receipt', costMicros: 1 },
    })
    expect((await get(convex, childInput.runId))?.status).toBe('completed')
    expect(await get(convex, input.runId)).toMatchObject({ status: 'completed', resultSummary: 'Integrated final result.', usage: { costMicros: 61 } })
    expect((await get(convex, childInput.runId))?.resultSummary).toBe('Verified child result.')
  })

  test('propagates grandchild receipts through cancellation and late retries exactly once', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-accounting-root', await seedConversation(convex), {
      maxParallelChildren: 2,
      maxDepth: 3,
    })
    await admit(convex, input)
    await apply(convex, input, 'accounting-plan', 0, {
      type: 'replace_plan',
      steps: oneStep('delegated'),
    })
    const childInput = { ...input, runId: 'run-accounting-child' }
    await apply(convex, input, 'accounting-child', 1, {
      type: 'admit_child',
      child: {
        id: childInput.runId, stepId: 'delegated', allowedToolIds: ['tool:read'],
        maxCostMicros: 400, costMicros: 0, status: 'running', evidenceRefs: [],
      },
      goal: 'Inspect the delegated milestone.',
      constraints: [],
    })
    await apply(convex, childInput, 'accounting-child-plan', 0, {
      type: 'replace_plan',
      steps: oneStep('nested'),
    })
    const grandchildInput = { ...input, runId: 'run-accounting-grandchild' }
    await apply(convex, childInput, 'accounting-grandchild', 1, {
      type: 'admit_child',
      child: {
        id: grandchildInput.runId, stepId: 'nested', allowedToolIds: ['tool:read'],
        maxCostMicros: 100, costMicros: 0, status: 'running', evidenceRefs: [],
      },
      goal: 'Inspect one nested item.',
      constraints: [],
    })
    const receiptA = {
      id: 'accounting-a', modelId: 'fixture/a', provider: 'fixture',
      inputTokens: 10, outputTokens: 2, reasoningTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: null, costMicros: 100,
    }
    const receiptB = { ...receiptA, id: 'accounting-b', costMicros: 200 }
    await apply(convex, grandchildInput, 'accounting-receipt-a', 0, { type: 'record_receipt', receipt: receiptA })
    expect((await get(convex, input.runId))?.usage.costMicros).toBe(100)
    expect((await get(convex, childInput.runId))?.usage.costMicros).toBe(100)
    expect((await get(convex, input.runId))?.latestReceipt).toBeUndefined()

    const cancelled = await apply(convex, childInput, 'accounting-cancel-child', 3, {
      type: 'terminate', status: 'cancelled', reason: 'Stop this subtree.',
    })
    expect(cancelled.snapshot.status).toBe('cancelled')
    expect((await get(convex, input.runId))?.status).toBe('running')
    expect((await get(convex, grandchildInput.runId))?.status).toBe('cancelled')
    expect((await get(convex, input.runId))?.usage.costMicros).toBe(100)
    const countsAfterTermination = await convex.run(async ctx => ({
      root: await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', input.runId)).unique(),
      child: await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', childInput.runId)).unique(),
    }))
    expect(countsAfterTermination.root?.activeDescendantCount).toBe(0)
    expect(countsAfterTermination.child?.activeDescendantCount).toBe(0)

    await expect(apply(convex, grandchildInput, 'blocked-after-intermediate-cancel', 1, {
      type: 'checkpoint', summary: 'Must not run.',
    })).rejects.toThrow(/terminal/)
    await apply(convex, grandchildInput, 'accounting-receipt-b', 1, { type: 'record_receipt', receipt: receiptB })
    await apply(convex, grandchildInput, 'accounting-receipt-a-retry', 2, { type: 'record_receipt', receipt: receiptA })
    const rootAfterRetry = await get(convex, input.runId)
    expect(rootAfterRetry?.usage.costMicros).toBe(300)
    expect(rootAfterRetry?.latestReceipt).toBeUndefined()
    const receipts = await convex.run(async ctx => ctx.db.query('harnessReceipts')
      .withIndex('by_runId_createdAt', q => q.eq('runId', grandchildInput.runId)).collect())
    expect(receipts).toHaveLength(2)

    const rootBeforeCancellation = await get(convex, input.runId)
    const rootCancelled = await apply(convex, input, 'accounting-cancel-root', rootBeforeCancellation!.revision, {
      type: 'terminate', status: 'cancelled', reason: 'Cancel the root after the child stopped.',
    })
    expect(rootCancelled.snapshot.status).toBe('cancelled')
    const receiptC = { ...receiptA, id: 'accounting-c', costMicros: 300 }
    await apply(convex, grandchildInput, 'accounting-receipt-c', 2, { type: 'record_receipt', receipt: receiptC })
    await apply(convex, grandchildInput, 'accounting-receipt-c-retry', 3, { type: 'record_receipt', receipt: receiptC })
    const rootAfterCancelledLateReceipt = await get(convex, input.runId)
    expect(rootAfterCancelledLateReceipt?.status).toBe('cancelled')
    expect(rootAfterCancelledLateReceipt?.usage.costMicros).toBe(600)
    expect(rootAfterCancelledLateReceipt?.latestReceipt).toBeUndefined()
  })

  test('rechecks actor, server secret and workspace membership before operation replay', async () => {
    const convex = convexTest(schema, modules)
    const personal = admission('run-authorization', await seedConversation(convex))
    await admit(convex, personal)
    await apply(convex, personal, 'committed', 0, { type: 'checkpoint', summary: 'committed' })
    await expect(get(convex, personal.runId, 'mallory')).rejects.toThrow()
    await expect(get(convex, personal.runId, 'alice', 'wrong-secret')).rejects.toThrow(/Unauthorized/)

    const workspaceId = 'workspace-harness'
    const now = Date.now()
    const workspace = await convex.run(async ctx => {
      await ctx.db.insert('workspaces', {
        workspaceId, kind: 'organization', name: 'Harness', slug: 'harness',
        status: 'active', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspacePrincipals', {
        principalId: 'principal-alice',
        workspaceId,
        type: 'human',
        userId: 'alice',
        displayName: 'Alice',
        createdAt: now,
        updatedAt: now,
      })
      const membershipId = await ctx.db.insert('workspaceMemberships', {
        membershipId: 'membership-alice',
        workspaceId,
        principalId: 'principal-alice',
        role: 'member',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
      return { membershipId }
    })
    const workspaceConversationId = await seedConversation(convex, 'alice', workspaceId)
    const shared = admission('run-workspace', workspaceConversationId, { workspaceId })
    await admit(convex, shared)
    const committed = {
      type: 'checkpoint',
      summary: 'workspace operation',
    } as const
    await apply(convex, shared, 'workspace-committed', 0, committed)
    await convex.run(ctx => ctx.db.patch(workspace.membershipId, { status: 'suspended' }))
    await expect(apply(convex, shared, 'workspace-committed', 0, committed)).rejects.toThrow()
  })

  test('admits a bounded child atomically and projects root cancellation without rewriting child state', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-root', await seedConversation(convex), {
      maxCostMicros: 1_000,
      maxParallelChildren: 1,
    })
    await admit(convex, input)
    await apply(convex, input, 'root-plan', 0, {
      type: 'replace_plan',
      steps: [...oneStep('delegated'), ...oneStep('second')],
    })
    const childOperation: HarnessOperation = {
      type: 'admit_child',
      child: {
        id: 'run-child',
        stepId: 'delegated',
        allowedToolIds: ['tool:read'],
        maxCostMicros: 400,
        costMicros: 0,
        status: 'running',
        evidenceRefs: [],
      },
      goal: 'Inspect the delegated milestone.',
      constraints: ['Do not change files.'],
    }
    const admitted = await apply(convex, input, 'child-admission', 1, childOperation)
    expect(admitted.snapshot.children).toMatchObject([{
      id: 'run-child',
      allowedToolIds: ['tool:read'],
      maxCostMicros: 400,
      status: 'running',
    }])
    expect(admitted.snapshot.plan.find(step => step.id === 'delegated')?.childRunId).toBe('run-child')
    const child = await get(convex, 'run-child')
    expect(child).toMatchObject({
      runId: 'run-child',
      rootRunId: input.runId,
      parentRunId: input.runId,
      depth: 1,
      goal: 'Inspect the delegated milestone.',
      constraints: [...input.constraints, 'Do not change files.'],
      status: 'running',
      plan: [],
      evidence: [],
      children: [],
      usage: { costMicros: 0 },
      policy: {
        actorUserId: 'alice',
        allowedToolIds: ['tool:read'],
        requiresPlan: true,
        maxCostMicros: 400,
      },
    })
    const childRows = await convex.run(async ctx => ({
      run: await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', 'run-child')).unique(),
      reservation: await ctx.db.query('harnessChildren')
        .withIndex('by_runId_childRunId', q => q.eq('runId', input.runId).eq('childRunId', 'run-child')).unique(),
    }))
    expect(childRows.run).not.toBeNull()
    expect(JSON.parse(childRows.reservation!.childJson).maxCostMicros).toBe(400)

    await apply(convex, { ...input, runId: 'run-child' }, 'child-plan', 0, {
      type: 'replace_plan',
      steps: oneStep('nested'),
    })
    await expect(apply(convex, { ...input, runId: 'run-child' }, 'nested-child', 1, {
      type: 'admit_child',
      child: {
        id: 'run-grandchild',
        stepId: 'nested',
        allowedToolIds: ['tool:read'],
        maxCostMicros: 100,
        costMicros: 0,
        status: 'running',
        evidenceRefs: [],
      },
      goal: 'Inspect one nested item.',
      constraints: [],
    })).rejects.toThrow(/root child concurrency budget/)
    const afterRejectedAdmission = await get(convex, 'run-child')
    expect(afterRejectedAdmission?.revision).toBe(1)
    expect(await get(convex, 'run-grandchild')).toBeNull()

    const cancelled = await apply(convex, input, 'cancel-root', 2, {
      type: 'terminate',
      status: 'cancelled',
      reason: 'User cancelled.',
    })
    expect(cancelled.snapshot.status).toBe('cancelled')
    expect(cancelled.snapshot.children[0]?.status).toBe('cancelled')
    expect((await get(convex, 'run-child'))?.status).toBe('cancelled')
    const childMetadata = await convex.run(async ctx => ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', 'run-child')).unique())
    expect(JSON.parse(childMetadata!.metadataJson).status).toBe('running')
    await expect(apply(convex, input, 'after-cancel', 3, { type: 'checkpoint', summary: 'must not run' }))
      .rejects.toThrow(/terminal/)
  })

  test('hydrates implicit transition evidence refs older than the recent evidence window', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-old-evidence', await seedConversation(convex))
    await admit(convex, input)
    await apply(convex, input, 'old-plan', 0, { type: 'replace_plan', steps: oneStep('inspect') })
    const evidence = {
      id: 'old-evidence', kind: 'tool_result' as const, summary: 'Original result.',
      source: 'tool:read', verdict: 'observed' as const, createdAt: Date.now(),
    }
    await apply(convex, input, 'old-evidence', 1, { type: 'record_evidence', evidence })
    await apply(convex, input, 'mark-verifying', 2, {
      type: 'transition_step', id: 'inspect', status: 'verifying', evidenceRefs: [evidence.id],
    })
    let revision = 3
    for (let index = 0; index < 40; index++) {
      await apply(convex, input, `new-evidence-${index}`, revision, {
        type: 'record_evidence',
        evidence: {
          id: `new-evidence-${index}`, kind: 'tool_result', summary: `Observation ${index}.`,
          source: 'tool:read', verdict: 'observed', createdAt: Date.now() + index,
        },
      })
      revision++
    }
    const completed = await apply(convex, input, 'complete-with-implicit-evidence', revision, {
      type: 'transition_step', id: 'inspect', status: 'done',
    })
    expect(completed.snapshot.plan[0]?.status).toBe('done')
    expect(completed.snapshot.plan[0]?.evidenceRefs).toEqual([evidence.id])
    expect(completed.snapshot.evidence.some(item => item.id === evidence.id)).toBe(true)
  })

  test('rejects oversized UTF-8 operation payloads without writes', async () => {
    const convex = convexTest(schema, modules)
    const input = admission('run-size-bound', await seedConversation(convex))
    await admit(convex, input)
    const oversizedSteps = Array.from({ length: 128 }, (_, index) => ({
      id: `large-${index}`, title: 'Large plan', dependsOn: [], acceptanceCriteria: ['😀'.repeat(1_000)],
      requiresVerification: false,
    }))
    await expect(apply(convex, input, 'oversized-plan', 0, {
      type: 'replace_plan',
      steps: oversizedSteps,
    })).rejects.toThrow(/encoded limit/)
    const persisted = await convex.run(async ctx => ({
      run: await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', input.runId)).unique(),
      planRows: await ctx.db.query('harnessPlanSteps').withIndex('by_runId', q => q.eq('runId', input.runId)).collect(),
      revisions: await ctx.db.query('harnessPlanRevisions').withIndex('by_runId_planRevision', q => q.eq('runId', input.runId)).collect(),
      operations: await ctx.db.query('harnessOperations').withIndex('by_runId_operationId', q => q.eq('runId', input.runId)).collect(),
    }))
    expect(JSON.parse(persisted.run!.metadataJson).revision).toBe(0)
    expect(persisted.planRows).toHaveLength(0)
    expect(persisted.revisions).toHaveLength(0)
    expect(persisted.operations).toHaveLength(0)
  })
})
