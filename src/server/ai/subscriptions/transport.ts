import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from '@/server/ai/provider-types'
import { createSubscriptionService } from './service'
import { normalizeCodexResponsesBody } from './request-validation'

const CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const maxRequestBytes = 2_000_000
const maxResponseBytes = 8_000_000
const maxEventBytes = 1_000_000

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
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxRequestBytes) {
      await reader.cancel()
      throw new Error('Subscription request body is too large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function completedResponse(response: Response): Promise<Response> {
  if (!response.body) throw new Error('Codex returned an empty response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let totalBytes = 0
  let completed: Record<string, unknown> | undefined
  let failed = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxResponseBytes) throw new Error('Codex response is too large')
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    if (buffer.length > maxEventBytes && !buffer.includes('\n\n')) {
      throw new Error('Codex response event is too large')
    }
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (new TextEncoder().encode(event).byteLength > maxEventBytes) {
        throw new Error('Codex response event is too large')
      }
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data && data !== '[DONE]') {
        let payload: unknown
        try {
          payload = JSON.parse(data)
        } catch (_error) {
          throw new Error('Codex returned an invalid event')
        }
        if (payload && typeof payload === 'object' && 'type' in payload) {
          const item = payload as Record<string, unknown>
          if (item.type === 'response.completed') {
            completed = item.response as Record<string, unknown>
          } else if (item.type === 'error' || item.type === 'response.failed' ||
                     item.type === 'response.incomplete') {
            failed = true
          }
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  if (failed || !completed) throw new Error('Codex did not complete the response')
  return new Response(JSON.stringify(completed), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })
}

export function boundedStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let pending = ''
  const encoder = new TextEncoder()
  const sanitizeEvent = (event: string) => {
    const lines = event.split(/\r?\n/)
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') return `${event}\n\n`
    try {
      const payload: unknown = JSON.parse(data)
      if (payload && typeof payload === 'object' && 'type' in payload) {
        const type = (payload as { type: unknown }).type
        if (type === 'error' || type === 'response.failed' || type === 'response.incomplete') {
          const safePayload = type === 'error'
            ? { type, error: { message: 'Codex subscription request failed', type: 'api_error' } }
            : {
                type: 'response.failed',
                response: { error: { message: 'Codex subscription request failed' } },
              }
          const prefix = lines.filter((line) => !line.startsWith('data:'))
          return `${[...prefix, `data: ${JSON.stringify(safePayload)}`].join('\n')}\n\n`
        }
      }
    } catch (_error) {
      return `${event}\n\n`
    }
    return `${event}\n\n`
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          if (pending.length > maxEventBytes) throw new Error('Codex event is too large')
          controller.close()
          return
        }
        total += value.byteLength
        if (total > maxResponseBytes) throw new Error('Codex response is too large')
        pending += decoder.decode(value, { stream: true })
        const events = pending.split(/\r?\n\r?\n/)
        pending = events.pop() ?? ''
        if (encoder.encode(pending).byteLength > maxEventBytes ||
            events.some((event) => encoder.encode(event).byteLength > maxEventBytes)) {
          throw new Error('Codex response event is too large')
        }
        controller.enqueue(encoder.encode(events.map(sanitizeEvent).join('')))
      } catch (_error) {
        await reader.cancel().catch((_cancelError) => undefined)
        controller.error(new Error('Codex subscription response failed'))
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

export function createSubscriptionLanguageModel(args: {
  ownerId: string
  connectionId: string
  providerId: string
  modelId: string
}): LanguageModel {
  if (args.providerId !== 'codex') throw new Error('Subscription request adapter is not available')
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
      try {
        const text = await readRequestBody(input, init)
        const parsed: unknown = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return errorResponse(400, 'Invalid subscription request')
        }
        body = normalizeCodexResponsesBody(parsed as Record<string, unknown>, args.modelId)
      } catch (error) {
        return errorResponse(400, error instanceof Error ? error.message : 'Invalid subscription request')
      }
      const wantsStream = body.stream === true ||
        new Headers(init?.headers).get('accept')?.includes('text/event-stream') === true
      try {
        const tokens = await createSubscriptionService().credentialForDispatch(
          args.ownerId, args.connectionId, args.modelId,
        )
        const headers = new Headers({
          accept: 'text/event-stream',
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
        })
        if (tokens.accountId) headers.set('ChatGPT-Account-Id', tokens.accountId)
        const upstream = await fetch(CODEX_RESPONSES_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          redirect: 'error',
          cache: 'no-store',
          signal: init?.signal,
        })
        if (!upstream.ok) {
          await upstream.body?.cancel().catch((_error) => undefined)
          return errorResponse(upstream.status, 'Codex subscription request failed')
        }
        if (!upstream.body) return await completedResponse(upstream)
        return wantsStream
          ? new Response(boundedStream(upstream.body), {
              status: upstream.status,
              headers: { 'content-type': 'text/event-stream' },
            })
          : await completedResponse(upstream)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        return errorResponse(502, 'Codex subscription request failed')
      }
    },
  })
  return provider.responses(args.modelId) as LanguageModel
}
