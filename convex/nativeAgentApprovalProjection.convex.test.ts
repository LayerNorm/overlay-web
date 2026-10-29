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
        parts: [
          { type: 'text', text: 'Second agent.' },
          { type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-2', toolName: 'computer_input', state: 'input-available' } },
        ],
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      })
      const userMessageC = await ctx.db.insert('conversationMessages', {
        conversationId: otherConversationId,
        userId: initiatorUserId,
        turnId: 'approval-user-turn-c',
        role: 'user',
        mode: 'act',
        content: 'Cancel this run.',
        contentType: 'text',
        createdAt: now,
        updatedAt: now,
      })
      const assistantMessageC = await ctx.db.insert('conversationMessages', {
        conversationId: otherConversationId,
        userId: initiatorUserId,
        authorKind: 'agent',
        authorPrincipalId: 'agent-principal-c',
        turnId: 'approval-agent-turn-c',
        role: 'assistant',
        mode: 'act',
        content: 'Waiting to be cancelled.',
        contentType: 'text',
        parts: [{ type: 'text', text: 'Waiting to be cancelled.' }],
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
      const runC = await ctx.db.insert('conversationAgentRuns', {
        conversationId: otherConversationId,
        turnId: 'approval-agent-turn-c',
        userId: initiatorUserId,
        userMessageId: userMessageC,
        assistantMessageId: assistantMessageC,
        mode: 'room',
        runner: 'workflow',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      })
      return { conversationId, otherConversationId, assistantMessageA, assistantMessageB, assistantMessageC, runA, runB, runC }
    })
    const requestA = {
      approval: {
        token: 'approval-token-a',
        requestedAt: Date.now(),
        title: 'Approval required',
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
    expect(exactA?.approval?.title).toBe('Approval required')
    expect(exactB?._id).toBe(seeded.runB)
    expect(exactB?.approval?.token).toBe('approval-token-b')
    expect(exactB?.approval?.title).toBeUndefined()
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
    expect(progress?.parts?.some(part => part.type === 'tool-invocation')).toBe(true)

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
      status: 'waiting_for_approval',
      approval: {
        token: 'approval-token-complete',
        requestedAt: Date.now(),
        requests: [{ approvalId: 'complete:tool-1', toolCallId: 'tool-1', toolName: 'computer_input', input: { action: 'type' } }],
      },
      userId: initiatorUserId,
    })
    await convex.mutation(api.chat.conversations.transitionAgentRun, {
      runId: seeded.runA,
      serverSecret,
      status: 'running',
      userId: initiatorUserId,
    })
    await convex.mutation(api.chat.conversations.completeAgentRun, {
      content: 'Complete while keeping tool history.',
      parts: [
        { type: 'text', text: 'Complete while keeping tool history.' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-1', toolName: 'computer_input', state: 'output-available', toolOutput: { ok: true } } },
        { type: 'data-native-agent-approval', data: { runId: seeded.runA, conversationId: seeded.conversationId, userId: initiatorUserId, token: 'approval-token-complete', requestedAt: Date.now(), requests: [] } },
      ],
      runId: seeded.runA,
      serverSecret,
      tokens: { input: 10, output: 5 },
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
    expect((await convex.run(ctx => ctx.db.get(seeded.assistantMessageA)))?.parts?.some(
      part => part.type === 'tool-invocation',
    )).toBe(true)

    await convex.mutation(api.collaboration.directMessages.failAgentMessage, {
      actorUserId: initiatorUserId,
      content: 'Partial failure output.',
      conversationId: seeded.conversationId,
      messageId: seeded.assistantMessageB,
      parts: [
        { type: 'text', text: 'Partial failure output.' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-2', toolName: 'computer_input', state: 'output-error', toolOutput: { error: 'failed' } } },
        { type: 'data-native-agent-approval', data: { runId: seeded.runB, conversationId: seeded.conversationId, userId: initiatorUserId, token: 'approval-token-b', requestedAt: Date.now(), requests: [] } },
      ],
      workspaceId,
      serverSecret,
    })
    await convex.mutation(api.chat.conversations.failAgentRun, {
      error: { code: 'model_failed', message: 'The agent turn failed.', retryable: false },
      errorText: 'The agent turn failed.',
      runId: seeded.runB,
      serverSecret,
      userId: initiatorUserId,
    })
    const failedRun = await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.conversationId,
      agentRunId: seeded.runB,
      userId: initiatorUserId,
      serverSecret,
    })
    const failedMessage = await convex.run(ctx => ctx.db.get(seeded.assistantMessageB))
    expect(failedRun?.status).toBe('failed')
    expect(failedRun?.approval).toBeUndefined()
    expect(failedMessage?.content).toBe('Partial failure output.')
    expect(failedMessage?.parts?.some(part => part.type === 'data-native-agent-approval')).toBe(false)
    expect(failedMessage?.parts?.some(part => part.type === 'tool-invocation')).toBe(true)

    await convex.mutation(api.chat.conversations.transitionAgentRun, {
      runId: seeded.runC,
      serverSecret,
      status: 'waiting_for_approval',
      approval: {
        token: 'approval-token-cancel',
        requestedAt: Date.now(),
        requests: [{ approvalId: 'cancel:tool-3', toolCallId: 'tool-3', toolName: 'computer_input', input: { action: 'type' } }],
      },
      userId: initiatorUserId,
    })
    await convex.mutation(api.chat.conversations.cancelAgentRuns, {
      conversationId: seeded.otherConversationId,
      userId: initiatorUserId,
      serverSecret,
      partialContent: 'This run was interrupted.',
    })
    const cancelledRun = await convex.query(api.chat.conversations.getLatestAgentRun, {
      conversationId: seeded.otherConversationId,
      agentRunId: seeded.runC,
      userId: initiatorUserId,
      serverSecret,
    })
    const cancelledMessage = await convex.run(ctx => ctx.db.get(seeded.assistantMessageC))
    expect(cancelledRun?.status).toBe('cancelled')
    expect(cancelledRun?.approval).toBeUndefined()
    expect(cancelledMessage?.parts?.some(part => part.type === 'data-native-agent-approval')).toBe(false)
  })

  test('input and child waits remain active, resumable, and cancellable', async () => {
    for (const status of ['waiting_for_input', 'waiting_for_children'] as const) {
      const convex = convexTest(schema, modules)
      const seeded = await convex.run(async ctx => {
        const now = Date.now()
        const conversationId = await ctx.db.insert('conversations', {
          userId: initiatorUserId,
          title: `Wait ${status}`,
          lastModified: now,
          updatedAt: now,
          createdAt: now,
          lastMode: 'act',
          askModelIds: [],
          actModelId: 'openrouter/free',
        })
        const userMessageId = await ctx.db.insert('conversationMessages', {
          conversationId,
          userId: initiatorUserId,
          turnId: `wait-user-${status}`,
          role: 'user',
          mode: 'act',
          content: 'Continue this task.',
          contentType: 'text',
          createdAt: now,
          updatedAt: now,
        })
        const waitingAssistantMessageId = await ctx.db.insert('conversationMessages', {
          conversationId,
          userId: initiatorUserId,
          turnId: `wait-assistant-${status}`,
          role: 'assistant',
          mode: 'act',
          content: 'Waiting.',
          contentType: 'text',
          parts: [{ type: 'text', text: 'Waiting.' }],
          status: 'generating',
          createdAt: now,
          updatedAt: now,
        })
        const waitingRunId = await ctx.db.insert('conversationAgentRuns', {
          conversationId,
          turnId: `wait-assistant-${status}`,
          userId: initiatorUserId,
          userMessageId,
          assistantMessageId: waitingAssistantMessageId,
          mode: 'work',
          runner: 'workflow',
          workflowRunId: 'wait-workflow',
          ...(status === 'waiting_for_input' ? { inputRequest: { token: 'input-token', requestedAt: now, question: 'Which file?' } } : {}),
          status,
          createdAt: now,
          updatedAt: now,
        })
        const terminalRunIds = await Promise.all(
          (['completed', 'failed', 'cancelled'] as const).map(async (terminalStatus, index) => {
            const terminalAssistantMessageId = await ctx.db.insert('conversationMessages', {
              conversationId,
              userId: initiatorUserId,
              turnId: `terminal-assistant-${status}-${terminalStatus}`,
              role: 'assistant',
              mode: 'act',
              content: 'Terminal run.',
              contentType: 'text',
              parts: [{ type: 'text', text: 'Terminal run.' }],
              status: terminalStatus === 'failed' ? 'error' : 'completed',
              createdAt: now + index + 1,
              updatedAt: now + index + 1,
            })
            return await ctx.db.insert('conversationAgentRuns', {
              conversationId,
              turnId: `terminal-assistant-${status}-${terminalStatus}`,
              userId: initiatorUserId,
              userMessageId,
              assistantMessageId: terminalAssistantMessageId,
              mode: 'work',
              runner: 'workflow',
              status: terminalStatus,
              createdAt: now + index + 1,
              updatedAt: now + index + 1,
            })
          }),
        )
        return { conversationId, userMessageId, waitingRunId, terminalRunIds }
      })

      const latest = await convex.query(api.chat.conversations.getLatestAgentRun, {
        conversationId: seeded.conversationId,
        userId: initiatorUserId,
        serverSecret,
      })
      expect(latest).toMatchObject({ _id: seeded.waitingRunId, status })

      await expect(convex.mutation(api.chat.conversations.transitionAgentRun, {
        runId: seeded.waitingRunId, serverSecret, status: 'running', userId: initiatorUserId,
        expectedWorkflowRunId: 'wrong-workflow',
      })).rejects.toThrow('AgentRun workflow ownership changed')
      if (status === 'waiting_for_input') expect(latest?.inputRequest?.token).toBe('input-token')

      const resumed = await convex.mutation(api.chat.conversations.transitionAgentRun, {
        runId: seeded.waitingRunId,
        expectedWorkflowRunId: 'wait-workflow',
        serverSecret,
        status: 'running',
        userId: initiatorUserId,
      })
      expect(resumed?.status).toBe('running')
      expect(resumed?.inputRequest).toBeUndefined()

      const cancellableRunId = await convex.run(async ctx => {
        const now = Date.now()
        const assistantMessageId = await ctx.db.insert('conversationMessages', {
          conversationId: seeded.conversationId,
          userId: initiatorUserId,
          turnId: `wait-cancel-${status}`,
          role: 'assistant',
          mode: 'act',
          content: 'Waiting to be cancelled.',
          contentType: 'text',
          parts: [{ type: 'text', text: 'Waiting to be cancelled.' }],
          status: 'generating',
          createdAt: now,
          updatedAt: now,
        })
        return await ctx.db.insert('conversationAgentRuns', {
          conversationId: seeded.conversationId,
          turnId: `wait-cancel-${status}`,
          userId: initiatorUserId,
          userMessageId: seeded.userMessageId,
          assistantMessageId,
          mode: 'work',
          runner: 'workflow',
          status,
          createdAt: now,
          updatedAt: now,
        })
      })
      await convex.mutation(api.chat.conversations.cancelAgentRuns, {
        conversationId: seeded.conversationId,
        userId: initiatorUserId,
        serverSecret,
      })
      const cancelled = await convex.query(api.chat.conversations.getLatestAgentRun, {
        conversationId: seeded.conversationId,
        agentRunId: seeded.waitingRunId,
        userId: initiatorUserId,
        serverSecret,
      })
      expect(cancelled?.status).toBe('cancelled')
      const cancelledWhileWaiting = await convex.query(api.chat.conversations.getLatestAgentRun, {
        conversationId: seeded.conversationId,
        agentRunId: cancellableRunId,
        userId: initiatorUserId,
        serverSecret,
      })
      expect(cancelledWhileWaiting?.status).toBe('cancelled')

      for (const terminalRunId of seeded.terminalRunIds) {
        for (const waitingStatus of ['waiting_for_input', 'waiting_for_children'] as const) {
          await expect(convex.mutation(api.chat.conversations.transitionAgentRun, {
            runId: terminalRunId,
            serverSecret,
            status: waitingStatus,
            userId: initiatorUserId,
          })).rejects.toThrow(/Invalid AgentRun transition/)
        }
      }
    }
  })
})
