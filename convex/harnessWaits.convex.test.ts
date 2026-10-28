import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type {
  HarnessAdmission,
  HarnessMutationResult,
  HarnessOperation,
  HarnessWait,
  HarnessWaitReference,
  HarnessWaitRequest,
} from '../packages/overlay-agent-runtime/src/harness-store'
import type { HarnessSnapshot } from '../packages/overlay-agent-runtime/src/harness-state'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'harness-waits-test-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) => makeFunctionReference<'mutation'>(`harness/runs:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`harness/runs:${name}`)
type Convex = ReturnType<typeof convexTest>

async function seedConversation(convex: Convex, userId = 'alice') {
  const now = Date.now()
  return await convex.run(ctx => ctx.db.insert('conversations', {
    userId,
    title: 'Harness wait source',
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

async function admit(convex: Convex, input: HarnessAdmission) {
  return await convex.mutation(mutation('admit'), { ...input, serverSecret: secret }) as HarnessSnapshot
}

async function apply(
  convex: Convex,
  input: HarnessAdmission,
  operationId: string,
  expectedRevision: number,
  operation: HarnessOperation,
  actorUserId = input.policy.actorUserId,
) {
  return await convex.mutation(mutation('apply'), {
    actorUserId,
    runId: input.runId,
    operationId,
    expectedRevision,
    operation,
    serverSecret: secret,
  }) as HarnessMutationResult
}

async function createBlockedRun(
  convex: Convex,
  runId: string,
  kind: 'input' | 'approval' = 'input',
) {
  const input = admission(runId, await seedConversation(convex))
  await admit(convex, input)
  await apply(convex, input, 'claim', 0, { type: 'claim_execution', workflowRunId: `workflow-${runId}` })
  const blocked = await apply(convex, input, 'block', 1, {
    type: 'block',
    blocker: { kind, question: `Question for ${runId}` },
  })
  const reference: HarnessWaitReference = {
    actorUserId: input.policy.actorUserId,
    runId,
    workflowRunId: `workflow-${runId}`,
  }
  return { input, reference, snapshot: blocked.snapshot }
}

async function publishWait(
  convex: Convex,
  reference: HarnessWaitReference,
  request: unknown,
): Promise<HarnessWait> {
  return await convex.mutation(mutation('publishWait'), {
    ...reference,
    request,
    serverSecret: secret,
  }) as HarnessWait
}

async function resolveWait(
  convex: Convex,
  reference: HarnessWaitReference,
  token: string,
) {
  return await convex.mutation(mutation('resolveWait'), {
    ...reference,
    token,
    serverSecret: secret,
  })
}

async function listPendingWaits(
  convex: Convex,
  reference: HarnessWaitReference,
): Promise<HarnessWait[]> {
  return await convex.query(query('listPendingWaits'), {
    ...reference,
    serverSecret: secret,
  }) as HarnessWait[]
}

async function createChildTree(convex: Convex, childRunIds: string[]) {
  const rootRunId = `root-${childRunIds.join('-')}`
  const input = admission(rootRunId, await seedConversation(convex))
  await admit(convex, input)
  await apply(convex, input, 'claim-root', 0, {
    type: 'claim_execution',
    workflowRunId: `workflow-${rootRunId}`,
  })
  const plan = childRunIds.map((childRunId, index) => ({
    id: `step-${index}`,
    title: `Delegate ${childRunId}`,
    dependsOn: [],
    acceptanceCriteria: [`Inspect ${childRunId}.`],
    requiresVerification: false,
    evidenceTools: ['tool:read'],
  }))
  let root = (await apply(convex, input, 'root-plan', 1, { type: 'replace_plan', steps: plan })).snapshot
  const children: Array<{ input: HarnessAdmission; reference: HarnessWaitReference }> = []
  for (const [index, childRunId] of childRunIds.entries()) {
    root = (await apply(convex, input, `admit-${index}`, root.revision, {
      type: 'admit_child',
      child: {
        id: childRunId,
        stepId: `step-${index}`,
        allowedToolIds: ['tool:read'],
        maxCostMicros: 100,
        costMicros: 0,
        status: 'running',
        evidenceRefs: [],
      },
      goal: `Inspect ${childRunId}.`,
      constraints: [],
    })).snapshot
    const childInput = { ...input, runId: childRunId }
    const workflowRunId = `workflow-${childRunId}`
    await apply(convex, childInput, `claim-${index}`, 0, {
      type: 'claim_execution',
      workflowRunId,
    })
    await apply(convex, childInput, `block-${index}`, 1, {
      type: 'block',
      blocker: { kind: 'input', question: `Question for ${childRunId}` },
    })
    children.push({
      input: childInput,
      reference: { actorUserId: input.policy.actorUserId, runId: childRunId, workflowRunId },
    })
  }
  return {
    input,
    rootRevision: root.revision,
    rootReference: {
      actorUserId: input.policy.actorUserId,
      runId: rootRunId,
      workflowRunId: `workflow-${rootRunId}`,
    },
    children,
  }
}

describe('durable harness waits', () => {
  test('publishes only the matching blocker kind and replays immutable requests', async () => {
    const convex = convexTest(schema, modules)
    const inputRun = await createBlockedRun(convex, 'input-run')
    const inputRequest: HarnessWaitRequest = { kind: 'input', token: 'input-token' }
    const first = await publishWait(convex, inputRun.reference, inputRequest)
    expect(first).toMatchObject({
      kind: 'input',
      token: 'input-token',
      runId: 'input-run',
      rootRunId: 'input-run',
      workflowRunId: 'workflow-input-run',
      question: 'Question for input-run',
    })
    expect(await publishWait(convex, inputRun.reference, inputRequest)).toEqual(first)
    await expect(publishWait(convex, inputRun.reference, {
      kind: 'input',
      token: 'another-token',
      question: 'Caller-controlled question',
    })).rejects.toThrow()
    await expect(publishWait(convex, inputRun.reference, {
      kind: 'approval',
      token: 'wrong-kind-token',
      requests: [{ approvalId: 'approval', toolCallId: 'call', toolName: 'write', input: {} }],
    })).rejects.toThrow(/KIND_MISMATCH/)
    await expect(publishWait(convex, inputRun.reference, {
      kind: 'input',
      token: 'second-pending-token',
    })).rejects.toThrow(/ALREADY_PENDING/)

    const approvalRun = await createBlockedRun(convex, 'approval-run', 'approval')
    const approvalRequest: HarnessWaitRequest = {
      kind: 'approval',
      token: 'approval-token',
      requests: [{
        approvalId: 'approval-id',
        toolCallId: 'tool-call-id',
        toolName: 'write_file',
        input: { path: 'notes/example.md', content: 'safe text' },
      }],
    }
    const approvalWait = await publishWait(convex, approvalRun.reference, approvalRequest)
    expect(approvalWait).toMatchObject({
      kind: 'approval',
      token: 'approval-token',
      requests: approvalRequest.kind === 'approval' ? approvalRequest.requests : [],
      question: 'Question for approval-run',
    })
    const reorderedApprovalRequest = {
      kind: 'approval',
      token: 'approval-token',
      requests: [{
        toolName: 'write_file',
        input: { content: 'safe text', path: 'notes/example.md' },
        toolCallId: 'tool-call-id',
        approvalId: 'approval-id',
      }],
    }
    expect(await publishWait(convex, approvalRun.reference, reorderedApprovalRequest)).toEqual(approvalWait)
    await expect(publishWait(convex, approvalRun.reference, {
      kind: 'approval',
      token: 'empty-approval',
      requests: [],
    })).rejects.toThrow()
    await expect(publishWait(convex, approvalRun.reference, {
      kind: 'approval',
      token: 'oversized-approval',
      requests: [{
        approvalId: 'large',
        toolCallId: 'large-call',
        toolName: 'write_file',
        input: 'x'.repeat(256 * 1024),
      }],
    })).rejects.toThrow(/encoded limit/)
    await expect(publishWait(convex, approvalRun.reference, {
      kind: 'approval',
      token: 'duplicate-approval-id',
      requests: [
        { approvalId: 'repeated', toolCallId: 'first-call', toolName: 'write_file', input: {} },
        { approvalId: 'repeated', toolCallId: 'second-call', toolName: 'write_file', input: {} },
      ],
    })).rejects.toThrow(/duplicate approval or tool-call ids/)
    await expect(publishWait(convex, approvalRun.reference, {
      kind: 'approval',
      token: 'duplicate-tool-call-id',
      requests: [
        { approvalId: 'first-approval', toolCallId: 'repeated', toolName: 'write_file', input: {} },
        { approvalId: 'second-approval', toolCallId: 'repeated', toolName: 'write_file', input: {} },
      ],
    })).rejects.toThrow(/duplicate approval or tool-call ids/)
  })

  test('enforces actor, workflow, and globally unique token fences', async () => {
    const convex = convexTest(schema, modules)
    const firstRun = await createBlockedRun(convex, 'first-owner')
    const secondRun = await createBlockedRun(convex, 'second-owner')
    await publishWait(convex, firstRun.reference, { kind: 'input', token: 'shared-token' })

    await expect(publishWait(convex, {
      ...firstRun.reference,
      actorUserId: 'mallory',
    }, { kind: 'input', token: 'unauthorized-token' })).rejects.toThrow(/ACCESS_DENIED/)
    await expect(publishWait(convex, {
      ...firstRun.reference,
      actorUserId: 'mallory',
    }, { kind: 'input', token: 'shared-token' })).rejects.toThrow(/ACCESS_DENIED/)
    await expect(listPendingWaits(convex, {
      ...firstRun.reference,
      workflowRunId: 'wrong-workflow',
    })).rejects.toThrow(/WORKFLOW_ACCESS_DENIED/)
    await expect(publishWait(convex, {
      ...firstRun.reference,
      workflowRunId: 'wrong-workflow',
    }, { kind: 'input', token: 'shared-token' })).rejects.toThrow(/WORKFLOW_ACCESS_DENIED/)
    await expect(publishWait(convex, secondRun.reference, {
      kind: 'input',
      token: 'shared-token',
    })).rejects.toThrow(/TOKEN_CONFLICT/)

    await publishWait(convex, secondRun.reference, { kind: 'input', token: 'foreign-token' })
    await expect(resolveWait(convex, firstRun.reference, 'foreign-token')).rejects.toThrow(/WAIT_NOT_FOUND/)
    const foreignWait = await convex.run(ctx => ctx.db.query('harnessWaits')
      .withIndex('by_token', q => q.eq('token', 'foreign-token')).unique())
    expect(foreignWait?.resolvedAt).toBeUndefined()
  })

  test('resolution removes a wait from pending and a later replay does not reopen it', async () => {
    const convex = convexTest(schema, modules)
    const fixture = await createBlockedRun(convex, 'resolve-run')
    const request: HarnessWaitRequest = { kind: 'input', token: 'resolve-token' }
    const published = await publishWait(convex, fixture.reference, request)
    await resolveWait(convex, fixture.reference, request.token)
    expect(await listPendingWaits(convex, fixture.reference)).toEqual([])
    const resolved = await convex.run(ctx => ctx.db.query('harnessWaits')
      .withIndex('by_token', q => q.eq('token', request.token)).unique())
    expect(resolved?.resolvedAt).toBeTypeOf('number')

    await apply(convex, fixture.input, 'resume', fixture.snapshot.revision, { type: 'resume' })
    const replay = await publishWait(convex, fixture.reference, request)
    expect(replay.createdAt).toBe(published.createdAt)
    expect(replay.resolvedAt).toBe(resolved?.resolvedAt)
    await resolveWait(convex, fixture.reference, request.token)
    const resolvedAgain = await convex.run(ctx => ctx.db.query('harnessWaits')
      .withIndex('by_token', q => q.eq('token', request.token)).unique())
    expect(resolvedAgain?.resolvedAt).toBe(resolved?.resolvedAt)
    expect(await listPendingWaits(convex, fixture.reference)).toEqual([])
  })

  test('lets a parent see child waits while isolating sibling workflows', async () => {
    const convex = convexTest(schema, modules)
    const tree = await createChildTree(convex, ['child-one', 'child-two'])
    const first = await publishWait(convex, tree.children[0]!.reference, {
      kind: 'input',
      token: 'child-one-token',
    })
    const second = await publishWait(convex, tree.children[1]!.reference, {
      kind: 'input',
      token: 'child-two-token',
    })

    expect(await listPendingWaits(convex, tree.rootReference)).toEqual([first, second])
    expect(await listPendingWaits(convex, tree.children[0]!.reference)).toEqual([first])
    expect(await listPendingWaits(convex, tree.children[1]!.reference)).toEqual([second])
    const root = await convex.query(query('get'), {
      actorUserId: tree.rootReference.actorUserId,
      runId: tree.rootReference.runId,
      serverSecret: secret,
    }) as HarnessSnapshot
    expect(root.status).toBe('running')
  })

  test('excludes terminal-ancestor waits and rejects new child requests', async () => {
    const convex = convexTest(schema, modules)
    const tree = await createChildTree(convex, ['terminal-child'])
    const child = tree.children[0]!
    await publishWait(convex, child.reference, { kind: 'input', token: 'before-cancel' })
    await apply(convex, tree.input, 'terminate-root', tree.rootRevision, {
      type: 'terminate',
      status: 'cancelled',
      reason: 'Parent cancelled.',
    })

    expect(await listPendingWaits(convex, tree.rootReference)).toEqual([])
    expect(await listPendingWaits(convex, child.reference)).toEqual([])
    await expect(publishWait(convex, child.reference, {
      kind: 'input',
      token: 'after-cancel',
    })).rejects.toThrow(/ancestor is terminal/)
  })
})
