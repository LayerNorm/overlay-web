import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { ActConversationRepository } from './ActConversationRepository'
import { AgentRunService } from './AgentRunService'

test('failure observations are persisted with the terminal AgentRun', async () => {
  let received: Parameters<ActConversationRepository['failAgentRun']>[0] | undefined
  const repository = {
    async failAgentRun(args: Parameters<ActConversationRepository['failAgentRun']>[0]) {
      received = args
      return null
    },
  } as unknown as ActConversationRepository
  const service = new AgentRunService(repository)

  await service.fail({
    error: { code: 'workflow_failed', message: 'failed', retryable: true },
    errorText: 'failed',
    metrics: { inputTokens: 12, workflowRetryCount: 2 },
    runId: 'run_1',
    userId: 'user_1',
  })

  assert.deepEqual(received?.metrics, { inputTokens: 12, workflowRetryCount: 2 })
})

test('metrics reports fetch one lookahead row to identify truncation exactly', async () => {
  let requestedLimit = 0
  const runs = [0, 1, 2].map((index) => ({
    id: `run_${index}`,
    runner: 'tool_loop',
    mode: 'chat',
    status: 'completed',
    createdAt: index,
    completedAt: index + 1,
  })) as AgentRun[]
  const repository = {
    async listAgentRunsForMetrics(args: { limit: number }) {
      requestedLimit = args.limit
      return runs
    },
  } as unknown as ActConversationRepository
  const service = new AgentRunService(repository)

  const report = await service.metricsReport({ from: 0, limit: 2, to: 10, userId: 'user_1' })

  assert.equal(requestedLimit, 3)
  assert.equal(report.truncated, true)
  assert.equal(report.runners.tool_loop.runs, 2)
})

test('startLegacyPersonalWorkflow creates a chat AgentRun without an engine marker', async () => {
  let received: Parameters<ActConversationRepository['startAgentRun']>[0] | undefined
  const repository = {
    async startAgentRun(args: Parameters<ActConversationRepository['startAgentRun']>[0]) {
      received = args
      return {
        id: `run_${args.variantIndex ?? 0}`,
        conversationId: args.conversationId,
        turnId: args.turnId,
        userId: args.userId,
        userMessageId: args.userMessageId,
        assistantMessageId: `msg_${args.variantIndex ?? 0}`,
        mode: args.mode,
        runner: args.runner,
        status: 'queued',
        variantIndex: args.variantIndex,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as unknown as AgentRun
    },
  } as unknown as ActConversationRepository
  const service = new AgentRunService(repository)

  const run0 = await service.startLegacyPersonalWorkflow({
    conversationId: 'conv_1' as never,
    modelId: 'model-a',
    turnId: 'turn_1',
    userId: 'user_1',
    userMessageId: 'msg_u1' as never,
  })
  assert.equal(received?.variantIndex, 0)
  assert.equal(received?.mode, 'chat')
  assert.equal(received?.runner, 'workflow')
  assert.equal(received?.executionEngine, undefined)
  assert.equal(run0?.id, 'run_0')
})

test('startPersonalWorkflow creates the Harness workflow as canonical chat', async () => {
  let received: Parameters<ActConversationRepository['startAgentRun']>[0] | undefined
  const repository = {
    async startAgentRun(args: Parameters<ActConversationRepository['startAgentRun']>[0]) {
      received = args
      return {
        id: 'run_chat',
        conversationId: args.conversationId,
        turnId: args.turnId,
        userId: args.userId,
        userMessageId: args.userMessageId,
        assistantMessageId: 'msg_chat',
        mode: args.mode,
        runner: args.runner,
        status: 'queued',
        variantIndex: args.variantIndex,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as unknown as AgentRun
    },
  } as unknown as ActConversationRepository
  const service = new AgentRunService(repository)

  await service.startPersonalWorkflow({
    conversationId: 'conv_1' as never,
    modelId: 'model-a',
    turnId: 'turn_1',
    userId: 'user_1',
    userMessageId: 'msg_u1' as never,
  })

  assert.deepEqual(
    {
      mode: received?.mode,
      runner: received?.runner,
      variantIndex: received?.variantIndex,
      executionEngine: received?.executionEngine,
    },
    { mode: 'chat', runner: 'workflow', variantIndex: 0, executionEngine: 'overlay_harness' },
  )
})

test('input and child waits resume through canonical AgentRun transitions', async () => {
  const transitions: Parameters<ActConversationRepository['transitionAgentRun']>[0][] = []
  const repository = {
    async transitionAgentRun(args: Parameters<ActConversationRepository['transitionAgentRun']>[0]) {
      transitions.push(args)
      return null
    },
  } as unknown as ActConversationRepository
  const service = new AgentRunService(repository)

  await service.waitForInput({ runId: 'run_1', userId: 'user_1', leaseExpiresAt: 100 })
  await service.waitForChildren({ runId: 'run_2', userId: 'user_1' })
  await service.resumeAfterWait({ runId: 'run_1', userId: 'user_1' })
  await service.resumeAfterApproval({ runId: 'run_2', userId: 'user_1' })

  assert.deepEqual(transitions, [
    { runId: 'run_1', userId: 'user_1', leaseExpiresAt: 100, status: 'waiting_for_input' },
    { runId: 'run_2', userId: 'user_1', status: 'waiting_for_children' },
    { runId: 'run_1', userId: 'user_1', status: 'running' },
    { runId: 'run_2', userId: 'user_1', status: 'running' },
  ])
})
