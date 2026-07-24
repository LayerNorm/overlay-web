/**
 * Model Pricing Configuration
 *
 * Per-model token pricing based on models.md
 * Used for accurate credit deduction in subscription billing
 */

export interface ModelPricing {
  inputPer1M: number // $/M input tokens
  cachedInputPer1M: number // $/M cached input tokens
  outputPer1M: number // $/M output tokens
  isFree: boolean
}

/**
 * Per-model pricing from models.md
 * Prices are in USD per 1 million tokens
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Free models (OpenRouter)
  'openrouter/free': { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0, isFree: true },

  // Anthropic Claude
  'claude-opus-4-6': {
    inputPer1M: 5.0,
    cachedInputPer1M: 0.5,
    outputPer1M: 25.0,
    isFree: false
  },
  'claude-sonnet-4-6': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    outputPer1M: 15.0,
    isFree: false
  },
  'claude-haiku-4-5': {
    inputPer1M: 1.0,
    cachedInputPer1M: 0.1,
    outputPer1M: 5.0,
    isFree: false
  },

  // Google Gemini
  'gemini-3.1-pro-preview': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.2,
    outputPer1M: 12.0,
    isFree: false
  },
  'gemini-3-flash-preview': {
    inputPer1M: 0.5,
    cachedInputPer1M: 0.05,
    outputPer1M: 3.0,
    isFree: false
  },
  'google/gemma-4-26b-a4b-it': {
    inputPer1M: 0.13,
    cachedInputPer1M: 0,
    outputPer1M: 0.4,
    isFree: false
  },

  // OpenAI
  'gpt-5.2-pro-2025-12-11': {
    inputPer1M: 2.5,
    cachedInputPer1M: 0.25,
    outputPer1M: 20.0,
    isFree: false
  },
  'gpt-5.2-2025-12-11': {
    inputPer1M: 2.5,
    cachedInputPer1M: 0.25,
    outputPer1M: 15.0,
    isFree: false
  },
  'gpt-5.4': {
    inputPer1M: 2.5,
    cachedInputPer1M: 0.25,
    outputPer1M: 15.0,
    isFree: false
  },
  'gpt-5-mini-2025-08-07': {
    inputPer1M: 0.75,
    cachedInputPer1M: 0.075,
    outputPer1M: 4.5,
    isFree: false
  },
  'gpt-5-nano-2025-08-07': {
    inputPer1M: 0.75,
    cachedInputPer1M: 0.075,
    outputPer1M: 4.5,
    isFree: false
  },
  'openai/gpt-5.4-mini': {
    inputPer1M: 0.75,
    cachedInputPer1M: 0.075,
    outputPer1M: 4.5,
    isFree: false
  },
  'gpt-4.1-2025-04-14': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.5,
    outputPer1M: 8.0,
    isFree: false
  },

  // xAI Grok
  'grok-4-1-fast-reasoning': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.2,
    outputPer1M: 6.0,
    isFree: false
  },
  'xai/grok-4.20-reasoning': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.2,
    outputPer1M: 6.0,
    isFree: false
  },

  // Groq
  'llama-3.3-70b-versatile': {
    inputPer1M: 0.59,
    cachedInputPer1M: 0.59,
    outputPer1M: 0.79,
    isFree: false
  },
  'moonshotai/kimi-k2-0905': {
    inputPer1M: 0.3827,
    cachedInputPer1M: 0.1935,
    outputPer1M: 1.72,
    isFree: false
  },
  'moonshotai/kimi-k2-instruct-0905': {
    inputPer1M: 0.3827,
    cachedInputPer1M: 0.1935,
    outputPer1M: 1.72,
    isFree: false
  },
  'moonshotai/kimi-k2.6': {
    inputPer1M: 0.3827,
    cachedInputPer1M: 0.1935,
    outputPer1M: 1.72,
    isFree: false
  },
  'minimax/minimax-m2.7': {
    inputPer1M: 0.3,
    cachedInputPer1M: 0,
    outputPer1M: 1.2,
    isFree: false
  },
  'z-ai/glm-5.1': {
    inputPer1M: 1.0,
    cachedInputPer1M: 0,
    outputPer1M: 3.2,
    isFree: false
  },
  'qwen/qwen3.6-plus': {
    inputPer1M: 0,
    cachedInputPer1M: 0,
    outputPer1M: 0,
    isFree: false
  },
  'zai/glm-5.1': {
    inputPer1M: 1.0,
    cachedInputPer1M: 0,
    outputPer1M: 3.2,
    isFree: false
  },
  'openai/gpt-oss-20b': {
    inputPer1M: 0.075,
    cachedInputPer1M: 0.0375,
    outputPer1M: 0.3,
    isFree: false
  },
  'openai/gpt-oss-120b': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    outputPer1M: 0.6,
    isFree: false
  },

  // DeepSeek (AI Gateway)
  'deepseek/deepseek-v4-pro': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.5,
    outputPer1M: 8.0,
    isFree: false
  },
  'deepseek/deepseek-v4-flash': {
    inputPer1M: 0.5,
    cachedInputPer1M: 0.1,
    outputPer1M: 2.0,
    isFree: false
  },

  // NVIDIA (AI Gateway)
  'nvidia/nemotron-nano-9b-v2': {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.05,
    outputPer1M: 0.05,
    isFree: false
  },

}

/**
 * Set of model IDs that are free to use (no credit deduction)
 */
export const FREE_MODEL_IDS = new Set<string>(
  Object.entries(MODEL_PRICING)
    .filter(([, pricing]) => pricing.isFree)
    .map(([modelId]) => modelId)
)

/**
 * Calculate token cost for a request
 * @param modelId - The model identifier
 * @param inputTokens - Total input tokens
 * @param cachedInputTokens - Cached input tokens (subset of inputTokens)
 * @param outputTokens - Output tokens
 * @returns Cost in dollars
 */
export function calculateTokenCost(
  modelId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[modelId]

  // Unknown model - default to free to avoid incorrect charges
  if (!pricing) {
    console.warn(`[ModelPricing] Unknown model: ${modelId}, treating as free`)
    return 0
  }

  if (pricing.isFree) return 0

  // Calculate cost
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens)
  const inputCost = (uncachedInput / 1_000_000) * pricing.inputPer1M
  const cachedCost = (cachedInputTokens / 1_000_000) * pricing.cachedInputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M

  return inputCost + cachedCost + outputCost
}

/**
 * Check if a model is premium (requires credits)
 */
export function isPremiumModel(modelId: string): boolean {
  const pricing = MODEL_PRICING[modelId]
  // If unknown, assume premium to be safe
  return pricing ? !pricing.isFree : true
}

/**
 * Estimate tokens from character count
 * Rough estimate: ~4 characters per token
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4)
}

/**
 * Estimate cost from output characters (fallback when API doesn't provide token counts)
 */
export function estimateCostFromOutputChars(modelId: string, outputChars: number): number {
  const pricing = MODEL_PRICING[modelId]
  if (!pricing || pricing.isFree) return 0

  const estimatedOutputTokens = estimateTokensFromChars(outputChars)
  // Only charge for output since we don't know input tokens
  return (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M
}

/**
 * Get pricing info for a model (for UI display)
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  return MODEL_PRICING[modelId] || null
}

// ============ TEST FUNCTION ============
// Run with: npx ts-node src/main/services/model-pricing.ts
if (require.main === module) {
  console.log('=== Model Pricing Test ===\n')

  // Test free model
  const freeCost = calculateTokenCost('openrouter/free', 1000, 0, 500)
  console.log(`openrouter/free (1000 in, 500 out): $${freeCost.toFixed(6)} (expected: $0)`)

  // Test Claude Sonnet
  const claudeCost = calculateTokenCost('claude-sonnet-4-6', 10000, 2000, 5000)
  console.log(`claude-sonnet-4-6 (10000 in, 2000 cached, 5000 out): $${claudeCost.toFixed(6)}`)
  // Expected: (8000/1M * $3) + (2000/1M * $0.30) + (5000/1M * $15) = 0.024 + 0.0006 + 0.075 = $0.0996

  // Test GPT-5.2
  const gptCost = calculateTokenCost('gpt-5.2-2025-12-11', 5000, 0, 2000)
  console.log(`gpt-5.2-2025-12-11 (5000 in, 2000 out): $${gptCost.toFixed(6)}`)
  // Expected: (5000/1M * $1.75) + (2000/1M * $14) = 0.00875 + 0.028 = $0.03675

  // Test unknown model
  const unknownCost = calculateTokenCost('unknown-model', 1000, 0, 500)
  console.log(`unknown-model (1000 in, 500 out): $${unknownCost.toFixed(6)} (expected: $0)`)

  // Test isPremiumModel
  console.log(
    `\nisPremiumModel('openrouter/free'): ${isPremiumModel('openrouter/free')} (expected: false)`
  )
  console.log(
    `isPremiumModel('claude-sonnet-4-6'): ${isPremiumModel('claude-sonnet-4-6')} (expected: true)`
  )
  console.log(`isPremiumModel('unknown'): ${isPremiumModel('unknown')} (expected: true)`)

  // Test estimate
  const estimated = estimateCostFromOutputChars('claude-sonnet-4-6', 2000)
  console.log(`\nestimated cost for 2000 chars output: $${estimated.toFixed(6)}`)

  console.log('\n=== Tests Complete ===')
}
