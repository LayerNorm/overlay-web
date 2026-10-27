import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { HarnessAdmission, HarnessMutationResult, HarnessOperation } from '../packages/overlay-agent-runtime/src/harness-store'
import type { HarnessSnapshot } from '../packages/overlay-agent-runtime/src/harness-state'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'harness-delivery-test-secret'
const mutation = (name: string) => makeFunctionReference<'mutation'>(`harness/runs:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`harness/runs:${name}`)
const chatMutation = (name: string) => makeFunctionReference<'mutation'>(`chat/conversations:${name}`)
type Convex = ReturnType<typeof convexTest>

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function seedConversation(convex: Convex, userId = 'alice', overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return await convex.run(ctx => ctx.db.insert('conversations', {
    userId,
    title: 'Personal harness source',
    lastModified: now,
    createdAt: now,
    updatedAt: now,
    lastMode: 'act',
    askModelIds: ['fixture/model'],
    actModelId: 'fixture/model',
    ...(overrides as never),
  }))
}

async function seedDelivery(
  convex: Convex,
  conversationId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now()
  return await convex.run(async ctx => {
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: conversationId as never,
      userId: 'alice',
      turnId: `turn-${now}`,
      role: 'user',
      mode: 'act',
      content: 'Run the harness.',
      contentType: 'text',
      createdAt: now,
    })
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: conversationId as never,
      userId: 'alice',
      turnId: `turn-${now}`,
      role: 'assistant',
      mode: 'act',
      content: '',
      contentType: 'text',
      parts: [{ type: 'text', text: '' }],
      status: 'generating',
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.insert('conversationAgentRuns', {
      conversationId: conversationId as never,
      turnId: `turn-${now}`,
      userId: 'alice',
      userMessageId,
      assistantMessageId,
      mode: 'work',
      runner: 'workflow',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      ...(overrides as never),
    })
  })
}

function admission(
  runId: string,
  conversationId: string,
  deliveryAgentRunId?: string,
): HarnessAdmission {
  return {
    runId,
    goal: 'Complete the requested work.',
    constraints: ['Preserve the source scope.'],
    policy: {
      actorUserId: 'alice',
      allowedToolIds: ['tool:read'],
      requiresPlan: false,
      deadlineAt: Date.now() + 60_000,
      maxCostMicros: 2_000,
      maxParallelChildren: 2,
      maxDepth: 2,
    },
    source: { conversationId },
    ...(deliveryAgentRunId ? { deliveryAgentRunId } : {}),
  }
}

async function admit(convex: Convex, input: HarnessAdmission) {
  return await convex.mutation(mutation('admit'), { ...input, serverSecret: secret }) as HarnessSnapshot
}

async function apply(
  convex: Convex,
  input: HarnessAdmission,
  operationId: string,
  expectedRevision: number,
  operation: HarnessOperation,
) {
  return await convex.mutation(mutation('apply'), {
    actorUserId: 'alice', runId: input.runId, operationId, expectedRevision, operation, serverSecret: secret,
  }) as HarnessMutationResult
}

async function get(convex: Convex, runId: string) {
  return await convex.query(query('get'), { actorUserId: 'alice', runId, serverSecret: secret }) as HarnessSnapshot | null
}

async function cancelDelivery(convex: Convex, conversationId: string) {
  return await convex.mutation(chatMutation('cancelAgentRuns'), {
    conversationId: conversationId as never, serverSecret: secret, userId: 'alice',
  }) as { cancelledHarnessRoots?: Array<{ agentRunId: string; runId: string }> }
}

describe('personal harness delivery binding', () => {
  test('admits and replays one queued delivery with an atomic binding', async () => {
    const convex = convexTest(schema, modules)
    const conversationId = await seedConversation(convex)
    const deliveryId = await seedDelivery(convex, conversationId)
    const input = admission('root', conversationId, deliveryId)

    const first = await admit(convex, input)
    const delivery = await convex.run(ctx => ctx.db.get(deliveryId as never))
    expect(delivery?.harnessRunId).toBe('root')
    expect(first.runId).toBe('root')
    expect((await admit(convex, input)).revision).toBe(first.revision)
    await expect(admit(convex, { ...input, goal: 'A different immutable goal.' })).rejects.toThrow(/CONFLICT/)
    const otherDeliveryId = await seedDelivery(convex, conversationId)
    await expect(admit(convex, { ...input, deliveryAgentRunId: otherDeliveryId })).rejects.toThrow(/CONFLICT/)
    expect((await convex.run(ctx => ctx.db.get(otherDeliveryId as never)))?.harnessRunId).toBeUndefined()
    expect((await get(convex, 'root'))?.status).toBe('running')
  })

  test('rejects invalid targets without leaving a root or binding', async () => {
    const cases = [
      { name: 'foreign', delivery: { userId: 'other' }, source: 'own' },
      { name: 'terminal', delivery: { status: 'cancelled', cancelledAt: 1 }, source: 'own' },
      { name: 'completed', delivery: { status: 'completed', completedAt: 1 }, source: 'own' },
      { name: 'remote', delivery: { runner: 'remote' }, source: 'own' },
      { name: 'tool-loop', delivery: { runner: 'tool_loop' }, source: 'own' },
      { name: 'room', delivery: { mode: 'room' }, source: 'own' },
      { name: 'started', delivery: { startedAt: 1, workflowRunId: 'already-running' }, source: 'own' },
      { name: 'bound', delivery: { harnessRunId: 'other-root' }, source: 'own' },
    ] as const
    for (const item of cases) {
      const convex = convexTest(schema, modules)
      const sourceConversationId = await seedConversation(convex)
      const deliveryId = await seedDelivery(convex, sourceConversationId, item.delivery)
      const input = admission(`root-${item.name}`, sourceConversationId, deliveryId)
      if (item.source === 'own' && item.name === 'foreign') {
        const foreignConversationId = await seedConversation(convex, 'other')
        input.source = { conversationId: foreignConversationId }
      }
      await expect(admit(convex, input)).rejects.toThrow()
      expect(await get(convex, input.runId)).toBeNull()
      expect((await convex.run(ctx => ctx.db.get(deliveryId as never)))?.harnessRunId).toBe(item.name === 'bound' ? 'other-root' : undefined)
    }
    const convex = convexTest(schema, modules)
    const dmConversationId = await seedConversation(convex, 'alice', {
      workspaceId: 'workspace', conversationType: 'dm',
    })
    const dmDeliveryId = await seedDelivery(convex, dmConversationId)
    const dmInput = admission('dm-root', dmConversationId, dmDeliveryId)
    await expect(admit(convex, dmInput)).rejects.toThrow()
    expect(await get(convex, dmInput.runId)).toBeNull()
  })

  test('stop fences a claimed root before delivery attach, retains holds and allows one late receipt', async () => {
    const convex = convexTest(schema, modules)
    const conversationId = await seedConversation(convex)
    const deliveryId = await seedDelivery(convex, conversationId)
    const input = admission('cancel-root', conversationId, deliveryId)
    await admit(convex, input)
    const claimed = await apply(convex, input, 'claim', 0, { type: 'claim_execution', workflowRunId: 'root-workflow' })
    const planned = await apply(convex, input, 'plan', claimed.snapshot.revision, {
      type: 'replace_plan',
      steps: [{ id: 'delegate', title: 'Delegate', dependsOn: [], acceptanceCriteria: ['Complete it.'], requiresVerification: false }],
    })
    const reserved = await apply(convex, input, 'reserve', planned.snapshot.revision, {
      type: 'reserve_model', id: 'late-receipt', maxCostMicros: 600,
    })
    const childInput = { ...input, runId: 'cancel-child' }
    const childAdmission = await apply(convex, input, 'child-admission', reserved.snapshot.revision, {
      type: 'admit_child',
      child: {
        id: childInput.runId, stepId: 'delegate', allowedToolIds: ['tool:read'],
        maxCostMicros: 500, costMicros: 0, status: 'running', evidenceRefs: [],
      },
      goal: 'Complete the delegated work.',
      constraints: [],
    })
    const childClaimed = await apply(convex, childInput, 'child-claim', 0, {
      type: 'claim_execution', workflowRunId: 'child-workflow',
    })
    const cancelled = await cancelDelivery(convex, conversationId)
    expect(cancelled.cancelledHarnessRoots).toEqual([{ agentRunId: deliveryId, runId: 'cancel-root' }])
    const attached = await convex.mutation(chatMutation('attachAgentRunWorkflow'), {
      runId: deliveryId as never, serverSecret: secret, userId: 'alice', workflowRunId: 'root-workflow',
    }) as { status: string; workflowRunId?: string }
    expect(attached.status).toBe('cancelled')
    expect(attached.workflowRunId).toBeUndefined()
    const root = await get(convex, input.runId)
    expect(root?.status).toBe('cancelled')
    expect(root?.modelReservation?.id).toBe('late-receipt')
    expect((await admit(convex, input)).status).toBe('cancelled')
    await expect(apply(convex, input, 'resume-after-stop', root!.revision, { type: 'resume' })).rejects.toThrow(/terminal/)
    await expect(apply(convex, childInput, 'child-resume-after-stop', childClaimed.snapshot.revision, { type: 'resume' }))
      .rejects.toThrow(/terminal/)
    await expect(apply(convex, childInput, 'grandchild-after-stop', childClaimed.snapshot.revision, {
      type: 'admit_child',
      child: {
        id: 'cancel-grandchild', stepId: 'nested', allowedToolIds: ['tool:read'],
        maxCostMicros: 100, costMicros: 0, status: 'running', evidenceRefs: [],
      },
      goal: 'Attempt another child.',
      constraints: [],
    })).rejects.toThrow(/terminal/)
    expect(childAdmission.snapshot.children).toHaveLength(1)
    const receipt = {
      id: 'late-receipt', modelId: 'fixture/model', provider: 'fixture', inputTokens: 10, outputTokens: 1,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 500,
    }
    const settled = await apply(convex, input, 'late-receipt', root!.revision, { type: 'record_receipt', receipt })
    await apply(convex, input, 'late-receipt-retry', settled.snapshot.revision, { type: 'record_receipt', receipt })
    expect((await get(convex, input.runId))?.usage.costMicros).toBe(500)
    expect((await get(convex, input.runId))?.modelReservation).toBeUndefined()
    expect((await get(convex, input.runId))?.workflowRunId).toBe('root-workflow')

    const otherConversationId = await seedConversation(convex)
    const otherDeliveryId = await seedDelivery(convex, otherConversationId)
    await admit(convex, admission('independent-root', otherConversationId, otherDeliveryId))
    expect((await get(convex, 'independent-root'))?.status).toBe('running')
  })

  test('authorizes cleanup queries and continues across an empty filtered page', async () => {
    const convex = convexTest(schema, modules)
    const conversationId = await seedConversation(convex)
    const deliveryId = await seedDelivery(convex, conversationId)
    const input = admission('paged-root', conversationId, deliveryId)
    const root = await admit(convex, input)
    await cancelDelivery(convex, conversationId)
    await convex.run(async ctx => {
      const now = Date.now()
      for (let index = 0; index < 100; index++) {
        const runId = `old-terminal-${index}`
        await ctx.db.insert('harnessRuns', {
          runId,
          actorUserId: 'alice',
          rootRunId: 'paged-root',
          parentRunId: 'paged-root',
          activeDescendantCount: 0,
          sourceJson: JSON.stringify(input.source),
          admissionJson: '{}',
          metadataJson: JSON.stringify({
            ...root, runId, rootRunId: 'paged-root', parentRunId: 'paged-root', depth: 1,
            status: 'completed', terminalReason: 'old',
          }),
          createdAt: now + index,
          updatedAt: now + index,
        })
      }
      await ctx.db.insert('harnessRuns', {
        runId: 'later-active',
        actorUserId: 'alice',
        rootRunId: 'paged-root',
        parentRunId: 'paged-root',
        activeDescendantCount: 0,
        sourceJson: JSON.stringify(input.source),
        admissionJson: '{}',
        metadataJson: JSON.stringify({
          ...root, runId: 'later-active', rootRunId: 'paged-root', parentRunId: 'paged-root', depth: 1,
          status: 'running', workflowRunId: 'later-workflow',
        }),
        createdAt: now + 101,
        updatedAt: now + 101,
      })
    })
    const first = await convex.query(query('listDeliveryWorkflowRuns'), {
      actorUserId: 'alice', agentRunId: deliveryId, rootRunId: 'paged-root', cursor: null, serverSecret: secret,
    }) as { workflowRunIds: string[]; cursor: string; isDone: boolean }
    expect(first.workflowRunIds).toEqual([])
    expect(first.isDone).toBe(false)
    const second = await convex.query(query('listDeliveryWorkflowRuns'), {
      actorUserId: 'alice', agentRunId: deliveryId, rootRunId: 'paged-root', cursor: first.cursor, serverSecret: secret,
    }) as { workflowRunIds: string[]; cursor: string; isDone: boolean }
    expect(second.workflowRunIds).toEqual(['later-workflow'])
    expect(second.isDone).toBe(true)
    await expect(convex.query(query('listDeliveryWorkflowRuns'), {
      actorUserId: 'other', agentRunId: deliveryId, rootRunId: 'paged-root', cursor: null, serverSecret: secret,
    })).rejects.toThrow(/DENIED/)
  })
})
