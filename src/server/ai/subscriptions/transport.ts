import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel } from '@/server/ai/provider-types'
import { SubscriptionBridgeClient, SubscriptionBridgeError } from './bridge-client'
import { createSubscriptionService, type SubscriptionService } from './service'
import { assertSupportedCodexRequest, assertSupportedSubscriptionRequest, subscriptionStatelessRequest } from './request-validation'

const SUBSCRIPTION_RESPONSES_ENDPOINT = 'https://overlay-subscription.invalid/responses'
const maxRequestBytes = 2_000_000
const maxResponseBytes = 8_000_000
const maxEventBytes = 1_000_000
const safeUpstreamError = 'Subscription request failed'
const safeStreamError = 'The subscription did not complete the response'

const safeErrors: Record<string, { message: string; status: number }> = {
  reconnect_required: { message: 'Reconnect your subscription to continue.', status: 401 },
  rate_limited: { message: 'The provider is rate-limiting requests. Retry later.', status: 429 },
  model_unavailable: { message: 'This model is unavailable for the connected account.', status: 400 },
  provider_unavailable: { message: 'The provider is temporarily unavailable. Retry later.', status: 502 },
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
  const code = typeof suppliedCode === 'string' && Object.hasOwn(safeErrors, suppliedCode)
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

function nextSseFrame(buffer: string): { frame: string; remainder: string } | null {
  const boundary = /\r?\n\r?\n/.exec(buffer)
  if (!boundary) return null
  return {
    frame: buffer.slice(0, boundary.index),
    remainder: buffer.slice(boundary.index + boundary[0].length),
  }
}

function responseFailure(value: Record<string, unknown>): SubscriptionBridgeError {
  const failed = failedSseEvent(value)
  const error = (failed.response as { error: { code: string; message: string } }).error
  const safe = safeErrors[error.code] ?? safeErrors.provider_unavailable!
  return new SubscriptionBridgeError(error.code, safe.status, safe.message)
}

async function completedResponseFrame(
  frame: string,
  status: number,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Response | null> {
  if (new TextEncoder().encode(frame).byteLength > maxEventBytes) throw new Error(safeStreamError)
  const event = parseSseEvent(frame)
  if (event === '[DONE]') throw new Error(safeStreamError)
  if (!event || typeof event !== 'object') return null
  const value = event as Record<string, unknown>
  const type = value.type
  if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
    throw responseFailure(value)
  }
  if (type === 'response.completed' && value.response && typeof value.response === 'object') {
    await reader.cancel().catch((_cancelError) => undefined)
    return Response.json(value.response, { status })
  }
  return null
}

function completedResponseError(error: unknown): Error {
  if (error instanceof SubscriptionBridgeError) return error
  if (error instanceof Error && error.message === safeUpstreamError) return error
  return new Error(safeStreamError)
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
      let nextFrame = nextSseFrame(buffer)
      while (nextFrame) {
        buffer = nextFrame.remainder
        const completed = await completedResponseFrame(nextFrame.frame, response.status, reader)
        if (completed) return completed
        nextFrame = nextSseFrame(buffer)
      }
      if (new TextEncoder().encode(buffer).byteLength > maxEventBytes) throw new Error(safeStreamError)
    }
    buffer += decoder.decode()
    if (buffer.trim()) throw new Error(safeStreamError)
    throw new Error(safeStreamError)
  } catch (error) {
    await reader.cancel().catch((_cancelError) => undefined)
    throw completedResponseError(error)
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

async function validateSubscriptionRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  providerId: string,
  modelId: string,
): Promise<{ body: Record<string, unknown>; requestedStream: boolean } | { response: Response }> {
  try {
    const text = await readRequestBody(input, init)
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { response: errorResponse(400, 'Invalid subscription request') }
    }
    const body = parsed as Record<string, unknown>
    if (providerId === 'codex') assertSupportedCodexRequest(body, modelId)
    else assertSupportedSubscriptionRequest(body, modelId)
    return { body, requestedStream: body.stream === true }
  } catch (error) {
    return {
      response: errorResponse(400, error instanceof Error ? error.message : 'Invalid subscription request'),
    }
  }
}

async function credentialForProvider(
  service: DispatchService,
  actorUserId: string,
  connectionId: string,
  modelId: string,
  providerId: string,
  workspaceId?: string,
) {
  const credential = await service.credentialForDispatch(actorUserId, connectionId, modelId, workspaceId)
  if (credential.providerId !== providerId) {
    throw new Error(safeErrors.reconnect_required!.message)
  }
  return credential
}

export function createSubscriptionLanguageModel(args: {
  ownerId: string
  connectionId: string
  providerId: string
  modelId: string
  workspaceId?: string
  dispatchService?: DispatchService
  bridge?: Pick<SubscriptionBridgeClient, 'infer'>
  fetcher?: typeof fetch
}): LanguageModel {
  if (!['codex', 'claude', 'xai', 'meta', 'kimi', 'devin'].includes(args.providerId)) {
    throw new Error('Subscription request adapter is not available')
  }
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
      const validated = await validateSubscriptionRequest(input, init, args.providerId, args.modelId)
      if ('response' in validated) return validated.response
      const { body, requestedStream } = validated
      try {
        const credential = await credentialForProvider(
          args.dispatchService ?? createSubscriptionService(),
          args.ownerId,
          args.connectionId,
          args.modelId,
          args.providerId,
          args.workspaceId,
        )
        const upstream = await bridge.infer({
          connectionId: args.connectionId,
          credential,
          modelId: args.modelId,
          request: subscriptionStatelessRequest(body),
        }, init?.signal ?? undefined)
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
          throw new Error('Subscriptions do not support server-side conversation state')
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
