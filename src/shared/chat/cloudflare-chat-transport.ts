import { isDevelopmentBuild, publicEnv } from '@/shared/env/public-env'
import {
  DefaultChatTransport,
  type ChatTransport,
  type HttpChatTransportInitOptions,
  type UIMessage,
  type UIMessageChunk,
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

type CloudflareChatTransportOptions<UI_MESSAGE extends UIMessage> =
  HttpChatTransportInitOptions<UI_MESSAGE> & {
    relayApi: string
  }

function normalizeRelayApi(value: string): string {
  return value.replace(/\/+$/, '')
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

      const diagnostic = {
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
      }
      console.error(`[chat-stream] http error ${JSON.stringify(diagnostic)}`)
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

export function getCloudflareChatStreamRelayApi(): string | null {
  const configured = publicEnv.chatStreamRelayUrl
  if (!configured) return null
  if (isDevelopmentBuild() && !publicEnv.chatStreamRelayLocal) {
    return null
  }
  return normalizeRelayApi(configured)
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

function shouldUseDirectStream(body: ChatBody): boolean {
  const record = body as Record<string, unknown> | undefined
  return record?.temporaryChat === true || record?.streamPersistenceMode === 'direct'
}

export function resolvePersistentChatStreamMode(body: ChatBody): 'cloudflare-mirror' | 'direct' {
  if (shouldUseDirectStream(body)) return 'direct'
  return 'cloudflare-mirror'
}

function logStreamCompletion(
  stream: ReadableStream<UIMessageChunk>,
  path: 'cloudflare' | 'cloudflare-mirror' | 'direct',
  body: ChatBody,
): ReadableStream<UIMessageChunk> {
  const withTtft = isTtftClientDebugEnabled()
    ? wrapUiMessageStreamForTtft(stream)
    : stream
  return withTtft.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
    },
    flush() {
      console.info(`[chat-stream] path=${path} complete`, streamLogFields(body))
    },
  }))
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
  if (transport.reconnectToStream) {
    wrapped.reconnectToStream = async (options) => {
      const stream = await transport.reconnectToStream!(options)
      return stream ? wrapUiMessageStreamForTtft(stream) : null
    }
  }
  return wrapped
}

export function createPersistentChatTransport<UI_MESSAGE extends UIMessage>(
  options: HttpChatTransportInitOptions<UI_MESSAGE>,
): ChatTransport<UI_MESSAGE> {
  const relayApi = getCloudflareChatStreamRelayApi()
  const base = relayApi
    ? new CloudflareChatTransport({ ...options, relayApi })
    : new DefaultChatTransport({
        ...options,
        fetch: createChatDiagnosticFetch(options.fetch as ChatFetch | undefined),
      })
  return isTtftClientDebugEnabled() ? wrapTransportForTtftDebug(base) : base
}

class CloudflareChatTransport<UI_MESSAGE extends UIMessage>
  extends DefaultChatTransport<UI_MESSAGE>
  implements ChatTransport<UI_MESSAGE>
{
  private readonly fallbackTransport: DefaultChatTransport<UI_MESSAGE>
  private readonly relayApi: string
  private readonly diagnosticFetch: ChatFetch

  constructor(options: CloudflareChatTransportOptions<UI_MESSAGE>) {
    const { relayApi, prepareSendMessagesRequest, api = '/api/v1/conversations/act', ...rest } = options
    const diagnosticFetch = createChatDiagnosticFetch(rest.fetch as ChatFetch | undefined)
    super({ api, ...rest, fetch: diagnosticFetch })
    this.relayApi = normalizeRelayApi(relayApi)
    this.diagnosticFetch = diagnosticFetch
    this.fallbackTransport = new DefaultChatTransport({
      api,
      prepareSendMessagesRequest,
      ...rest,
      fetch: diagnosticFetch,
    })
  }

  async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const streamMode = resolvePersistentChatStreamMode(options.body)
    if (streamMode === 'direct') {
      console.info('[chat-stream] path=direct start', streamLogFields(options.body))
      const body = {
        ...(options.body ?? {}),
        streamPersistenceMode: 'direct',
      }
      const stream = await this.fallbackTransport.sendMessages({ ...options, body })
      return logStreamCompletion(stream, 'direct', body)
    }

    const body = {
      ...(options.body ?? {}),
      streamPersistenceMode: 'cloudflare-mirror',
    }
    console.info('[chat-stream] path=cloudflare-mirror start', streamLogFields(body))
    const stream = await this.fallbackTransport.sendMessages({ ...options, body })
    return logStreamCompletion(stream, 'cloudflare-mirror', body)
  }

  async reconnectToStream(
    options: Parameters<ChatTransport<UI_MESSAGE>['reconnectToStream']>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const requestId = crypto.randomUUID()
    const fields = streamLogFields(options.body)
    console.info('[chat-stream] path=cloudflare resume', { ...fields, requestId })
    const response = await this.diagnosticFetch(`${this.relayApi}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        ...(options.body ?? {}),
        id: options.chatId,
      }),
    })

    if (response.status === 204) {
      console.info('[chat-stream] path=cloudflare resume-empty', { ...fields, requestId })
      return null
    }

    if (!response.ok) {
      throw new Error((await response.text()) || 'Failed to resume chat stream.')
    }

    if (!response.body) {
      throw new Error('The response body is empty.')
    }

    console.info('[chat-stream] path=cloudflare resume-connected', {
      ...fields,
      requestId: response.headers.get('x-request-id') ?? requestId,
    })
    return logStreamCompletion(this.processResponseStream(response.body), 'cloudflare', options.body)
  }
}
