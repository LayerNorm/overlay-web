import { createGateway, generateText, tool } from 'ai'
import { z } from 'zod'
import { getGatewayModelId } from '../../src/server/ai/gateway/gateway-runtime'
import { calculateGatewayLanguageTokenCostOrNull } from '../../src/shared/ai/gateway/model-pricing'

const HARD_MAX_COST_USD = 0.10
const DEFAULT_MAX_COST_USD = 0.01
const DEFAULT_MODEL_ID = 'google/gemini-3-flash'
const DEFAULT_INPUT_TOKEN_BUDGET = 512
const DEFAULT_OUTPUT_TOKEN_BUDGET = 8

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return value
}

async function main() {
  if (process.env.AI_GATEWAY_CANARY_CONFIRM_SPEND !== '1') {
    console.log('[GatewayCanary] skipped: set AI_GATEWAY_CANARY_CONFIRM_SPEND=1 to run the paid canary')
    return
  }

  const requestedCapUsd = readNumberEnv('AI_GATEWAY_CANARY_MAX_COST_USD', DEFAULT_MAX_COST_USD)
  if (requestedCapUsd > HARD_MAX_COST_USD) {
    throw new Error(
      `AI_GATEWAY_CANARY_MAX_COST_USD=${requestedCapUsd} exceeds hard cap ${HARD_MAX_COST_USD}`,
    )
  }

  const appModelId = process.env.AI_GATEWAY_CANARY_MODEL?.trim() || DEFAULT_MODEL_ID
  const gatewayModelId = getGatewayModelId(appModelId)
  const inputTokenBudget = Math.ceil(readNumberEnv('AI_GATEWAY_CANARY_INPUT_TOKEN_BUDGET', DEFAULT_INPUT_TOKEN_BUDGET))
  const outputTokenBudget = Math.ceil(readNumberEnv('AI_GATEWAY_CANARY_OUTPUT_TOKEN_BUDGET', DEFAULT_OUTPUT_TOKEN_BUDGET))
  const catalogResponse = await fetch('https://ai-gateway.vercel.sh/v1/models')
  if (!catalogResponse.ok) {
    throw new Error(`Could not load Gateway pricing (${catalogResponse.status}); refusing paid request`)
  }
  const catalog = await catalogResponse.json() as {
    data?: Array<{ id?: string; type?: string; pricing?: Record<string, unknown> }>
  }
  const catalogModel = catalog.data?.find((model) => model.id === gatewayModelId)
  const estimatedCostUsd = catalogModel?.type === 'language' && catalogModel.pricing
    ? calculateGatewayLanguageTokenCostOrNull(
        catalogModel.pricing,
        inputTokenBudget,
        0,
        outputTokenBudget,
      )
    : null
  if (estimatedCostUsd === null) {
    throw new Error(`Missing Gateway pricing for canary model ${gatewayModelId}; refusing paid request`)
  }
  if (estimatedCostUsd > requestedCapUsd) {
    throw new Error(
      `Estimated canary cost $${estimatedCostUsd.toFixed(6)} exceeds cap $${requestedCapUsd.toFixed(6)}`,
    )
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is required for the paid Gateway canary')
  }

  const gateway = createGateway({ apiKey })
  const canaryTool = tool({
    description: 'A no-op canary tool used only to force Gateway tool-schema validation.',
    inputSchema: z.object({
      result: z.literal('OK').describe('The literal canary result'),
    }),
    execute: async () => ({ ok: true }),
  })

  console.log('[GatewayCanary] starting', {
    gatewayModelId,
    inputTokenBudget,
    outputTokenBudget,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    maxCostUsd: requestedCapUsd,
    pricingModelId: gatewayModelId,
  })

  const result = await generateText({
    model: gateway(gatewayModelId),
    prompt: 'Reply exactly OK. Do not call tools.',
    tools: {
      canary_probe: canaryTool,
    },
    maxOutputTokens: outputTokenBudget,
    temperature: 0,
    providerOptions: {
      gateway: {
        tags: ['overlay', 'gateway-canary', process.env.VERCEL_ENV ? `env:${process.env.VERCEL_ENV}` : 'env:unknown'],
        user: 'overlay-gateway-canary',
      },
    },
  })

  if (!/\bOK\b/i.test(result.text)) {
    throw new Error(`Gateway canary returned unexpected text: ${JSON.stringify(result.text)}`)
  }

  console.log('[GatewayCanary] passed', {
    text: result.text.trim(),
    finishReason: result.finishReason,
  })
}

main().catch((error) => {
  console.error('[GatewayCanary] failed', error)
  process.exit(1)
})
