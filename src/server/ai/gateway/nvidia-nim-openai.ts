import 'server-only'

/**
 * NVIDIA NIM — OpenAI Chat Completions–compatible API via {@link createOpenAI} from `@ai-sdk/openai`.
 * Same client pattern as Vercel AI Gateway: custom `baseURL` + `apiKey` (see
 * https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions ).
 * Base URL: https://integrate.api.nvidia.com/v1
 */
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { NVIDIA_NIM_MODEL_IDS } from '@/shared/ai/gateway/model-types'

export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1' as const

/**
 * Tried in order for free tier before `openrouter/free`.
 * Align with NIM build names (see NVIDIA NIM / build docs).
 */
export const FREE_TIER_NVIDIA_PREFERRED_MODEL_ORDER = [
  'stepfun-ai/step-3.5-flash',
] as const satisfies readonly (typeof NVIDIA_NIM_MODEL_IDS)[number][]

export async function resolveNvidiaApiKey(accessToken?: string): Promise<string | null> {
  void accessToken
  return await getServerProviderKey('nvidia')
}

/**
 * A single NIM model using `/v1/chat/completions` through the OpenAI-compatible AI SDK provider.
 */
export function createNvidiaNimChatLanguageModel(
  modelId: string,
  apiKey: string,
): LanguageModelV4 {
  const nvidia = createOpenAI({
    name: 'nvidia-nim',
    baseURL: NVIDIA_NIM_BASE_URL,
    apiKey,
    fetch: globalThis.fetch,
  })
  return nvidia.chat(modelId)
}

/** True when we should try the next free-tier candidate (NVIDIA → OpenRouter). */
export function isRetryableFreeTierPrimaryModelError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  if (
    /\b(429|502|503|504|status code: 5|timeout|econnreset|econnrefused|rate limit|throttl|overloaded|unavailable|model.*not found|not_available)\b/i.test(
      raw,
    )
  ) {
    return true
  }
  if (lower.includes('fetch failed') || lower.includes('network error')) {
    return true
  }
  if (lower.includes('400') && (lower.includes('model') || lower.includes('invalid'))) {
    return true
  }
  if (lower.includes('401') || lower.includes('403')) {
    // Bad/expired NIM key — try next candidate or OpenRouter
    return true
  }
  return true
}
