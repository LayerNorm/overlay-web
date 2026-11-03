import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel } from '@/server/ai/provider-types'
import { SubscriptionBridgeClient, SubscriptionBridgeError } from './bridge-client'
import { createSubscriptionService, type SubscriptionService } from './service'
import { assertSupportedCodexRequest } from './request-validation'

const SUBSCRIPTION_RESPONSES_ENDPOINT = 'https://overlay-subscription.invalid/responses'
const maxRequestBytes = 2_000_000
const maxResponseBytes = 8_000_000
const maxEventBytes = 1_000_000
const safeUpstreamError = 'Codex subscription request failed'
const safeStreamError = 'Codex did not complete the response'

const safeErrors: Record<string, { message: string; status: number }> = {
  reconnect_required: { message: 'Reconnect your Codex subscription to continue.', status: 401 },
  rate_limited: { message: 'Codex is rate-limiting requests. Retry later.', status: 429 },
  model_unavailable: { message: 'This Codex model is unavailable for the connected account.', status: 400 },
  provider_unavailable: { message: 'Codex is temporarily unavailable. Retry later.', status: 502 },
  temporary_failure: { message: 'The subscription service is temporarily unavailable. Retry later.', status: 502 },
}

function errorResponse(status: number, message: string, code = 'subscription_request_failed') {
  return new Response(JSON.stringify({
    error: { message, type: 'api_error', code },
  }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  const request = new Request(input, init)
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxRequestBytes) throw new Error('Subscription request body is too large')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch((_cancelError) => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function parseSseEvent(frame: string): unknown | '[DONE]' | null {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  if (data === '[DONE]') return '[DONE]'
  try {
    const value: unknown = JSON.parse(data)
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof (value as { type?: unknown }).type !== 'string') {
      throw new Error()
    }
    return value
  } catch (_error) {
    throw new Error(safeStreamError)
  }
}

function encodeSseEvent(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
}

function failedSseEvent(value: Record<string, unknown>) {
  const response = value.response
  const providerError = response && typeof response === 'object'
    ? (response as Record<string, unknown>).error
    : undefined
  const suppliedCode = providerError && typeof providerError === 'object'
    ? (providerError as Record<string, unknown>).code
    : undefined
  const code = typeof suppliedCode === 'string' && safeErrors[suppliedCode]
    ? suppliedCode
    : 'provider_unavailable'
  const safe = safeErrors[code]!
  return {
    type: 'response.failed',
    sequence_number: typeof value.sequence_number === 'number' ? value.sequence_number : 0,
    response: {
      error: { code, message: safe.message },
      incomplete_details: { reason: 'error' },
    },
  }
}

export async function completedResponse(response: Response): Promise<Response> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error(safeStreamError)
  const decoder = new TextDecoder()
  let buffer = ''
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) throw new Error(safeStreamError)
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const match = /\r?\n\r?\n/.exec(buffer.slice(boundary))
        if (!match) break
        const frame = buffer.slice(0, boundary)
        if (new TextEncoder().encode(frame).byteLength > maxEventBytes) throw new Error(safeStreamError)
        buffer = buffer.slice(boundary + match[0].length)
        const event = parseSseEvent(frame)
        if (event === '[DONE]') throw new Error(safeStreamError)
        const type = event && typeof event === 'object' ? (event as { type?: string }).type : undefined
        if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
          const value = event && typeof event === 'object' ? event as Record<string, unknown> : {}
          const providerError = value.response && typeof value.response === 'object'
            ? (value.response as Record<string, unknown>).error
            : undefined
          const code = providerError && typeof providerError === 'object' &&
            typeof (providerError as Record<string, unknown>).code === 'string'
            ? (providerError as Record<string, unknown>).code as string
            : 'provider_unavailable'
          const safe = safeErrors[code] ?? safeErrors.provider_unavailable!
          throw new SubscriptionBridgeError(code in safeErrors ? code : 'provider_unavailable', safe.status, safe.message)
        }
        if (type === 'response.completed' && event && typeof event === 'object' &&
            (event as { response?: unknown }).response &&
            typeof (event as { response?: unknown }).response === 'object') {
          await reader.cancel().catch((_cancelError) => undefined)
          return Response.json((event as { response: object }).response, { status: response.status })
        }
        boundary = buffer.search(/\r?\n\r?\n/)
      }
      if (new TextEncoder().encode(buffer).byteLength > maxEventBytes) throw new Error(safeStreamError)
    }
    buffer += decoder.decode()
    if (buffer.trim()) throw new Error(safeStreamError)
    throw new Error(safeStreamError)
  } catch (error) {
    await reader.cancel().catch((_cancelError) => undefined)
    throw error instanceof SubscriptionBridgeError
      ? error
      : error instanceof Error && error.message === safeUpstreamError
        ? error
        : new Error(safeStreamError)
  } finally {
    reader.releaseLock()
  }
}

export function boundedStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let pending = ''
  let completed = false
  const encoder = new TextEncoder()
  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            pending += decoder.decode()
            if (pending.trim() || !completed) throw new Error(safeStreamError)
            controller.close()
            return
          }
          total += value.byteLength
          if (total > maxResponseBytes) throw new Error(safeStreamError)
          pending += decoder.decode(value, { stream: true })
          const events = pending.split(/\r?\n\r?\n/)
          pending = events.pop() ?? ''
          if (encoder.encode(pending).byteLength > maxEventBytes ||
              events.some((event) => encoder.encode(event).byteLength > maxEventBytes)) {
            throw new Error(safeStreamError)
          }
          const output: Uint8Array[] = []
          for (const frame of events) {
            const event = parseSseEvent(frame)
            if (event === null || event === '[DONE]') {
              if (event === '[DONE]' && !completed) throw new Error(safeStreamError)
              continue
            }
            const type = (event as { type: string }).type
            if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
              output.push(encodeSseEvent(failedSseEvent(event as Record<string, unknown>)))
              completed = true
              await reader.cancel().catch((_cancelError) => undefined)
              if (output.length) controller.enqueue(concatBytes(output))
              controller.close()
              return
            }
            if (type === 'response.completed') {
              completed = true
              output.push(encodeSseEvent(event))
              await reader.cancel().catch((_cancelError) => undefined)
              controller.enqueue(concatBytes(output))
              controller.close()
              return
            }
            output.push(encodeSseEvent(event))
          }
          if (output.length) {
            controller.enqueue(concatBytes(output))
            return
          }
        }
      } catch (_error) {
        await reader.cancel().catch((_cancelError) => undefined)
        controller.error(new Error(safeStreamError))
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

type DispatchService = Pick<SubscriptionService, 'credentialForDispatch'>
export function createSubscriptionLanguageModel(args: {
  ownerId: string
  connectionId: string
  providerId: string
  modelId: string
  dispatchService?: DispatchService
  bridge?: Pick<SubscriptionBridgeClient, 'infer'>
  fetcher?: typeof fetch
}): LanguageModel {
  if (args.providerId !== 'codex') throw new Error('Subscription request adapter is not available')
  const bridge = args.bridge ?? new SubscriptionBridgeClient(undefined, undefined, args.fetcher ?? fetch)
  const provider = createOpenAI({
    apiKey: 'overlay-subscription-placeholder',
    baseURL: 'https://overlay-subscription.invalid',
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.toString() !== SUBSCRIPTION_RESPONSES_ENDPOINT ||
          init?.method?.toUpperCase() !== 'POST') {
        return errorResponse(400, 'Unsupported subscription request')
      }
      let body: Record<string, unknown>
      let requestedStream = false
      try {
        const text = await readRequestBody(input, init)
        const parsed: unknown = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return errorResponse(400, 'Invalid subscription request')
        }
        body = parsed as Record<string, unknown>
        requestedStream = body.stream === true
        assertSupportedCodexRequest(body, args.modelId)
      } catch (error) {
        return errorResponse(400, error instanceof Error ? error.message : 'Invalid subscription request')
      }
      try {
        const credential = await (args.dispatchService ?? createSubscriptionService()).credentialForDispatch(
          args.ownerId, args.connectionId, args.modelId,
        )
        const upstream = await bridge.infer({
          connectionId: args.connectionId,
          credential,
          modelId: args.modelId,
          request: { ...body, stream: true, store: false },
        }, init?.signal ?? undefined)
        if (!upstream.ok) {
          let code: unknown
          try {
            const body: unknown = await upstream.clone().json()
            if (body && typeof body === 'object' && 'error' in body &&
                body.error && typeof body.error === 'object' && 'code' in body.error) {
              code = body.error.code
            }
          } catch (_error) { /* use the generic safe error */ }
          await upstream.body?.cancel().catch((_error) => undefined)
          const safe = typeof code === 'string' ? safeErrors[code] : undefined
          return safe
            ? errorResponse(safe.status, safe.message, code as string)
            : errorResponse(502, safeUpstreamError, 'provider_unavailable')
        }
        if (!upstream.body) return errorResponse(400, safeStreamError)
        const streamResponse = new Response(boundedStream(upstream.body), {
          status: upstream.status,
          headers: { 'content-type': 'text/event-stream' },
        })
        if (requestedStream) return streamResponse
        try {
          return await completedResponse(streamResponse)
        } catch (error) {
          if (error instanceof SubscriptionBridgeError && safeErrors[error.code]) {
            const safe = safeErrors[error.code]!
            return errorResponse(safe.status, safe.message, error.code)
          }
          const message = error instanceof Error ? error.message : safeUpstreamError
          return errorResponse(502, message, 'provider_unavailable')
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        if (error instanceof SubscriptionBridgeError && safeErrors[error.code]) {
          const safe = safeErrors[error.code]!
          return errorResponse(safe.status, safe.message, error.code)
        }
        if (error instanceof Error) {
          const matching = Object.entries(safeErrors).find(([, safe]) => safe.message === error.message)
          if (matching) {
            const [code, safe] = matching
            return errorResponse(safe.status, safe.message, code)
          }
        }
        return errorResponse(400, safeUpstreamError)
      }
    },
  })
  return wrapLanguageModel({
    model: provider.responses(args.modelId),
    middleware: {
      async transformParams({ params }) {
        const providerOptions = params.providerOptions?.openai
        const openaiOptions = providerOptions && typeof providerOptions === 'object'
          ? providerOptions as Record<string, unknown>
          : {}
        if (openaiOptions.conversation != null || openaiOptions.previousResponseId != null) {
          throw new Error('Codex subscriptions do not support server-side conversation state')
        }
        return {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            openai: { ...openaiOptions, store: false },
          },
        }
      },
    },
  }) as LanguageModel
}
