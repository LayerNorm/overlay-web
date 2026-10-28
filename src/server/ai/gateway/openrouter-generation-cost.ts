const MAX_ATTEMPTS = 6
const REQUEST_TIMEOUT_MS = 5_000
const RETRY_DELAY_MS = 2_000

export const OPENROUTER_GENERATION_COST_MAX_DURATION_MS =
  MAX_ATTEMPTS * REQUEST_TIMEOUT_MS + (MAX_ATTEMPTS - 1) * RETRY_DELAY_MS

type GenerationResponse = {
  data?: {
    id?: unknown
    total_cost?: unknown
    is_byok?: unknown
    upstream_inference_cost?: unknown
  }
}

export type OpenRouterGenerationCostDependencies = {
  fetcher?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  timeoutSignal?: (milliseconds: number) => AbortSignal
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function confirmOpenRouterGenerationCost(
  generationId: string,
  apiKey: string,
  dependencies: OpenRouterGenerationCostDependencies = {},
): Promise<boolean> {
  if (!apiKey) return false
  const fetcher = dependencies.fetcher ?? fetch
  const pause = dependencies.sleep ?? sleep
  const timeoutSignal = dependencies.timeoutSignal ?? AbortSignal.timeout
  const url = `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      })
      if (response.status === 200) {
        let body: GenerationResponse
        try {
          body = await response.json() as GenerationResponse
        } catch (error) {
          if (error instanceof SyntaxError) return false
          throw error
        }
        const data = body.data
        return data?.id === generationId
          && data.total_cost === 0
          && data.is_byok === false
          && (data.upstream_inference_cost === undefined
            || data.upstream_inference_cost === null
            || data.upstream_inference_cost === 0)
      }
      if (response.status !== 404 && response.status !== 429 && response.status < 500) return false
    } catch (_error) {
      if (attempt === MAX_ATTEMPTS - 1) return false
    }
    if (attempt < MAX_ATTEMPTS - 1) await pause(RETRY_DELAY_MS)
  }
  return false
}
