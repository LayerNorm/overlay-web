import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-assignment-test-secret'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
const query = (path: string) => makeFunctionReference<'query'>(path)
const createAssignment = mutation('collaboration/agentAssignments:createAgentAssignment')
const forConversation = query('collaboration/agentAssignments:forConversation')
const inheritedRestrictions = mutation('harness/runs:refreshRoomContextRestrictions')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture() {
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
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2,
    },
    serverSecret: secret,
  })
  expect(await convex.query(inheritedRestrictions, {
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
    const participant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', assignment.conversationId)
        .eq('principalId', 'alice')).unique()
    const parentParticipant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parentConversationId)
        .eq('principalId', 'alice')).unique()
    await ctx.db.patch(parentParticipant!._id, { status: 'revoked' })
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
    await ctx.db.patch(childParticipant!._id, { status: 'revoked' })
  })
  expect((await alice.query(forConversation, {
    workspaceId: 'workspace', conversationId: data.parentConversationId,
  })).assignments).toEqual([])
})
