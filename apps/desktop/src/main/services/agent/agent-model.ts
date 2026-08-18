import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createXai } from '@ai-sdk/xai'
import { keyCacheService } from '../key-cache-service'
import { resolveOpenRouterModelId } from '../ai/gateway-provider'

const AGENT_MODEL_PRIORITY = [
  { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5-20250929' },
  { provider: 'openai' as const, modelId: 'gpt-4.1-mini' },
  { provider: 'google' as const, modelId: 'gemini-2.0-flash' },
  { provider: 'groq' as const, modelId: 'llama-3.3-70b-versatile' },
  { provider: 'moonshot' as const, modelId: 'kimi-k2-0711-preview' },
  { provider: 'xai' as const, modelId: 'grok-3-fast' },
  // OpenRouter free model as fallback - always available without API key
  { provider: 'openrouter' as const, modelId: 'openrouter/free' }
]

export async function getAgentModel() {
  for (const { provider, modelId } of AGENT_MODEL_PRIORITY) {
    // OpenRouter free model doesn't require an API key
    if (provider === 'openrouter' && modelId === 'openrouter/free') {
      const key = await keyCacheService.getKey('openrouter')
      const resolvedModelId = resolveOpenRouterModelId(modelId)
      // OpenRouter free works with or without key
      console.log(`[Agent] Using model: ${modelId} (${provider}) - free tier`)
      return createOpenAI({
        apiKey: key || 'free',
        baseURL: 'https://openrouter.ai/api/v1',
        headers: {
          'HTTP-Referer': 'https://overlay.app',
          'X-Title': 'Overlay Agent'
        }
      })(resolvedModelId)
    }

    const key = await keyCacheService.getKey(
      provider as 'anthropic' | 'openai' | 'google' | 'groq' | 'xai'
    )
    if (!key) continue

    console.log(`[Agent] Using model: ${modelId} (${provider})`)
    switch (provider) {
      case 'moonshot':
        return createOpenAI({ apiKey: key, baseURL: 'https://api.moonshot.ai/v1' })(modelId)
      case 'anthropic':
        return createAnthropic({ apiKey: key })(modelId)
      case 'openai':
        return createOpenAI({ apiKey: key })(modelId)
      case 'google':
        return createGoogleGenerativeAI({ apiKey: key })(modelId);
      case 'xai':
        return createXai({ apiKey: key })(modelId)
      case 'groq':
        return createGroq({ apiKey: key })(modelId)
    }
  }

  throw new Error(
    'No API key configured for voice agent. Add an API key in Settings to enable agentic commands.'
  )
}
