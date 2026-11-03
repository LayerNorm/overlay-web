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
  const normalized = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).display ?? (value as Record<string, unknown>).overlayModelOutput ?? value
    : value
  const summary = summarizeWithoutBinary(normalized)
  const resource = findResourceIdentity(args.output)
  return {
    id: `tool:${args.toolCallId}`,
    kind: 'tool_result',
    source: args.toolName,
    summary: (summary || (args.success ? 'Tool completed without an output.' : 'Tool failed.')).slice(0, 2_000),
    verdict: failure ? 'failed' : 'observed',
    createdAt: now,
    inputDigest: harnessToolInputDigest(args.toolName, args.input),
    ...(resource ? { resource } : {}),
  }
}

function summarizeWithoutBinary(value: unknown): string {
  const visit = (current: unknown): unknown => {
    if (current instanceof Uint8Array) return '[binary content omitted]'
    if (typeof current === 'string') {
      if (current.startsWith('data:')) return '[binary content omitted]'
      return current
    }
    if (Array.isArray(current)) return current.map(visit)
    if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>
      return Object.fromEntries(Object.entries(record).map(([key, item]) => [
        key,
        ['data', 'image', 'bytes', 'base64'].includes(key.toLowerCase())
          ? '[binary content omitted]' : visit(item),
      ]))
    }
    return current
  }
  try { return JSON.stringify(visit(value)) ?? '' } catch (_error) { return 'Tool output could not be normalized.' }
}

export function findResourceIdentity(value: unknown): HarnessEvidence['resource'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = [record.resourceId, record.fileId, record.documentId, record.id]
    .find(candidate => typeof candidate === 'string' && candidate.length > 0)
  const nested = id ? undefined : Object.values(record).map(findResourceIdentity).find(Boolean)
  if (!id) return nested
  return {
    id: id as string,
    ...(typeof (record.revision ?? record.sourceRevision) === 'string'
      ? { revision: (record.revision ?? record.sourceRevision) as string } : {}),
    ...(typeof record.operation === 'string' ? { operation: record.operation } : {}),
    ...(typeof record.page === 'number' ? { page: record.page } : {}),
  }
}
