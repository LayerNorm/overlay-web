import type { AgentRemoteEvent, AgentRemoteSessionStatus } from '@overlay/workspace-contracts'
import type { AgentRunStatus, AgentRunTerminalError } from './agent-run'

export const REMOTE_AGENT_STATUS_PART_TYPE = 'data-remote-agent-status'

export type RemoteAgentStatusPart = {
  type: typeof REMOTE_AGENT_STATUS_PART_TYPE
  data: {
    environmentName: string
    queueExpiresAt: number
    runId: string
    state: 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled'
  }
}

export type RemoteAgentProjection = {
  content: string
  parts: Array<Record<string, unknown>>
  remoteSessionId?: string
  runStatus: AgentRunStatus
  sessionStatus: AgentRemoteSessionStatus
  terminalError?: AgentRunTerminalError
  terminal: boolean
  tokens: { input: number; output: number }
}

export function waitingRemoteAgentParts(input: {
  environmentName: string
  queueExpiresAt: number
  runId: string
}): Array<Record<string, unknown>> {
  return [
    { type: 'text', text: `Waiting for ${input.environmentName}` },
    {
      type: REMOTE_AGENT_STATUS_PART_TYPE,
      data: { ...input, state: 'waiting' },
    } satisfies RemoteAgentStatusPart,
  ]
}

export function projectRemoteAgentEvents(input: {
  content: string
  parts?: Array<Record<string, unknown>>
  events: AgentRemoteEvent[]
  environmentName: string
  queueExpiresAt: number
  runId: string
}): RemoteAgentProjection {
  let content = input.content
  let parts = [...(input.parts ?? [])]
  let runStatus: AgentRunStatus = 'running'
  let sessionStatus: AgentRemoteSessionStatus = 'running'
  let remoteSessionId: string | undefined
  let terminalError: AgentRunTerminalError | undefined
  let terminal = false
  let tokens = { input: 0, output: 0 }

  const removeWaiting = () => {
    parts = parts.filter((part) => part.type !== REMOTE_AGENT_STATUS_PART_TYPE)
    if (content === `Waiting for ${input.environmentName}`) content = ''
    parts = parts.filter((part) => !(
      part.type === 'text' && part.text === `Waiting for ${input.environmentName}`
    ))
  }

  for (const event of input.events) {
    if (event.type === 'session_started') {
      removeWaiting()
      remoteSessionId = stringValue(event.payload.remoteSessionId)
      continue
    }
    if (event.type === 'text_checkpoint') {
      removeWaiting()
      content = stringValue(event.payload.text) ?? content
      parts = replaceTextPart(parts, content)
      continue
    }
    if (event.type === 'action') {
      removeWaiting()
      parts = upsertActionPart(parts, event.payload)
      continue
    }
    if (event.type === 'completed') {
      removeWaiting()
      const summary = stringValue(event.payload.summary)
      if (!content.trim() && summary) {
        content = summary
        parts = replaceTextPart(parts, content)
      }
      tokens = usageTokens(event.payload.usage)
      runStatus = 'completed'
      sessionStatus = 'completed'
      terminal = true
      parts = upsertStatusPart(parts, input, 'completed')
      continue
    }
    if (event.type === 'failed') {
      removeWaiting()
      const message = stringValue(event.payload.message) ?? 'The connected agent failed.'
      terminalError = {
        code: stringValue(event.payload.code) ?? 'remote_agent_failed',
        message,
        retryable: event.payload.retryable === true,
      }
      if (!content.trim()) content = message
      parts = replaceTextPart(parts, content)
      runStatus = 'failed'
      sessionStatus = 'failed'
      terminal = true
      parts = upsertStatusPart(parts, input, 'failed')
      continue
    }
    if (event.type === 'cancelled') {
      removeWaiting()
      if (!content.trim()) content = stringValue(event.payload.reason) ?? 'Cancelled'
      parts = replaceTextPart(parts, content)
      runStatus = 'cancelled'
      sessionStatus = 'cancelled'
      terminal = true
      parts = upsertStatusPart(parts, input, 'cancelled')
    }
  }

  return {
    content,
    parts,
    ...(remoteSessionId ? { remoteSessionId } : {}),
    runStatus,
    sessionStatus,
    ...(terminalError ? { terminalError } : {}),
    terminal,
    tokens,
  }
}

function replaceTextPart(parts: Array<Record<string, unknown>>, text: string) {
  const next = parts.filter((part) => part.type !== 'text' && part.type !== 'output-text')
  if (text) next.unshift({ type: 'text', text })
  return next
}

function upsertActionPart(parts: Array<Record<string, unknown>>, payload: Record<string, unknown>) {
  const actionId = stringValue(payload.actionId) ?? 'remote-action'
  const title = stringValue(payload.title) ?? 'Remote action'
  const status = stringValue(payload.status) ?? 'updated'
  const state = status === 'completed' || status === 'failed' ? 'output-available' : 'input-available'
  const part = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: actionId,
      toolName: 'remote_action',
      state,
      toolInput: { title, ...(stringValue(payload.detail) ? { detail: stringValue(payload.detail) } : {}) },
      ...(status === 'completed' || status === 'failed'
        ? { toolOutput: { success: status === 'completed', status, title } }
        : {}),
    },
  }
  const index = parts.findIndex((candidate) => {
    const invocation = candidate.toolInvocation
    return candidate.type === 'tool-invocation'
      && invocation && typeof invocation === 'object'
      && (invocation as Record<string, unknown>).toolCallId === actionId
  })
  if (index < 0) return [...parts, part]
  const next = [...parts]
  next[index] = part
  return next
}

function upsertStatusPart(
  parts: Array<Record<string, unknown>>,
  input: { environmentName: string; queueExpiresAt: number; runId: string },
  state: RemoteAgentStatusPart['data']['state'],
) {
  const status: RemoteAgentStatusPart = {
    type: REMOTE_AGENT_STATUS_PART_TYPE,
    data: {
      environmentName: input.environmentName,
      queueExpiresAt: input.queueExpiresAt,
      runId: input.runId,
      state,
    },
  }
  return [...parts.filter((part) => part.type !== REMOTE_AGENT_STATUS_PART_TYPE), status]
}

function usageTokens(value: unknown) {
  if (!value || typeof value !== 'object') return { input: 0, output: 0 }
  const usage = value as Record<string, unknown>
  return {
    input: nonNegativeInteger(usage.inputTokens ?? usage.input_tokens),
    output: nonNegativeInteger(usage.outputTokens ?? usage.output_tokens),
  }
}

function nonNegativeInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
