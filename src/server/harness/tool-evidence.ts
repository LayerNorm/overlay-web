import type { WorkflowAgentToolExecutionEndEvent } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import type { HarnessEvidence } from '@overlay/agent-runtime/harness-state'
import { harnessToolInputDigest } from './tool-input-digest'

function hasFailureMarker(output: unknown, visited = new Set<object>(), depth = 0): boolean {
  if (!output || typeof output !== 'object') return false
  if (visited.has(output)) return false
  visited.add(output)
  const record = output as Record<string, unknown>
  if (record.success === false || typeof record.error === 'string' || typeof record.errorMessage === 'string') return true
  if (depth >= 8) return false
  return hasFailureMarker(record.display, visited, depth + 1)
    || hasFailureMarker(record.overlayModelOutput, visited, depth + 1)
}

export function isToolFailureOutput(output: unknown): boolean {
  return hasFailureMarker(output)
}

export function harnessToolResultEvidence(
  event: WorkflowAgentToolExecutionEndEvent<ToolSet>,
  now: number,
): HarnessEvidence {
  return harnessToolOutputEvidence({
    toolCallId: event.toolCall.toolCallId,
    toolName: event.toolCall.toolName,
    input: event.toolCall.input,
    output: event.output,
    success: event.success,
    error: event.error,
  }, now)
}

export function harnessToolOutputEvidence(args: {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  success: boolean
  error?: unknown
}, now: number): HarnessEvidence {
  const failure = !args.success || isToolFailureOutput(args.output)
  const value = args.success ? args.output : args.error instanceof Error ? args.error.message : args.error
  let summary = typeof value === 'string' ? value : ''
  if (typeof value !== 'string') {
    try {
      summary = JSON.stringify(value) ?? ''
    } catch (_error) {
      summary = String(value)
    }
  }
  return {
    id: `tool:${args.toolCallId}`,
    kind: 'tool_result',
    source: args.toolName,
    summary: (summary || (args.success ? 'Tool completed without an output.' : 'Tool failed.')).slice(0, 2_000),
    verdict: failure ? 'failed' : 'observed',
    createdAt: now,
    inputDigest: harnessToolInputDigest(args.toolName, args.input),
  }
}
