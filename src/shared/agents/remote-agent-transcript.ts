import type { AgentRemoteEvent, AgentRemoteSessionStatus } from '@overlay/workspace-contracts'
import type { AgentRunStatus, AgentRunTerminalError } from './agent-run'
import { AGENT_AUTH_FAILURE_CODE } from './provider-accounts'

const AGENT_ACCOUNTS_SETTINGS_HREF = '/app/settings?section=agent-accounts'

export const REMOTE_AGENT_STATUS_PART_TYPE = 'data-remote-agent-status'
export const REMOTE_AGENT_REQUEST_PART_TYPE = 'data-remote-agent-request'
export const REMOTE_AGENT_PLAN_PART_TYPE = 'data-remote-agent-plan'
export const REMOTE_AGENT_DIFF_PART_TYPE = 'data-remote-agent-diff'
export const REMOTE_AGENT_TERMINAL_PART_TYPE = 'data-remote-agent-terminal'
export const REMOTE_AGENT_COMMANDS_PART_TYPE = 'data-remote-agent-commands'

export type RemoteAgentStatusPart = {
  type: typeof REMOTE_AGENT_STATUS_PART_TYPE
  data: {
    environmentName: string
    queueExpiresAt: number
    runId: string
    state: 'waiting' | 'running' | 'waiting_for_approval' | 'waiting_for_input' | 'recoverable' | 'completed' | 'failed' | 'cancelled'
    retryable?: boolean
    retryClass?: 'transient' | 'timeout' | 'host_offline' | 'permission' | 'fatal'
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
      parts = upsertStatusPart(parts, input, 'running')
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
    if (event.type === 'approval_requested' || event.type === 'elicitation_requested') {
      removeWaiting()
      const kind = event.type === 'approval_requested' ? 'permission' : 'elicitation'
      parts = upsertRequestPart(parts, {
        kind,
        requestKey: stringValue(event.payload.requestKey) ?? event.eventId,
        prompt: stringValue(event.payload.prompt) ?? (kind === 'permission' ? 'Permission requested' : 'Input requested'),
        options: Array.isArray(event.payload.options) ? event.payload.options : [],
        requestedSchema: objectValue(event.payload.requestedSchema),
        runId: input.runId,
        state: 'pending',
      })
      runStatus = 'waiting_for_approval'
      sessionStatus = kind === 'permission' ? 'waiting_for_approval' : 'waiting_for_input'
      parts = upsertStatusPart(parts, input, kind === 'permission' ? 'waiting_for_approval' : 'waiting_for_input')
      continue
    }
    if (event.type === 'plan') {
      removeWaiting()
      parts = upsertDataPart(parts, REMOTE_AGENT_PLAN_PART_TYPE, 'plan', { entries: event.payload.entries ?? [] })
      continue
    }
    if (event.type === 'commands_update') {
      const commands = Array.isArray(event.payload.commands) ? event.payload.commands : []
      parts = upsertDataPart(parts, REMOTE_AGENT_COMMANDS_PART_TYPE, 'available-commands', { commands })
      continue
    }
    if (event.type === 'diff') {
      removeWaiting()
      parts = upsertDataPart(parts, REMOTE_AGENT_DIFF_PART_TYPE, stringValue(event.payload.diffId) ?? event.eventId, event.payload)
      continue
    }
    if (event.type === 'terminal') {
      removeWaiting()
      parts = upsertDataPart(parts, REMOTE_AGENT_TERMINAL_PART_TYPE, stringValue(event.payload.terminalId) ?? event.eventId, event.payload)
      continue
    }
    if (event.type === 'artifact') {
      removeWaiting()
      const url = stringValue(event.payload.url)
      const name = stringValue(event.payload.name) ?? 'Agent artifact'
      const artifactId = stringValue(event.payload.uploadReference) ?? event.eventId
      const filePart = {
        type: 'file', url, fileName: name,
        mediaType: stringValue(event.payload.mediaType) ?? 'application/octet-stream',
        size: event.payload.size, sha256: event.payload.sha256, artifactId,
      }
      const index = parts.findIndex((part) => part.type === 'file' && part.artifactId === artifactId)
      if (index < 0) parts = [...parts, filePart]
      else {
        parts = [...parts]
        parts[index] = filePart
      }
      continue
    }
    if (event.type === 'completed') {
      removeWaiting()
      parts = closePendingRequestParts(parts, 'run_completed', event.occurredAt)
      parts = closeRunningRemoteToolParts(parts, 'completed', event.occurredAt)
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
      parts = closePendingRequestParts(parts, 'run_failed', event.occurredAt)
      parts = closeRunningRemoteToolParts(parts, 'failed', event.occurredAt)
      const message = stringValue(event.payload.message) ?? 'The connected agent failed.'
      terminalError = {
        code: stringValue(event.payload.code) ?? 'remote_agent_failed',
        message,
        retryable: event.payload.retryable === true,
      }
      if (terminalError.code === AGENT_AUTH_FAILURE_CODE) {
        // The agent's own text is a raw sign-in error; say what to do and link to it.
        content = `${message}\n\n[Open Agent accounts](${AGENT_ACCOUNTS_SETTINGS_HREF})`
      } else if (!content.trim()) content = message
      parts = replaceTextPart(parts, content)
      runStatus = 'failed'
      sessionStatus = 'failed'
      terminal = true
      const retryable = event.payload.retryable === true
      parts = upsertStatusPart(parts, input, retryable ? 'recoverable' : 'failed', {
        retryable,
        retryClass: retryable ? retryClass(event.payload.code) : 'fatal',
      })
      continue
    }
    if (event.type === 'cancelled') {
      removeWaiting()
      parts = closePendingRequestParts(parts, 'cancelled', event.occurredAt)
      parts = closeRunningRemoteToolParts(parts, 'cancelled', event.occurredAt)
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

function closePendingRequestParts(parts: Array<Record<string, unknown>>, decision: string, resolvedAt: number) {
  return parts.map((part) => {
    const data = objectValue(part.data)
    if (part.type !== REMOTE_AGENT_REQUEST_PART_TYPE || data?.state !== 'pending') return part
    return { ...part, data: { ...data, state: 'resolved', resolution: {
      decision, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt,
    } } }
  })
}

function closeRunningRemoteToolParts(
  parts: Array<Record<string, unknown>>,
  outcome: 'completed' | 'failed' | 'cancelled',
  resolvedAt: number,
) {
  return parts.map((part) => {
    const data = objectValue(part.data)
    if (part.type === REMOTE_AGENT_TERMINAL_PART_TYPE && data?.status === 'running') {
      return {
        ...part,
        data: {
          ...data,
          status: outcome === 'completed' ? 'completed' : 'failed',
          resolution: outcome,
          resolvedAt,
        },
      }
    }

    const invocation = objectValue(part.toolInvocation)
    if (
      part.type !== 'tool-invocation'
      || invocation?.toolName !== 'remote_action'
      || isTerminalToolState(invocation.state)
    ) return part

    const input = objectValue(invocation.toolInput)
    const title = stringValue(input?.title) ?? 'Remote action'
    return {
      ...part,
      toolInvocation: {
        ...invocation,
        state: outcome === 'completed' ? 'output-available' : 'output-error',
        toolOutput: {
          success: outcome === 'completed',
          status: outcome,
          title,
          resolvedAt,
        },
      },
    }
  })
}

function isTerminalToolState(value: unknown) {
  return value === 'output-available'
    || value === 'output-error'
    || value === 'output-denied'
    || value === 'result'
    || value === 'complete'
    || value === 'completed'
}

/**
 * The agent's text arrives as one growing string. Actions it took in between split it: text written before an action
 * stays where it was, and later text goes after that action, so the transcript reads in the order things happened.
 */
function replaceTextPart(parts: Array<Record<string, unknown>>, text: string) {
  const isText = (part: Record<string, unknown>) => part.type === 'text' || part.type === 'output-text'
  const lastAction = parts.reduce((found, part, index) => (part.type === 'tool-invocation' ? index : found), -1)
  // A text part followed by an action is finished; the unfinished one, if any, is the last text part after the last action.
  const finished = parts.filter((part, index) => isText(part) && index < lastAction)
  const consumedText = finished.map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
  // The agent rewrote text it had already placed: fall back to one block at the start rather than repeat or lose any.
  if (!text.startsWith(consumedText)) {
    const without = parts.filter((part) => !isText(part))
    return text ? [{ type: 'text', text }, ...without] : without
  }
  const rest = text.slice(consumedText.length)
  const openIndex = parts.findIndex((part, index) => isText(part) && index > lastAction)
  if (openIndex >= 0) {
    const next = [...parts]
    if (rest) next[openIndex] = { ...parts[openIndex]!, type: 'text', text: rest }
    else next.splice(openIndex, 1)
    return next
  }
  if (!rest) return parts
  // No text yet after the last action: it starts a new part there, or leads the message when there is no action yet.
  return lastAction < 0 ? [{ type: 'text', text: rest }, ...parts] : [...parts, { type: 'text', text: rest }]
}

/**
 * A title an agent gives an action that says nothing ("Tool call", or none at all). Agents often name an action when it
 * starts ("git clone https://…") and send only a status, with no title, when it ends.
 */
export function isGenericActionTitle(title: string | undefined): boolean {
  return !title || /^(tool( call)?|tool_call|action|remote action)$/i.test(title.trim())
}

function upsertActionPart(parts: Array<Record<string, unknown>>, payload: Record<string, unknown>) {
  const actionId = stringValue(payload.actionId) ?? 'remote-action'
  const index = parts.findIndex((candidate) => {
    const invocation = candidate.toolInvocation
    return candidate.type === 'tool-invocation'
      && invocation && typeof invocation === 'object'
      && (invocation as Record<string, unknown>).toolCallId === actionId
  })
  const earlier = index < 0 ? undefined : objectValue((parts[index]!.toolInvocation as Record<string, unknown>).toolInput)
  const incomingTitle = stringValue(payload.title)
  // An update that names nothing keeps the name the action started with, so a finished action reads like it did while it ran.
  const title = isGenericActionTitle(incomingTitle) && earlier && !isGenericActionTitle(stringValue(earlier.title))
    ? stringValue(earlier.title)!
    : incomingTitle ?? 'Remote action'
  const detail = stringValue(payload.detail) ?? stringValue(earlier?.detail)
  const status = stringValue(payload.status) ?? 'updated'
  const state = status === 'completed' || status === 'failed' ? 'output-available' : 'input-available'
  const part = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: actionId,
      toolName: 'remote_action',
      state,
      toolInput: { title, ...(detail ? { detail } : {}) },
      ...(status === 'completed' || status === 'failed'
        ? { toolOutput: { success: status === 'completed', status, title } }
        : {}),
    },
  }
  if (index < 0) return [...parts, part]
  const next = [...parts]
  next[index] = part
  return next
}

function upsertStatusPart(
  parts: Array<Record<string, unknown>>,
  input: { environmentName: string; queueExpiresAt: number; runId: string },
  state: RemoteAgentStatusPart['data']['state'],
  extra?: Pick<RemoteAgentStatusPart['data'], 'retryable' | 'retryClass'>,
) {
  const status: RemoteAgentStatusPart = {
    type: REMOTE_AGENT_STATUS_PART_TYPE,
    data: {
      environmentName: input.environmentName,
      queueExpiresAt: input.queueExpiresAt,
      runId: input.runId,
      state,
      ...extra,
    },
  }
  return [...parts.filter((part) => part.type !== REMOTE_AGENT_STATUS_PART_TYPE), status]
}

function upsertRequestPart(parts: Array<Record<string, unknown>>, data: Record<string, unknown>) {
  return upsertDataPart(parts, REMOTE_AGENT_REQUEST_PART_TYPE, String(data.requestKey), data)
}

function upsertDataPart(
  parts: Array<Record<string, unknown>>,
  type: string,
  key: string,
  data: Record<string, unknown>,
) {
  const part = { type, data: { ...data, key } }
  const index = parts.findIndex((candidate) => candidate.type === type
    && objectValue(candidate.data)?.key === key)
  if (index < 0) return [...parts, part]
  const next = [...parts]
  next[index] = part
  return next
}

export function resolveRemoteRequestPart(
  parts: Array<Record<string, unknown>>,
  requestKey: string,
  resolution: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) {
  return parts.map((part) => {
    if (part.type !== REMOTE_AGENT_REQUEST_PART_TYPE || objectValue(part.data)?.requestKey !== requestKey) return part
    return { ...part, data: { ...objectValue(part.data), state: 'resolved', resolution } }
  })
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function retryClass(code: unknown): RemoteAgentStatusPart['data']['retryClass'] {
  const normalized = String(code ?? '').toLowerCase()
  if (normalized.includes('timeout') || normalized.includes('lease')) return 'timeout'
  if (normalized.includes('offline') || normalized.includes('connection') || normalized.includes('host')) return 'host_offline'
  if (normalized.includes('permission') || normalized.includes('approval')) return 'permission'
  return 'transient'
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
