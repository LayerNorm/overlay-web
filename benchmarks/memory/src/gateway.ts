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
    // Hidden reasoning burns the whole output budget on ling-*-free models
    // (reasoning_tokens count against max_tokens, leaving empty/truncated
    // content). `reasoning:{enabled:false}` disables it — verified against the
    // gateway. Injected via transformRequestBody because the openai-compatible
    // provider strips unknown providerOptions keys.
    transformRequestBody: (body) => ({ ...body, reasoning: { enabled: false } }),
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
  if (!modelId.endsWith(':free') && !modelId.endsWith('-free')) {
    throw new Error(
      `Bench model "${modelId}" is not a :free/-free id — it bills at list price. ` +
      `Use a catalog-verified $0 id or set BENCH_PAID_MODELS=1 to spend on purpose.`,
    )
  }
}

/**
 * Authoritative cost check: fetch the gateway catalog once and verify every
 * configured bench model prices at $0. Suffix checks catch accidents; this
 * catches ids that look free but are billed. Skipped under BENCH_PAID_MODELS.
 */
export async function assertFreePricing(): Promise<void> {
  if (process.env.BENCH_PAID_MODELS === '1') return
  const ids = [config.extractorModel, config.answerModel, config.judgeModel]
  try {
    const res = await fetch(`${config.gatewayUrl}/models`, {
      headers: { Authorization: `Bearer ${config.gatewayApiKey}` },
    })
    const data = (await res.json()) as { data?: { id: string; pricing?: { input?: string; output?: string } }[] }
    const priced = new Map((data.data ?? []).map((m) => [m.id, m.pricing]))
    for (const id of new Set(ids)) {
      const p = priced.get(id)
      if (!p) throw new Error(`Bench model "${id}" not in gateway catalog — would 404 or bill unexpectedly`)
      if (Number(p.input ?? 1) !== 0 || Number(p.output ?? 1) !== 0) {
        throw new Error(`Bench model "${id}" catalog price ${p.input}/${p.output} — not free. Refusing to run.`)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Bench model')) throw err
    console.warn(`[bench] catalog price check failed (${String(err).slice(0, 120)}) — relying on suffix guard only`)
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
  /** Last-chance repair applied to the parsed JSON before safeParse — e.g. coerce out-of-enum values rather than failing the whole call. */
  normalize?: (json: unknown) => unknown
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
    const parsed = args.schema.safeParse(args.normalize ? args.normalize(json) : json)
    if (!parsed.success) {
      throw new Error(`Model returned unparseable object: ${text.slice(0, 200)}`)
    }
    return parsed.data as z.infer<T>
  }
}

/**
 * Dedup-decision tolerance: free models emit `mergedContent: null`,
 * `"targetIndex": "0"`, or off-enum decisions ("add_new", "no_op"). Coerce
 * the parseable parts; a missing/unknown decision fails safe to 'add' at the
 * caller's catch.
 */
export const normalizeDedupJson = (json: unknown): unknown => {
  if (!json || typeof json !== 'object') return json
  const rec = json as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const d = typeof rec.decision === 'string' ? rec.decision.toLowerCase() : ''
  out.decision = ['add', 'noop', 'update', 'supersede'].includes(d)
    ? d
    : d.startsWith('no') ? 'noop' : d.startsWith('add') ? 'add' : d.startsWith('upd') ? 'update' : d.startsWith('sup') ? 'supersede' : 'add'
  const ti = rec.targetIndex ?? rec.index ?? rec.target
  const tiN = typeof ti === 'number' ? ti : parseInt(String(ti), 10)
  if (Number.isInteger(tiN) && tiN >= 0) out.targetIndex = tiN
  const mc = rec.mergedContent ?? rec.merged ?? rec.content
  if (typeof mc === 'string' && mc.trim()) out.mergedContent = mc
  return out
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
