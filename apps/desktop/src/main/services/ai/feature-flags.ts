/**
 * AI Service Feature Flags
 *
 * Controls gradual rollout of unified AI Gateway service.
 * Set flags to true to enable new unified service for each component.
 * Keep false to use legacy implementations as fallback.
 */

export const AI_SERVICE_FLAGS = {
  /** Master switch - enables unified AI service architecture */
  USE_UNIFIED_AI_SERVICE: true,

  /** Phase 1: Use Gateway for ChatPanel chat functionality */
  USE_GATEWAY_FOR_CHAT: true,

  /** Phase 2: Use Gateway for BrowserPanel agent */
  USE_GATEWAY_FOR_BROWSER: true,

  /** Phase 3: Use Gateway for NotebookPanel agent */
  USE_GATEWAY_FOR_NOTEBOOK: true,

  /** Phase 4: Use Gateway for Voice command agent */
  USE_GATEWAY_FOR_VOICE: true
}

/**
 * Check if a specific feature should use the unified Gateway service
 */
export function shouldUseGateway(feature: keyof typeof AI_SERVICE_FLAGS): boolean {
  // Master switch must be on
  if (!AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE) {
    return false
  }
  return AI_SERVICE_FLAGS[feature]
}

/**
 * Enable all Gateway features (for testing)
 */
export function enableAllGatewayFeatures(): void {
  AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE = true
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_CHAT = true
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_BROWSER = true
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_NOTEBOOK = true
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_VOICE = true
}

/**
 * Disable all Gateway features (rollback)
 */
export function disableAllGatewayFeatures(): void {
  AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE = false
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_CHAT = false
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_BROWSER = false
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_NOTEBOOK = false
  AI_SERVICE_FLAGS.USE_GATEWAY_FOR_VOICE = false
}
