import 'server-only'

import { logger } from '@/server/observability/logger'
/**
 * OpenRouter Service — direct fetch to https://openrouter.ai/api/v1/chat/completions.
 * Overlay ids use `openrouter/` for our registry. Vendor models map to API slugs without that
 * prefix (e.g. `openrouter/arcee-ai/...` → `arcee-ai/...`). OpenRouter-native routers keep the
 * full id (e.g. `openrouter/free` — sending `free` alone is invalid).
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
} from 'ai'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'

type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenRouterContentPart[]
}

const OPENROUTER_RETRY_ATTEMPTS = 7

/**
 * Retries 429/503 from OpenRouter (common with `openrouter/free` when upstream free models throttle).
 * The AI SDK also retries ~3 times; this layers longer backoff at the HTTP level per attempt.
 */
export async function openRouterFetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let last: Response | undefined
  for (let attempt = 0; attempt < OPENROUTER_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(input, init)
    last = res
    if (res.status !== 429 && res.status !== 503) {
      return res
    }
    await res.arrayBuffer().catch((_error) => undefined)
    if (attempt >= OPENROUTER_RETRY_ATTEMPTS - 1) {
      return res
    }
    const ra = res.headers.get('retry-after')
    let ms = Math.min(45_000, 1000 * 2 ** attempt)
    if (ra) {
      const sec = Number(ra)
      if (!Number.isNaN(sec)) {
        ms = Math.min(60_000, Math.max(500, sec * 1000))
      }
    }
    await new Promise((r) => setTimeout(r, ms))
  }
  return last!
}

function gatherErrorText(error: unknown, depth = 0): string {
  if (depth > 6 || error == null) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    const e = error as Error & { cause?: unknown; lastError?: unknown; errors?: unknown[] }
    let s = e.message
    if (e.cause) s += ' ' + gatherErrorText(e.cause, depth + 1)
    if (e.lastError) s += ' ' + gatherErrorText(e.lastError, depth + 1)
    if (Array.isArray(e.errors)) {
      for (const x of e.errors) s += ' ' + gatherErrorText(x, depth + 1)
    }
    return s
  }
  return String(error)
}

/** User-visible copy when OpenRouter / free pool fails. */
export function userFacingOpenRouterError(error: unknown): string {
  const raw = gatherErrorText(error)
  const lower = raw.toLowerCase()

  if (
    /\b402\b/.test(raw) ||
    lower.includes('spend limit') ||
    lower.includes('usd spend') ||
    lower.includes('payment required') ||
    lower.includes('insufficient credits')
  ) {
    return (
      'The model provider blocked this request (often a spending limit on the upstream API key or provider account). ' +
      'Try another model in Ask, check your OpenRouter provider limits, or use a non-OpenRouter model.'
    )
  }

  if (
    /\b429\b/.test(raw) ||
    lower.includes('rate limit') ||
    lower.includes('rate-limited') ||
    lower.includes('temporarily rate-limited')
  ) {
    return (
      'OpenRouter’s free models are temporarily rate-limited. Wait a minute and retry, ' +
      'or add your own OpenRouter key for higher limits.'
    )
  }
  if (
    /tools\.\d+\.custom\.input_schema/i.test(raw) ||
    lower.includes('input_schema.type') ||
    lower.includes('field required') && lower.includes('input_schema')
  ) {
    return (
      'AI Gateway rejected one of the configured tool schemas. This is a provider configuration issue, ' +
      'not your prompt or budget. Try again after the latest deploy, or switch to a free model temporarily.'
    )
  }
  if (!raw.trim()) return 'Something went wrong. Please try again.'
  return raw.length > 600 ? `${raw.slice(0, 600)}…` : raw
}

/** When tool-enabled completions fail (billing, limits), fall back to plain chat without tools. */
export function shouldFallbackOpenRouterWithoutTools(error: unknown): boolean {
  const raw = gatherErrorText(error)
  const lower = raw.toLowerCase()
  if (/\bOpenRouter (402|403|408|429)\b/.test(raw)) return true
  if (/\b402\b/.test(raw) && lower.includes('openrouter')) return true
  if (lower.includes('spend limit') || lower.includes('usd spend')) return true
  if (lower.includes('payment required') || lower.includes('insufficient_quota')) return true
  return false
}

/** Map overlay registry id → OpenRouter `model` string for /v1/chat/completions. */
export function toOpenRouterApiModelId(overlayModelId: string): string {
  if (!overlayModelId.startsWith('openrouter/')) {
    return overlayModelId
  }
  const rest = overlayModelId.slice('openrouter/'.length)
  // Vendor paths are `org/model` or `org/model:variant` — drop the registry prefix only for those.
  // Single-segment ids (e.g. `free`) are OpenRouter routers; API requires `openrouter/...`.
  if (rest.includes('/')) {
    return rest
  }
  return overlayModelId
}

export function buildOpenRouterMessagesFromUi(
  messages: UIMessage[],
  system: string
): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = []
  const sys = system.trim()
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const parts = m.parts ?? []
    if (m.role === 'user') {
      const contentParts: OpenRouterContentPart[] = []
      let hasUnsupportedFiles = false

      for (const part of parts) {
        if (part.type === 'text') {
          const text = 'text' in part && typeof part.text === 'string' ? part.text : ''
          if (text.trim()) contentParts.push({ type: 'text', text })
          continue
        }
        if (part.type !== 'file') continue
        const url = 'url' in part ? part.url : undefined
        const mediaType = 'mediaType' in part ? part.mediaType : undefined
        if (
          typeof url === 'string' &&
          url.length > 0 &&
          typeof mediaType === 'string' &&
          mediaType.startsWith('image/')
        ) {
          contentParts.push({ type: 'image_url', image_url: { url } })
        } else {
          hasUnsupportedFiles = true
        }
      }

      if (hasUnsupportedFiles) {
        contentParts.push({
          type: 'text',
          text: '[User attached non-image file(s) — describe or acknowledge as needed]',
        })
      }

      if (contentParts.length === 0) {
        contentParts.push({ type: 'text', text: '(empty message)' })
      }

      out.push({ role: m.role, content: contentParts })
      continue
    }

    const content = parts
      .filter((p) => p.type === 'text')
      .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim()

    if (!content) continue
    out.push({ role: m.role, content })
  }
  return out
}

async function resolveApiKey(accessToken?: string): Promise<string | null> {
  void accessToken
  return await getServerProviderKey('openrouter')
}

export async function streamOpenRouterChat({
  modelId,
  messages,
  originalMessages,
  accessToken,
  onFinish,
}: {
  modelId: string
  messages: OpenRouterMessage[]
  originalMessages?: UIMessage[]
  accessToken?: string
  onFinish?: (
    text: string,
    usage: { inputTokens: number; outputTokens: number },
    routedModelId?: string,
  ) => Promise<void>
}): Promise<Response> {
  const apiKey = await resolveApiKey(accessToken)
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY or configure it in Convex.')
  }

  const response = await openRouterFetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://getoverlay.io',
      'X-Title': 'Overlay',
    },
    body: JSON.stringify({
      model: toOpenRouterApiModelId(modelId),
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter ${response.status}: ${errorText}`)
  }

  // Encode stream in Vercel AI SDK UIMessageStream format so useChat can parse it
  const decoder = new TextDecoder()
  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0
  let routedModelId: string | undefined

  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      const messageId = generateId()
      const textId = generateId()
      let textStarted = false
      writer.write({ type: 'start', messageId })
      const reader = response.body!.getReader()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                fullText += content
                if (!textStarted) {
                  writer.write({ type: 'text-start', id: textId })
                  textStarted = true
                }
                writer.write({ type: 'text-delta', id: textId, delta: content })
              }
              if (typeof parsed.model === 'string' && parsed.model) {
                routedModelId = parsed.model
              }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens ?? 0
                outputTokens = parsed.usage.completion_tokens ?? 0
              }
            } catch (_error) {
              // ignore malformed chunks
            }
          }
        }

        const usage = { inputTokens, outputTokens }
        if (textStarted) {
          writer.write({ type: 'text-end', id: textId })
        }
        writer.write({
          type: 'finish',
          finishReason: 'stop',
          ...(routedModelId ? { messageMetadata: { routedModelId } } : {}),
        })

        if (onFinish) {
          await onFinish(fullText, usage, routedModelId)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('[OpenRouter] Stream error:', msg)
        writer.write({ type: 'error', errorText: msg })
      }
    },
  })

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
}

/** Encode plain text as a UI message stream useChat can parse reliably. */
export function encodeAssistantTextAsUiDataStream(
  fullText: string,
  usage: { inputTokens: number; outputTokens: number },
  originalMessages?: UIMessage[],
  onFinish?: (
    text: string,
    usage: { inputTokens: number; outputTokens: number },
    routedModelId?: string,
  ) => Promise<void>,
): Response {
  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      const messageId = generateId()
      writer.write({ type: 'start', messageId })

      if (fullText.length > 0) {
        const textId = generateId()
        writer.write({ type: 'text-start', id: textId })
        const chunkSize = 48
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const piece = fullText.slice(i, i + chunkSize)
          writer.write({ type: 'text-delta', id: textId, delta: piece })
        }
        writer.write({ type: 'text-end', id: textId })
      }
      writer.write({ type: 'finish', finishReason: 'stop' })
      if (onFinish) {
        await onFinish(fullText, usage)
      }
    },
  })
  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
}
