export const MAX_PERSISTED_TOOL_ERROR_CHARS = 4_000

export type ToolOutcomeState =
  | 'output-available'
  | 'output-error'
  | 'output-denied'
  | 'pending'

export type ResolvedToolOutcome = {
  state: ToolOutcomeState
  hasOutput: boolean
  output?: unknown
  error?: string
  providerExecuted?: boolean
  approvalId?: string
  approvalStatus?: 'requested' | 'approved' | 'denied'
  approvalReason?: string
}

type ToolRecord = Record<string, unknown>

function asRecord(value: unknown): ToolRecord | null {
  return value !== null && typeof value === 'object' ? value as ToolRecord : null
}

function hasOwn(value: ToolRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function boundedToolError(error: unknown, fallback = 'The tool did not complete successfully.'): string {
  const record = asRecord(error)
  const message = record && typeof record.message === 'string'
    ? record.message
    : typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error == null
          ? fallback
          : String(error)
  const trimmed = message.trim() || fallback
  if (trimmed.length <= MAX_PERSISTED_TOOL_ERROR_CHARS) return trimmed
  const suffix = ' [truncated]'
  return `${trimmed.slice(0, MAX_PERSISTED_TOOL_ERROR_CHARS - suffix.length).trimEnd()}${suffix}`
}

export function toolFailureOutput(error: unknown, fallback?: string): { success: false; error: string } {
  return {
    success: false,
    error: boundedToolError(error, fallback),
  }
}

function readToolCall(value: unknown): (ToolRecord & { toolCallId: string; toolName: string }) | null {
  const record = asRecord(value)
  if (!record || typeof record.toolCallId !== 'string' || typeof record.toolName !== 'string') return null
  return record as ToolRecord & { toolCallId: string; toolName: string }
}

function readApprovalCall(value: unknown): ToolRecord | null {
  const record = asRecord(value)
  const toolCall = record && asRecord(record.toolCall)
  return toolCall ? toolCall : null
}

function isFailureOutput(output: unknown): boolean {
  const record = asRecord(output)
  return Boolean(
    record
    && (
      record.success === false
      || (hasOwn(record, 'error') && record.error !== undefined)
      || (hasOwn(record, 'errorMessage') && record.errorMessage !== undefined)
    ),
  )
}

function readOutputError(output: unknown): string | undefined {
  const record = asRecord(output)
  if (!record) return undefined
  if (record.error !== undefined) return boundedToolError(record.error)
  if (record.errorMessage !== undefined) return boundedToolError(record.errorMessage)
  if (record.success === false) return 'The tool returned success:false.'
  return undefined
}

function mergeOutcome(
  current: ResolvedToolOutcome | undefined,
  next: ResolvedToolOutcome,
): ResolvedToolOutcome {
  return {
    ...current,
    ...next,
    ...(next.approvalId === undefined && current?.approvalId
      ? { approvalId: current.approvalId }
      : {}),
    ...(next.approvalStatus === undefined && current?.approvalStatus
      ? { approvalStatus: current.approvalStatus }
      : {}),
    ...(next.approvalReason === undefined && current?.approvalReason
      ? { approvalReason: current.approvalReason }
      : {}),
  }
}

/**
 * Resolves SDK convenience fields and ordered content into one terminal outcome
 * per tool call. The SDK intentionally excludes tool errors from toolResults,
 * so content is the authoritative source for those failures.
 */
export function resolveToolOutcomes(
  steps: readonly { toolCalls?: readonly unknown[]; toolResults?: readonly unknown[]; content?: readonly unknown[] }[],
): ReadonlyMap<string, ResolvedToolOutcome> {
  const calls = new Map<string, ToolRecord>()
  const outcomes = new Map<string, ResolvedToolOutcome>()

  const rememberCall = (value: unknown) => {
    const call = readToolCall(value)
    if (!call) return
    calls.set(call.toolCallId, call)
    if (call.invalid === true) {
      outcomes.set(call.toolCallId, mergeOutcome(outcomes.get(call.toolCallId), {
        state: 'output-error',
        hasOutput: true,
        output: toolFailureOutput(call.error, 'The model produced an invalid tool call.'),
        error: boundedToolError(call.error, 'The model produced an invalid tool call.'),
        providerExecuted: call.providerExecuted === true,
      }))
    }
  }

  const rememberResult = (value: unknown) => {
    const result = asRecord(value)
    if (!result || typeof result.toolCallId !== 'string') return
    const output = hasOwn(result, 'output')
      ? result.output
      : hasOwn(result, 'result')
        ? result.result
        : result
    const failed = isFailureOutput(output)
    outcomes.set(result.toolCallId, mergeOutcome(outcomes.get(result.toolCallId), {
      state: failed ? 'output-error' : 'output-available',
      hasOutput: true,
      output: failed ? toolFailureOutput(readOutputError(output)) : output,
      ...(failed ? { error: readOutputError(output) } : {}),
      ...(result.providerExecuted === true ? { providerExecuted: true } : {}),
    }))
  }

  const rememberError = (value: unknown) => {
    const error = asRecord(value)
    if (!error || typeof error.toolCallId !== 'string') return
    const message = boundedToolError(error.error)
    outcomes.set(error.toolCallId, mergeOutcome(outcomes.get(error.toolCallId), {
      state: 'output-error',
      hasOutput: true,
      output: toolFailureOutput(error.error),
      error: message,
      ...(error.providerExecuted === true ? { providerExecuted: true } : {}),
    }))
  }

  const rememberApproval = (value: unknown) => {
    const approval = asRecord(value)
    const call = readToolCall(readApprovalCall(value))
    if (!approval || !call || typeof approval.approvalId !== 'string') return
    const approved = approval.type === 'tool-approval-response'
      ? approval.approved === true
      : undefined
    const denied = approved === false
    outcomes.set(call.toolCallId, mergeOutcome(outcomes.get(call.toolCallId), {
      state: denied ? 'output-denied' : 'pending',
      hasOutput: denied,
      ...(denied ? { output: toolFailureOutput(approval.reason, 'Tool approval was denied.') } : {}),
      ...(denied ? { error: boundedToolError(approval.reason, 'Tool approval was denied.') } : {}),
      ...(call.providerExecuted === true ? { providerExecuted: true } : {}),
      approvalId: approval.approvalId,
      approvalStatus: approval.type === 'tool-approval-request'
        ? 'requested'
        : approved
          ? 'approved'
          : 'denied',
      ...(typeof approval.reason === 'string' ? { approvalReason: approval.reason } : {}),
    }))
    calls.set(call.toolCallId, call)
  }

  for (const step of steps) {
    for (const call of step.toolCalls ?? []) rememberCall(call)
    for (const result of step.toolResults ?? []) rememberResult(result)
    for (const part of step.content ?? []) {
      const record = asRecord(part)
      if (!record) continue
      if (record.type === 'tool-call') rememberCall(record)
      else if (record.type === 'tool-result') rememberResult(record)
      else if (record.type === 'tool-error') rememberError(record)
      else if (record.type === 'tool-approval-request' || record.type === 'tool-approval-response') {
        rememberApproval(record)
      }
    }
  }

  for (const [toolCallId, call] of calls) {
    if (outcomes.has(toolCallId) || call.providerExecuted === true) continue
    outcomes.set(toolCallId, {
      state: 'output-error',
      hasOutput: true,
      output: toolFailureOutput(undefined, 'The tool call ended without an execution result.'),
      error: 'The tool call ended without an execution result.',
    })
  }

  return outcomes
}
