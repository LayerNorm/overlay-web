import type { WorkflowAgentToolExecutionEndEvent } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import type { HarnessEvidence } from '@overlay/agent-runtime/harness-state'
import { harnessToolInputDigest } from './tool-input-digest'
import { documentReadEvidenceValue } from './file-analysis-coverage'

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
  const documentValue = args.toolName === 'read_document'
    ? documentReadEvidenceValue(normalized, args.input, failure) : undefined
  const summary = summarizeWithoutBinary(documentValue ?? normalized)
  const outputResource = findResourceIdentity(args.output)
  const inputResource = findResourceIdentity(args.input)
  const original = outputResource ?? inputResource
  const resource = original ? {
    ...original,
    operation: original.operation ?? args.toolName,
    ...(original.page === undefined && inputResource?.id === original.id && inputResource.page !== undefined
      ? { page: inputResource.page } : {}),
  } : undefined
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

export function findResourceIdentity(value: unknown, depth = 0): HarnessEvidence['resource'] | undefined {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array || depth > 8) return undefined
  const record = value as Record<string, unknown>
  const typedId = ['file', 'note', 'upload', 'output'].includes(String(record.kind ?? record.type))
    || typeof record.sourceRevision === 'string' ? record.id : undefined
  const id = [record.resourceId, record.fileId, record.documentId, record.noteId, typedId]
    .find(candidate => typeof candidate === 'string' && candidate.length > 0)
  if (!id && record.type === 'text' && typeof record.text === 'string' && record.text.length <= 64_000) {
    try {
      const nested = findResourceIdentity(JSON.parse(record.text), depth + 1)
      if (nested) return nested
    } catch (_error) { /* Ordinary text is not a structured resource. */ }
  }
  const nested = id ? undefined : Object.entries(record)
    .filter(([key]) => !['data', 'image', 'bytes', 'base64'].includes(key))
    .map(([, entry]) => findResourceIdentity(entry, depth + 1)).find(Boolean)
  if (!id) return nested
  return {
    id: id as string,
    ...(typeof (record.revision ?? record.sourceRevision) === 'string'
      ? { revision: (record.revision ?? record.sourceRevision) as string } : {}),
    ...(typeof record.operation === 'string' ? { operation: record.operation } : {}),
    ...(typeof record.page === 'number' ? { page: record.page } : {}),
  }
}
