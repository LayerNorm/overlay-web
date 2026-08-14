import {
  DefaultChatTransport,
  type ChatTransport,
  type HttpChatTransportInitOptions,
  type UIMessage,
} from 'ai'
import {
  isTtftClientDebugEnabled,
  markTtftClientMilestone,
  wrapUiMessageStreamForTtft,
} from '@/shared/chat/ttft-client-debug'

type ChatBody = object | undefined
type ChatFetch = NonNullable<HttpChatTransportInitOptions<UIMessage>['fetch']>

type ChatErrorPayload = {
  code?: unknown
  error?: unknown
  fallbackSafe?: unknown
  message?: unknown
  phase?: unknown
  requestId?: unknown
}

export class ChatTransportHttpError extends Error {
  readonly endpoint: string
  readonly fallbackSafe: boolean | null
  readonly phase: string | null
  readonly requestId: string | null
  readonly status: number

  constructor(params: {
    endpoint: string
    fallbackSafe: boolean | null
    message: string
    phase: string | null
    requestId: string | null
    status: number
  }) {
    super(params.message)
    this.name = 'ChatTransportHttpError'
    this.endpoint = params.endpoint
    this.fallbackSafe = params.fallbackSafe
    this.phase = params.phase
    this.requestId = params.requestId
    this.status = params.status
  }
}

function requestEndpoint(input: Parameters<ChatFetch>[0]): string {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
  try {
    return new URL(raw, 'https://overlay.invalid').pathname
  } catch {
    return raw.split('?')[0] ?? raw
  }
}

function requestHeader(init: Parameters<ChatFetch>[1], name: string): string | null {
  return new Headers(init?.headers).get(name)
}

function parseErrorPayload(text: string): ChatErrorPayload {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as ChatErrorPayload : {}
  } catch {
    return {}
  }
}

function errorMessage(payload: ChatErrorPayload, response: Response): string {
  const value = typeof payload.error === 'string'
    ? payload.error
    : typeof payload.message === 'string'
      ? payload.message
      : ''
  return value.trim().slice(0, 500)
    || `Chat request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`
}

export function createChatDiagnosticFetch(fetchImpl?: ChatFetch): ChatFetch {
  return async (input, init) => {
    const startedAt = performance.now()
    const endpoint = requestEndpoint(input)
    const requestId = requestHeader(init, 'x-request-id')
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(input, init)
      if (response.ok) return response

      const text = await response.clone().text().catch(() => '')
      const payload = parseErrorPayload(text)
      const responseRequestId = response.headers.get('x-request-id')
      const resolvedRequestId =
        (typeof payload.requestId === 'string' ? payload.requestId : null)
        ?? responseRequestId
        ?? requestId
      const fallbackSafe = typeof payload.fallbackSafe === 'boolean' ? payload.fallbackSafe : null
      const phase = typeof payload.phase === 'string' ? payload.phase : null
      const message = errorMessage(payload, response)

      console.error('[chat-stream] http error', {
        endpoint,
        status: response.status,
        statusText: response.statusText || undefined,
        phase,
        fallbackSafe,
        requestId: resolvedRequestId,
        errorCode: typeof payload.code === 'string' ? payload.code : undefined,
        message,
        cfRay: response.headers.get('cf-ray') ?? undefined,
        vercelId: response.headers.get('x-vercel-id') ?? undefined,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      throw new ChatTransportHttpError({
        endpoint,
        fallbackSafe,
        message,
        phase,
        requestId: resolvedRequestId,
        status: response.status,
      })
    } catch (error) {
      if (error instanceof ChatTransportHttpError) throw error
      console.error('[chat-stream] network error', {
        endpoint,
        requestId,
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      throw error
    }
  }
}

function streamLogFields(body: ChatBody): Record<string, unknown> {
  const record = body as Record<string, unknown> | undefined
  return {
    conversationId: typeof record?.conversationId === 'string' ? record.conversationId : undefined,
    turnId: typeof record?.turnId === 'string' ? record.turnId : undefined,
    mode: typeof record?.mode === 'string' ? record.mode : undefined,
    automationMode: typeof record?.automationMode === 'boolean' ? record.automationMode : undefined,
    variantIndex: typeof record?.multiModelSlotIndex === 'number'
      ? record.multiModelSlotIndex
      : typeof record?.variantIndex === 'number'
        ? record.variantIndex
        : undefined,
  }
}

function wrapTransportForTtftDebug<UI_MESSAGE extends UIMessage>(
  transport: ChatTransport<UI_MESSAGE>,
): ChatTransport<UI_MESSAGE> {
  const wrapped: ChatTransport<UI_MESSAGE> = {
    ...transport,
    sendMessages: async (options) => {
      markTtftClientMilestone('act_fetch_start', streamLogFields(options.body))
      const stream = await transport.sendMessages(options)
      return wrapUiMessageStreamForTtft(stream)
    },
  }
  return wrapped
}

export function createDirectChatTransport<UI_MESSAGE extends UIMessage>(
  options: HttpChatTransportInitOptions<UI_MESSAGE>,
): ChatTransport<UI_MESSAGE> {
  const transport = new DefaultChatTransport({
    ...options,
    fetch: createChatDiagnosticFetch(options.fetch as ChatFetch | undefined),
  })
  return isTtftClientDebugEnabled() ? wrapTransportForTtftDebug(transport) : transport
}
