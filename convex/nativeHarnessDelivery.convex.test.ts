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

async function open(convex: Convex, fixture: Awaited<ReturnType<typeof seed>>, actorUserId = 'alice', engine = true) {
  return convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId, agentId: 'agent', authorPrincipalId: 'agent-principal', conversationId: fixture.conversationId,
    clientNonce: `nonce-${actorUserId}`, turnId: `turn-${actorUserId}`, modelId: 'openrouter/free',
    userMessageId: fixture.userMessageId, workspaceId: 'workspace', serverSecret: secret,
    ...(engine ? { executionEngine: 'overlay_harness' } : {}),
  })
}

function admission(conversationId: string, deliveryAgentRunId: string): HarnessAdmission {
  return { runId: `workspace:${deliveryAgentRunId}`, deliveryAgentRunId, source: { conversationId }, goal: 'Read the record.',
    constraints: [], policy: { actorUserId: 'alice', workspaceId: 'workspace', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2 } }
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
