import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject, generateText, type FlexibleSchema, type LanguageModel } from 'ai'
import { z } from 'zod'
import { config } from './config'

/** OpenAI-compatible client pointed at the Vercel AI Gateway. */
function gateway() {
  return createOpenAICompatible({
    name: 'gateway',
    apiKey: config.gatewayApiKey,
    baseURL: config.gatewayUrl,
  })
}

export function benchModel(modelId: string): LanguageModel {
  assertFreeModel(modelId)
  return gateway()(modelId)
}

/**
 * Cost guard: refuse to send bench traffic at any model id that does not end
 * in `:free` unless BENCH_PAID_MODELS=1 is set explicitly (the paid-model pass).
 * The previous `providerOptions.gateway.has:['free']` was not a real routing
 * constraint — the gateway ignored it and billed list price.
 */
const assertFreeModel = (modelId: string) => {
  if (process.env.BENCH_PAID_MODELS === '1') return
  if (!modelId.endsWith(':free')) {
    throw new Error(
      `Bench model "${modelId}" is not a :free id — it bills at list price. ` +
      `Use an openrouter/*:free id or set BENCH_PAID_MODELS=1 to spend on purpose.`,
    )
  }
}

export async function benchText(modelId: string, prompt: string, system?: string): Promise<string> {
  const res = await generateText({
    model: benchModel(modelId),
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 2000,
  })
  return res.text
}

/**
 * generateObject first; if the free model cannot produce structured output,
 * fall back to plain text + JSON extraction + zod validation.
 */
export async function benchObject<T extends z.ZodType>(args: {
  modelId: string
  schema: T
  system: string
  prompt: string
  maxOutputTokens?: number
}): Promise<z.infer<T>> {
  try {
    const res = await generateObject({
      model: benchModel(args.modelId),
      // erased to FlexibleSchema — a generic zod param breaks InferSchema
      // overload resolution in ai@7
      schema: args.schema as FlexibleSchema<unknown>,
      instructions: args.system,
      messages: [{ role: 'user', content: args.prompt }],
      maxOutputTokens: args.maxOutputTokens ?? 1200,
    })
    return res.object as z.infer<T>
  } catch {
    const text = await benchText(
      args.modelId,
      `${args.prompt}\n\nRespond with ONLY the JSON object. No prose, no markdown fences.`,
      args.system,
    )
    const json = extractJson(text)
    const parsed = args.schema.safeParse(json)
    if (!parsed.success) {
      throw new Error(`Model returned unparseable object: ${text.slice(0, 200)}`)
    }
    return parsed.data as z.infer<T>
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1]! : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object in model output')
  return JSON.parse(raw.slice(start, end + 1))
}

/** Retry wrapper for rate limits and transient gateway errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = Number(process.env.BENCH_RETRY_ATTEMPTS ?? 7),
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const retryable = /429|rate.?limit|500|502|503|504|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|unavailable|unparseable|no JSON object/i.test(msg)
      if (!retryable || i === attempts - 1) throw err
      const wait = Math.min(60_000, 3000 * 2 ** i)
      console.warn(`[bench] ${label} attempt ${i + 1} failed (${msg.slice(0, 120)}); retrying in ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}
