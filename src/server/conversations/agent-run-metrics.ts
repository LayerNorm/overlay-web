import 'server-only'

import type { StepResult, ToolSet } from 'ai'
import { getWorld } from 'workflow/runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import type { AgentRunMetrics } from '@/shared/agents/agent-run'

export async function calculateProviderCostMicros(args: {
  inputTokens: number
  modelId: string
  outputTokens: number
}): Promise<number | undefined> {
  const dollars = await calculateLanguageModelTokenCostOrNull(
    args.modelId,
    args.inputTokens,
    0,
    args.outputTokens,
  )
  return dollars === null ? undefined : Math.max(0, Math.round(dollars * 1_000_000))
}

export function summarizeAgentToolMetrics(steps: StepResult<ToolSet>[]): Pick<
  AgentRunMetrics,
  'toolCallCount' | 'toolSuccessCount' | 'toolFailureCount'
> {
  let toolCallCount = 0
  let toolSuccessCount = 0
  let toolFailureCount = 0
  for (const step of steps) {
    toolCallCount += step.toolCalls.length
    for (const part of step.content) {
      if (part.type === 'tool-result') toolSuccessCount += 1
      if (part.type === 'tool-error') toolFailureCount += 1
    }
  }
  return { toolCallCount, toolSuccessCount, toolFailureCount }
}

async function listAll<T>(load: (cursor?: string) => Promise<{
  data: T[]
  cursor: string | null
  hasMore: boolean
}>): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const result = await load(cursor)
    rows.push(...result.data)
    if (!result.hasMore || !result.cursor) break
    cursor = result.cursor
  }
  return rows
}

function serializedBytes(value: unknown): number {
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString()
    if (item instanceof Uint8Array) return Array.from(item)
    return item
  })
  return new TextEncoder().encode(json ?? '').byteLength
}

export async function observeWorkflowRunMetrics(workflowRunId: string): Promise<Pick<
  AgentRunMetrics,
  'workflowStepCount' | 'workflowRetryCount' | 'workflowObservedStorageBytes' | 'toolRetryCount'
>> {
  const world = getWorld()
  const [steps, events] = await Promise.all([
    listAll((cursor) => world.steps.list({
      runId: workflowRunId,
      pagination: { cursor, limit: 1_000, sortOrder: 'asc' },
      resolveData: 'all',
    })),
    listAll((cursor) => world.events.list({
      runId: workflowRunId,
      pagination: { cursor, limit: 1_000, sortOrder: 'asc' },
      resolveData: 'all',
    })),
  ])
  const retryEvents = events.filter((event) => event.eventType === 'step_retrying')
  const toolRetryCount = retryEvents.filter((event) =>
    event.eventData?.stepName?.includes('executePersonalChatWorkTool')).length
  return {
    workflowStepCount: steps.length,
    workflowRetryCount: retryEvents.length,
    workflowObservedStorageBytes: serializedBytes({ steps, events }),
    toolRetryCount,
  }
}
