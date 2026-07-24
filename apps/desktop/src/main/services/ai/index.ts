/**
 * AI Services Module
 *
 * Unified AI service exports for the application.
 * Uses Vercel AI Gateway as primary provider with OpenRouter fallback for free models.
 */

// Feature flags for gradual rollout
export {
  AI_SERVICE_FLAGS,
  shouldUseGateway,
  enableAllGatewayFeatures,
  disableAllGatewayFeatures
} from './feature-flags'

// Gateway provider utilities
export {
  getGateway,
  getModel,
  getModelInfo,
  getOpenRouterApiKey,
  mapModelId,
  isFreeModel,
  resetProviders,
  getGatewayCredits,
  getGenerationDetails,
  MODEL_ID_MAPPING
} from './gateway-provider'
