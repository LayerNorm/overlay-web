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
