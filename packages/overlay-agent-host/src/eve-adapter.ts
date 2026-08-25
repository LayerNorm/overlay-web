import { Client, type ClientSession, type InputRequest, type InputResponse, type MessageResponse, type MessageStreamEvent } from 'eve/client'
import type { AgentAdapter, AgentAdapterSession, EmitAgentEvent, StartAdapterSessionInput } from './adapter'

type EveSessionLike = Pick<ClientSession, 'state' | 'send' | 'respond' | 'cancel' | 'stream'>
type EveResponseLike = Pick<MessageResponse, 'cancel'> & AsyncIterable<MessageStreamEvent>
type EveClientLike = {
  sessions: {
    create(input: { message: string }): Promise<{ session: EveSessionLike; response: EveResponseLike }>
    attach(sessionId: string, options?: { streamIndex?: number }): EveSessionLike
  }
}

export type EveAgentAdapterOptions = {
  id?: string
  displayName?: string
  host: string
  bearerToken?: string | (() => string | Promise<string>)
  clientFactory?: () => EveClientLike
}

type PendingRequest = Pick<InputRequest, 'kind' | 'options' | 'allowFreeform'>
type PersistedEveState = {
  sessionId: string
  streamIndex: number
  pendingRequests: Array<[string, PendingRequest]>
  requestBatches: Array<[string, readonly string[]]>
  pendingResponses: Array<[string, InputResponse]>
}

/**
 * A deliberately narrow bridge over Eve's supported client/session surface.
 * Overlay remains authoritative for commands, approvals, transcript projection,
 * billing, and audit; the Eve service owns only its durable agent session.
 */
export class EveAgentAdapter implements AgentAdapter {
  readonly capability
  private readonly createClient: () => EveClientLike

  constructor(private readonly options: EveAgentAdapterOptions) {
    this.capability = {
      id: options.id ?? 'eve',
      displayName: options.displayName ?? 'Eve agent',
      protocol: 'eve' as const,
      version: '0.44',
      supports: { prompt: true, approval: true, cancel: true, resume: true },
    }
    this.createClient = options.clientFactory ?? (() => new Client({
      host: options.host,
      ...(options.bearerToken ? { auth: { bearer: options.bearerToken } } : {}),
      redirect: 'error',
    }))
  }

  async discover() { return this.capability }

  async start(input: StartAdapterSessionInput, emit: EmitAgentEvent): Promise<AgentAdapterSession> {
    const client = this.createClient()
    const persisted = parsePersistedState(input.adapterState)
    if (input.remoteSessionId && (!persisted || persisted.sessionId !== input.remoteSessionId)) {
      throw new Error('Eve reconnect requires the persisted durable stream cursor; start fresh to create a new session')
    }

    const pending = new Map<string, PendingRequest>(persisted?.pendingRequests ?? [])
    const requestBatch = new Map<string, readonly string[]>(persisted?.requestBatches ?? [])
    const pendingResponses = new Map<string, InputResponse>(persisted?.pendingResponses ?? [])

    let session: EveSessionLike
    let initialResponse: EveResponseLike | undefined
    if (input.remoteSessionId) {
      session = client.sessions.attach(input.remoteSessionId, { streamIndex: persisted!.streamIndex })
    } else {
      const created = await client.sessions.create({ message: input.prompt })
      session = created.session
      initialResponse = created.response
      persistSessionState(input, session, pending, requestBatch, pendingResponses)
    }

    const textByStep = new Map<number, string>()
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }
    let activeResponse: EveResponseLike | undefined

    const consume = async (response: AsyncIterable<MessageStreamEvent>) => {
      activeResponse = 'cancel' in response ? response as EveResponseLike : undefined
      try {
        for await (const event of response) {
          await projectEveEvent(event, emit, pending, requestBatch, textByStep, usage)
          persistSessionState(input, session, pending, requestBatch, pendingResponses)
          if (isTurnBoundary(event)) break
        }
      } finally {
        activeResponse = undefined
        persistSessionState(input, session, pending, requestBatch, pendingResponses)
      }
    }

    const recordResponse = async (value: InputResponse) => {
      pendingResponses.set(value.requestId, value)
      const batch = requestBatch.get(value.requestId) ?? [value.requestId]
      persistSessionState(input, session, pending, requestBatch, pendingResponses)
      if (!batch.every((requestId) => pendingResponses.has(requestId))) return
      const responses = batch.map((requestId) => pendingResponses.get(requestId)!)
      const response = await session.respond(responses)
      for (const resolved of responses) {
        pending.delete(resolved.requestId)
        pendingResponses.delete(resolved.requestId)
        requestBatch.delete(resolved.requestId)
      }
      persistSessionState(input, session, pending, requestBatch, pendingResponses)
      await consume(response)
    }

    return {
      remoteSessionId: session.state.sessionId,
      prompt: async (prompt) => {
        const response = initialResponse ?? await session.send(prompt)
        initialResponse = undefined
        await consume(response)
      },
      approve: async (requestKey, optionId) => {
        const request = requirePending(pending, requestKey)
        if (request.kind === 'question') throw new Error('Eve question must be resolved as an elicitation')
        if (!request.options?.some((option) => option.id === optionId)) throw new Error('Eve approval option does not match the pending request')
        await recordResponse({ requestId: requestKey, optionId })
      },
      elicit: async (requestKey, action, content) => {
        const request = requirePending(pending, requestKey)
        if (request.kind !== 'question') throw new Error('Eve approval must be resolved through the approval path')
        if (action !== 'accept') {
          await recordResponse({ requestId: requestKey })
          return
        }
        const optionId = typeof content?.optionId === 'string' ? content.optionId : undefined
        const text = typeof content?.text === 'string' ? content.text : undefined
        if (optionId && !request.options?.some((option) => option.id === optionId)) throw new Error('Eve elicitation option does not match the pending request')
        if (!optionId && (!text || !request.allowFreeform)) throw new Error('Eve elicitation response does not match the pending request')
        await recordResponse({ requestId: requestKey, ...(optionId ? { optionId } : {}), ...(text ? { text } : {}) })
      },
      cancel: async () => {
        if (activeResponse) await activeResponse.cancel()
        else await session.cancel()
      },
      resume: async () => { await consume(session.stream()) },
      stop: async () => {
        if (activeResponse) await activeResponse.cancel()
        else await session.cancel()
      },
    }
  }
}

function parsePersistedState(value: Record<string, unknown> | undefined): PersistedEveState | undefined {
  if (!value) return undefined
  if (typeof value.sessionId !== 'string' || !Number.isInteger(value.streamIndex) || Number(value.streamIndex) < 0) {
    throw new Error('persisted Eve session state is invalid')
  }
  return {
    sessionId: value.sessionId,
    streamIndex: Number(value.streamIndex),
    pendingRequests: parseEntries<PendingRequest>(value.pendingRequests),
    requestBatches: parseEntries<readonly string[]>(value.requestBatches),
    pendingResponses: parseEntries<InputResponse>(value.pendingResponses),
  }
}

function persistSessionState(
  input: StartAdapterSessionInput,
  session: EveSessionLike,
  pending: Map<string, PendingRequest>,
  requestBatch: Map<string, readonly string[]>,
  pendingResponses: Map<string, InputResponse>,
): void {
  input.persistAdapterState?.({
    sessionId: session.state.sessionId,
    streamIndex: session.state.streamIndex,
    pendingRequests: [...pending],
    requestBatches: [...requestBatch],
    pendingResponses: [...pendingResponses],
  })
}

function parseEntries<Value>(value: unknown): Array<[string, Value]> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')) {
    throw new Error('persisted Eve pending-input state is invalid')
  }
  return value as Array<[string, Value]>
}

function requirePending(pending: Map<string, PendingRequest>, requestKey: string): PendingRequest {
  const request = pending.get(requestKey)
  if (!request) throw new Error('Eve input request is no longer pending')
  return request
}

async function projectEveEvent(
  event: MessageStreamEvent,
  emit: EmitAgentEvent,
  pending: Map<string, PendingRequest>,
  requestBatch: Map<string, readonly string[]>,
  textByStep: Map<number, string>,
  usage: Record<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'costUsd', number>,
): Promise<void> {
  if (event.type === 'message.appended') {
    textByStep.set(event.data.stepIndex, event.data.messageSoFar)
    await emit({ type: 'text_checkpoint', payload: { text: orderedText(textByStep) } })
  } else if (event.type === 'message.completed') {
    if (event.data.message !== null) textByStep.set(event.data.stepIndex, event.data.message)
    await emit({ type: 'text_checkpoint', payload: { text: orderedText(textByStep), final: event.data.finishReason !== 'tool-calls' } })
  } else if (event.type === 'actions.requested') {
    for (const action of event.data.actions) {
      await emit({ type: 'action', payload: { actionId: action.callId, title: actionTitle(action), status: 'started', detail: safeDetail(action.input) } })
    }
  } else if (event.type === 'action.partial') {
    await emit({ type: 'action', payload: { actionId: event.data.result.callId, title: actionResultTitle(event.data.result), status: 'updated', detail: safeDetail(event.data.result.output) } })
  } else if (event.type === 'action.result') {
    await emit({ type: 'action', payload: {
      actionId: event.data.result.callId,
      title: actionResultTitle(event.data.result),
      status: event.data.status === 'failed' ? 'failed' : 'completed',
      detail: event.data.error?.message ?? safeDetail(event.data.result.output),
    } })
  } else if (event.type === 'input.requested') {
    const batch = event.data.requests.map((request) => request.requestId)
    for (const request of event.data.requests) {
      pending.set(request.requestId, request)
      requestBatch.set(request.requestId, batch)
      if (request.kind === 'question') {
        await emit({ type: 'elicitation_requested', payload: {
          requestKey: request.requestId,
          prompt: request.prompt,
          requestedSchema: {
            type: 'object',
            properties: {
              ...(request.options ? { optionId: { type: 'string', enum: request.options.map((option) => option.id) } } : {}),
              ...(request.allowFreeform ? { text: { type: 'string' } } : {}),
            },
          },
          context: { kind: request.kind, options: request.options ?? [], allowFreeform: request.allowFreeform ?? false },
        } })
      } else {
        const options = request.options?.length ? request.options : [
          { id: 'approve', label: 'Approve' },
          { id: 'deny', label: 'Deny' },
        ]
        await emit({ type: 'approval_requested', payload: {
          requestKey: request.requestId,
          prompt: request.prompt,
          options: options.map((option) => ({ id: option.id, label: option.label })),
          context: { kind: request.kind, action: request.action },
        } })
      }
    }
  } else if (event.type === 'input.resolved') {
    for (const resolution of event.data.resolutions) {
      pending.delete(resolution.requestId)
      requestBatch.delete(resolution.requestId)
    }
  } else if (event.type === 'step.completed' && event.data.usage) {
    for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] += event.data.usage[key] ?? 0
  } else if (event.type === 'turn.completed') {
    await emit({ type: 'completed', payload: { summary: 'Eve turn completed', usage: { ...usage } } })
  } else if (event.type === 'turn.cancelled') {
    await emit({ type: 'cancelled', payload: {} })
  } else if (event.type === 'turn.failed' || event.type === 'session.failed') {
    await emit({ type: 'failed', payload: { code: event.data.code, message: event.data.message, retryable: false } })
  }
  // Deliberately do not project Eve reasoning events into Overlay.
}

function orderedText(textByStep: Map<number, string>): string {
  return [...textByStep.entries()].sort(([left], [right]) => left - right).map(([, value]) => value).filter(Boolean).join('\n\n')
}

function actionTitle(action: { kind: string; toolName?: string; name?: string; subagentName?: string; remoteAgentName?: string }): string {
  if (action.kind === 'tool-call') return action.toolName ?? 'Tool'
  if (action.kind === 'load-skill') return 'Load skill'
  return action.name ?? action.subagentName ?? action.remoteAgentName ?? 'Agent action'
}

function actionResultTitle(result: { kind: string; toolName?: string; name?: string; subagentName?: string }): string {
  return result.toolName ?? result.name ?? result.subagentName ?? (result.kind === 'load-skill-result' ? 'Load skill' : 'Agent action')
}

function safeDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return detail.slice(0, 20_000)
}

function isTurnBoundary(event: MessageStreamEvent): boolean {
  return event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.cancelled' || event.type === 'session.failed' || event.type === 'session.completed' || event.type === 'session.waiting'
}
