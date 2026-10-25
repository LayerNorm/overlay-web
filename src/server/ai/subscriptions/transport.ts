import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel } from '@/server/ai/provider-types'
import type { CodexTokenSet } from '@/server/agents/provider-accounts/codex-subscription'
import { createSubscriptionService, type SubscriptionService } from './service'
import { normalizeCodexResponsesBody } from './request-validation'

const CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const maxRequestBytes = 2_000_000
const maxResponseBytes = 8_000_000
const maxEventBytes = 1_000_000
const safeUpstreamError = 'Codex subscription request failed'
const safeStreamError = 'Codex did not complete the response'

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({
    error: { message, type: 'api_error', code: 'subscription_request_failed' },
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
  return {
    type: 'response.failed',
    sequence_number: typeof value.sequence_number === 'number' ? value.sequence_number : 0,
    response: {
      error: { code: 'subscription_request_failed', message: safeUpstreamError },
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
          throw new Error(safeStreamError)
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
    throw error instanceof Error && error.message === safeUpstreamError
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
  fetcher?: typeof fetch
}): LanguageModel {
  if (args.providerId !== 'codex') throw new Error('Subscription request adapter is not available')
  const fetcher = args.fetcher ?? fetch
  const provider = createOpenAI({
    apiKey: 'overlay-subscription-placeholder',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.toString() !== CODEX_RESPONSES_ENDPOINT ||
          init?.method?.toUpperCase() !== 'POST') {
        return errorResponse(400, 'Unsupported subscription request')
      }
      let body: Record<string, unknown>
      let wantsStream = false
      try {
        const text = await readRequestBody(input, init)
        const parsed: unknown = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return errorResponse(400, 'Invalid subscription request')
        }
        const rawBody = parsed as Record<string, unknown>
        wantsStream = rawBody.stream === true ||
          new Headers(init?.headers).get('accept')?.includes('text/event-stream') === true
        body = normalizeCodexResponsesBody(rawBody, args.modelId)
      } catch (error) {
        return errorResponse(400, error instanceof Error ? error.message : 'Invalid subscription request')
      }
      try {
        const tokens: CodexTokenSet = await (args.dispatchService ?? createSubscriptionService()).credentialForDispatch(
          args.ownerId, args.connectionId, args.modelId,
        )
        const headers = new Headers({
          accept: 'text/event-stream',
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
        })
        if (tokens.accountId) headers.set('ChatGPT-Account-Id', tokens.accountId)
        const upstream = await fetcher(CODEX_RESPONSES_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          redirect: 'error',
          cache: 'no-store',
          signal: init?.signal,
        })
        if (!upstream.ok) {
          await upstream.body?.cancel().catch((_error) => undefined)
          return errorResponse(400, safeUpstreamError)
        }
        if (!upstream.body) return errorResponse(400, safeStreamError)
        return wantsStream
          ? new Response(boundedStream(upstream.body), {
              status: upstream.status,
              headers: { 'content-type': 'text/event-stream' },
            })
          : await completedResponse(upstream)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
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
