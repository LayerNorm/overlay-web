import { convexTest } from 'convex-test'
import { beforeAll, describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const serverSecret = 'native-agent-approval-test'
const workspaceId = 'native-agent-approval-workspace'
const initiatorUserId = 'native-agent-approval-initiator'
const initiatorPrincipalId = 'native-agent-approval-initiator-principal'
const participantUserId = 'native-agent-approval-participant'
const participantPrincipalId = 'native-agent-approval-participant-principal'

beforeAll(() => { process.env.INTERNAL_API_SECRET = serverSecret })

describe('native agent approval projection', () => {
  test('exact run lookup is scoped while transitions and progress preserve or clear the projection', async () => {
    const convex = convexTest(schema, modules)
    const seeded = await convex.run(async ctx => {
      const now = Date.now()
      await ctx.db.insert('workspaces', {
        workspaceId,
        kind: 'organization',
        name: 'Approval room',
        slug: 'native-agent-approval-room',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      for (const [userId, principalId, role] of [
        [initiatorUserId, initiatorPrincipalId, 'owner'],
        [participantUserId, participantPrincipalId, 'member'],
      ] as const) {
        await ctx.db.insert('workspacePrincipals', {
          principalId,
          workspaceId,
          type: 'human',
          userId,
          displayName: userId,
          createdAt: now,
          updatedAt: now,
        })
        await ctx.db.insert('workspaceMemberships', {
          membershipId: `${principalId}-membership`,
          workspaceId,
          principalId,
          role,
          status: 'active',
          joinedAt: now,
          updatedAt: now,
        })
      }
      const conversationId = await ctx.db.insert('conversations', {
        userId: initiatorUserId,
        workspaceId,
        conversationType: 'dm',
        title: 'Approval room',
        lastModified: now,
        updatedAt: now,
        createdAt: now,
        lastMode: 'act',
        askModelIds: [],
        actModelId: 'openrouter/free',
      })
      const otherConversationId = await ctx.db.insert('conversations', {
        userId: initiatorUserId,
        workspaceId,
        conversationType: 'channel',
        title: 'Other room',
        lastModified: now,
        updatedAt: now,
        createdAt: now,
        lastMode: 'act',
        askModelIds: [],
        actModelId: 'openrouter/free',
      })
      for (const targetConversationId of [conversationId, otherConversationId]) {
        for (const [principalId, principalType] of [
          [initiatorPrincipalId, 'human'],
          [participantPrincipalId, 'human'],
        ] as const) {
          await ctx.db.insert('conversationParticipants', {
            conversationId: targetConversationId,
            workspaceId,
            principalId,
            principalType,
            role: 'member',
            status: 'active',
            notificationLevel: 'all',
            joinedAt: now,
            updatedAt: now,
          })
        }
      }
      const userMessageId = await ctx.db.insert('conversationMessages', {
        conversationId,
        userId: initiatorUserId,
        turnId: 'approval-user-turn',
        role: 'user',
        mode: 'act',
        content: 'Click the button.',
        contentType: 'text',
        createdAt: now,
        updatedAt: now,
      })
      const assistantParts = [
        { type: 'text', text: 'I am checking the button.' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-1', toolName: 'computer_input', state: 'input-available' } },
      ]
      const assistantMessageA = await ctx.db.insert('conversationMessages', {
        conversationId,
        userId: initiatorUserId,
        authorKind: 'agent',
        authorPrincipalId: 'agent-principal-a',
        turnId: 'approval-agent-turn-a',
        role: 'assistant',
        mode: 'act',
        content: 'I am checking the button.',
        contentType: 'text',
        parts: assistantParts,
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      })
      const assistantMessageB = await ctx.db.insert('conversationMessages', {
        conversationId,
        userId: initiatorUserId,
        authorKind: 'agent',
        authorPrincipalId: 'agent-principal-b',
        turnId: 'approval-agent-turn-b',
        role: 'assistant',
        mode: 'act',
        content: 'Second agent.',
        contentType: 'text',
        parts: [{ type: 'text', text: 'Second agent.' }],
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      })
      const runA = await ctx.db.insert('conversationAgentRuns', {
        conversationId,
        turnId: 'approval-agent-turn-a',
        userId: initiatorUserId,
        userMessageId,
        assistantMessageId: assistantMessageA,
        mode: 'room',
        runner: 'workflow',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      })
      const runB = await ctx.db.insert('conversationAgentRuns', {
        conversationId,
        turnId: 'approval-agent-turn-b',
        userId: initiatorUserId,
        userMessageId,
        assistantMessageId: assistantMessageB,
        mode: 'room',
        runner: 'workflow',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      })
      return { conversationId, otherConversationId, assistantMessageA, runA, runB }
    })
    const requestA = {
      approval: {
        token: 'approval-token-a',
        requestedAt: Date.now(),
        requests: [{ approvalId: 'run-a:tool-1', toolCallId: 'tool-1', toolName: 'computer_input', input: { action: 'type' } }],
      },
      runId: seeded.runA,
      serverSecret,
      status: 'waiting_for_approval' as const,
      userId: initiatorUserId,
    }
    const requestB = {
      approval: {
        token: 'approval-token-b',
        requestedAt: Date.now(),
        requests: [{ approvalId: 'run-b:tool-2', toolCallId: 'tool-2', toolName: 'computer_input', input: { action: 'type' } }],
      },
      runId: seeded.runB,
      serverSecret,
      status: 'waiting_for_approval' as const,
      userId: initiatorUserId,
    }
    await convex.mutation(api.chat.conversations.transitionAgentRun, requestA)
    await convex.mutation(api.chat.conversations.transitionAgentRun, requestB)

    const exactA = await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.conversationId,
      agentRunId: seeded.runA,
      userId: initiatorUserId,
      serverSecret,
    })
    const exactB = await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.conversationId,
      agentRunId: seeded.runB,
      userId: initiatorUserId,
      serverSecret,
    })
    expect(exactA?._id).toBe(seeded.runA)
    expect(exactA?.approval?.token).toBe('approval-token-a')
    expect(exactB?._id).toBe(seeded.runB)
    expect(exactB?.approval?.token).toBe('approval-token-b')
    expect(await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.otherConversationId,
      agentRunId: seeded.runA,
      userId: initiatorUserId,
      serverSecret,
    })).toBeNull()
    expect(await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.conversationId,
      agentRunId: seeded.runA,
      userId: participantUserId,
      serverSecret,
    })).toMatchObject({ _id: seeded.runA, userId: initiatorUserId })

    const pending = await convex.run(ctx => ctx.db.get(seeded.assistantMessageA))
    expect(pending?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'I am checking the button.' }),
      expect.objectContaining({ type: 'tool-invocation' }),
      expect.objectContaining({
        type: 'data-native-agent-approval',
        data: expect.objectContaining({
          runId: seeded.runA,
          conversationId: seeded.conversationId,
          userId: initiatorUserId,
          token: 'approval-token-a',
        }),
      }),
    ]))

    await convex.mutation(api.chat.conversations.recordAgentRunProgress, {
      content: 'Still waiting.',
      runId: seeded.runA,
      serverSecret,
      userId: initiatorUserId,
    })
    const progress = await convex.run(ctx => ctx.db.get(seeded.assistantMessageA))
    expect(progress?.parts?.filter(part => part.type === 'data-native-agent-approval')).toHaveLength(1)

    await convex.mutation(api.chat.conversations.transitionAgentRun, {
      runId: seeded.runA,
      serverSecret,
      status: 'running',
      userId: initiatorUserId,
    })
    await convex.mutation(api.collaboration.directMessages.appendAgentMessageDelta, {
      actorUserId: initiatorUserId,
      contentDelta: ' More output.',
      conversationId: seeded.conversationId,
      messageId: seeded.assistantMessageA,
      parts: [{ type: 'text', text: 'stale' }, {
        type: 'data-native-agent-approval',
        data: { runId: seeded.runA, conversationId: seeded.conversationId, userId: initiatorUserId, token: 'approval-token-a', requestedAt: 1, requests: [] },
      }],
      workspaceId,
      serverSecret,
    })
    const resumed = await convex.run(ctx => ctx.db.get(seeded.assistantMessageA))
    expect(resumed?.parts?.some(part => part.type === 'data-native-agent-approval')).toBe(false)

    await convex.mutation(api.chat.conversations.transitionAgentRun, {
      runId: seeded.runA,
      serverSecret,
      status: 'completed',
      userId: initiatorUserId,
    })
    const terminal = await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.conversationId,
      agentRunId: seeded.runA,
      userId: initiatorUserId,
      serverSecret,
    })
    expect(terminal?.status).toBe('completed')
    expect(terminal?.approval).toBeUndefined()
    expect((await convex.run(ctx => ctx.db.get(seeded.assistantMessageA)))?.parts?.some(
      part => part.type === 'data-native-agent-approval',
    )).toBe(false)
  })
})
