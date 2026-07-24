type UnknownRecord = Record<string, unknown>

export interface NormalizedTokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

const ZERO_USAGE: NormalizedTokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function toDefinedNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function firstDefinedNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = toDefinedNumber(value)
    if (parsed !== undefined) {
      return parsed
    }
  }
  return undefined
}

function addUsage(total: NormalizedTokenUsage, usage: NormalizedTokenUsage): NormalizedTokenUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cachedTokens: total.cachedTokens + usage.cachedTokens
  }
}

function hasAnyUsage(usage: NormalizedTokenUsage): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedTokens > 0
}

export function hasTokenUsage(usage: NormalizedTokenUsage): boolean {
  return hasAnyUsage(usage)
}

export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage {
  if (!isRecord(usage)) {
    return ZERO_USAGE
  }

  const inputTokenDetails = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : {}
  const raw = isRecord(usage.raw) ? usage.raw : {}

  let inputTokens = firstDefinedNumber(
    usage.inputTokens,
    usage.promptTokens,
    usage.prompt_tokens,
    usage.input_tokens,
    raw.inputTokens,
    raw.promptTokens,
    raw.prompt_tokens,
    raw.input_tokens
  )

  let outputTokens = firstDefinedNumber(
    usage.outputTokens,
    usage.completionTokens,
    usage.completion_tokens,
    usage.output_tokens,
    raw.outputTokens,
    raw.completionTokens,
    raw.completion_tokens,
    raw.output_tokens
  )

  const cachedTokens = firstDefinedNumber(
    usage.cachedInputTokens,
    usage.cachedTokens,
    usage.cacheReadTokens,
    inputTokenDetails.cacheReadTokens,
    raw.cachedInputTokens,
    raw.cached_input_tokens,
    raw.cacheReadTokens,
    raw.cache_read_tokens
  )

  const totalTokens = firstDefinedNumber(usage.totalTokens, raw.totalTokens, raw.total_tokens)
  if (totalTokens !== undefined) {
    if (inputTokens === undefined && outputTokens !== undefined) {
      inputTokens = Math.max(0, totalTokens - outputTokens)
    } else if (outputTokens === undefined && inputTokens !== undefined) {
      outputTokens = Math.max(0, totalTokens - inputTokens)
    }
  }

  return {
    inputTokens: Math.max(0, inputTokens ?? 0),
    outputTokens: Math.max(0, outputTokens ?? 0),
    cachedTokens: Math.max(0, cachedTokens ?? 0)
  }
}

function extractUsageFromPayload(value: unknown, depth = 0): NormalizedTokenUsage {
  if (depth > 5) return ZERO_USAGE

  if (Array.isArray(value)) {
    return value.reduce<NormalizedTokenUsage>(
      (acc, entry) => addUsage(acc, extractUsageFromPayload(entry, depth + 1)),
      ZERO_USAGE
    )
  }

  if (!isRecord(value)) return ZERO_USAGE

  const directCandidates = [
    value.totalUsage,
    value.usage,
    value.tokenUsage,
    value.token_usage,
    value.tokens,
    value.raw
  ]

  for (const candidate of directCandidates) {
    const normalized = normalizeTokenUsage(candidate)
    if (hasAnyUsage(normalized)) {
      return normalized
    }
  }

  const selfUsage = normalizeTokenUsage(value)
  if (hasAnyUsage(selfUsage)) {
    return selfUsage
  }

  return Object.values(value).reduce<NormalizedTokenUsage>(
    (acc, child) => addUsage(acc, extractUsageFromPayload(child, depth + 1)),
    ZERO_USAGE
  )
}

export function extractGenerateResultUsage(result: unknown): NormalizedTokenUsage {
  if (!isRecord(result)) {
    return ZERO_USAGE
  }

  const totalUsage = normalizeTokenUsage(result.totalUsage)
  if (hasAnyUsage(totalUsage)) {
    return totalUsage
  }

  const steps = Array.isArray(result.steps) ? result.steps : []

  const stepUsage = steps.reduce<NormalizedTokenUsage>(
    (acc, step) => {
      const normalized = normalizeTokenUsage(isRecord(step) ? step.usage : undefined)
      return addUsage(acc, normalized)
    },
    ZERO_USAGE
  )

  if (hasAnyUsage(stepUsage)) {
    return stepUsage
  }

  const lastStepUsage = normalizeTokenUsage(result.usage)
  if (hasAnyUsage(lastStepUsage)) {
    return lastStepUsage
  }

  // Some providers only include usage inside response body/provider metadata.
  // Prefer step-level payloads to avoid double-counting with top-level fields.
  const stepPayloadUsage = steps.reduce<NormalizedTokenUsage>((acc, step) => {
    if (!isRecord(step)) return acc

    const stepResponse = isRecord(step.response) ? step.response : {}
    const fromResponseBody = extractUsageFromPayload(stepResponse.body)
    const fromProviderMetadata = extractUsageFromPayload(step.providerMetadata)

    return addUsage(acc, addUsage(fromResponseBody, fromProviderMetadata))
  }, ZERO_USAGE)

  if (hasAnyUsage(stepPayloadUsage)) {
    return stepPayloadUsage
  }

  const response = isRecord(result.response) ? result.response : {}
  const topLevelPayloadUsage = addUsage(
    extractUsageFromPayload(response.body),
    extractUsageFromPayload(result.providerMetadata)
  )

  if (hasAnyUsage(topLevelPayloadUsage)) {
    return topLevelPayloadUsage
  }

  return ZERO_USAGE
}

const GATEWAY_GENERATION_ID_PATTERN = /^gen_[a-z0-9_-]+$/i
const AI_SDK_LOCAL_ID_PATTERN = /^aitxt-/i

export function isGatewayGenerationId(id: string): boolean {
  return GATEWAY_GENERATION_ID_PATTERN.test(id.trim())
}

function isGenerationIdKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    lower === 'generationid' ||
    lower === 'generation_id' ||
    lower === 'generation-id' ||
    (lower.includes('generation') && lower.includes('id')) ||
    (lower.includes('gateway') && lower.includes('id'))
  )
}

function maybeAddGenerationId(ids: Set<string>, value: unknown, keyHint = ''): void {
  if (typeof value !== 'string') return

  const trimmed = value.trim()
  if (!trimmed || AI_SDK_LOCAL_ID_PATTERN.test(trimmed)) return

  if (isGatewayGenerationId(trimmed)) {
    ids.add(trimmed)
    return
  }

  if (isGenerationIdKey(keyHint)) {
    const match = trimmed.match(/gen_[a-z0-9_-]+/i)
    if (match && isGatewayGenerationId(match[0])) {
      ids.add(match[0])
    }
  }
}

function collectGenerationIds(value: unknown, ids: Set<string>, depth = 0): void {
  if (depth > 6) return

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) {
      collectGenerationIds(entry, ids, depth + 1)
    }
    return
  }

  if (!isRecord(value)) return

  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    maybeAddGenerationId(ids, entry, key)

    if (isRecord(entry) || Array.isArray(entry)) {
      collectGenerationIds(entry, ids, depth + 1)
    }
  }
}

export function extractGenerationIdsFromResult(result: unknown): string[] {
  if (!isRecord(result)) return []

  const ids = new Set<string>()

  const response = isRecord(result.response) ? result.response : {}
  maybeAddGenerationId(ids, response.id)
  collectGenerationIds(response.headers, ids)
  collectGenerationIds(response.body, ids)
  collectGenerationIds(result.providerMetadata, ids)

  if (Array.isArray(result.steps)) {
    for (const step of result.steps) {
      if (!isRecord(step)) continue

      const stepResponse = isRecord(step.response) ? step.response : {}
      maybeAddGenerationId(ids, stepResponse.id)
      collectGenerationIds(stepResponse.headers, ids)
      collectGenerationIds(stepResponse.body, ids)
      collectGenerationIds(step.providerMetadata, ids)
    }
  }

  return [...ids]
}

function estimateChars(value: unknown, depth = 0, visited?: WeakSet<object>): number {
  if (depth > 5) return 0

  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).length
  }

  if (!value || typeof value !== 'object') return 0

  if (value instanceof Uint8Array) {
    return value.byteLength
  }

  const seen = visited ?? new WeakSet<object>()
  if (seen.has(value)) return 0
  seen.add(value)

  if (Array.isArray(value)) {
    const capped = value.slice(0, 100)
    return capped.reduce((sum, entry) => sum + estimateChars(entry, depth + 1, seen), 0)
  }

  const entries = Object.entries(value).slice(0, 100)
  return entries.reduce(
    (sum, [key, entry]) => sum + key.length + estimateChars(entry, depth + 1, seen),
    0
  )
}

function charsToTokens(chars: number): number {
  if (chars <= 0) return 0
  return Math.max(1, Math.ceil(chars / 4))
}

export function estimateTokenUsageFromGenerateResult(result: unknown): NormalizedTokenUsage {
  if (!isRecord(result)) return ZERO_USAGE

  const steps = Array.isArray(result.steps) ? result.steps : []

  let inputChars = 0
  let outputChars = 0

  if (steps.length > 0) {
    for (const step of steps) {
      if (!isRecord(step)) continue

      const stepRequest = isRecord(step.request) ? step.request : {}
      inputChars += estimateChars(stepRequest.body ?? stepRequest)

      outputChars += estimateChars(step.text)
      outputChars += estimateChars(step.content)
      outputChars += estimateChars(step.toolCalls)
    }
  } else {
    const request = isRecord(result.request) ? result.request : {}
    inputChars += estimateChars(request.body ?? request)

    outputChars += estimateChars(result.text)
    const response = isRecord(result.response) ? result.response : {}
    outputChars += estimateChars(response.body)
  }

  return {
    inputTokens: charsToTokens(inputChars),
    outputTokens: charsToTokens(outputChars),
    cachedTokens: 0
  }
}

interface GenerationUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}

export async function recoverUsageFromGenerationIds(
  generationIds: string[],
  lookup: (generationId: string) => Promise<GenerationUsage | null>
): Promise<NormalizedTokenUsage> {
  const totals: NormalizedTokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }

  if (generationIds.length === 0) return totals

  const uniqueIds = [...new Set(generationIds)]
  const results = await Promise.all(uniqueIds.map((id) => lookup(id)))

  for (const usage of results) {
    if (!usage) continue
    totals.inputTokens += Math.max(0, usage.inputTokens || 0)
    totals.outputTokens += Math.max(0, usage.outputTokens || 0)
    totals.cachedTokens += Math.max(0, usage.cachedTokens || 0)
  }

  return totals
}
