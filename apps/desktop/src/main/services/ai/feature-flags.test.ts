import { describe, it, expect, beforeEach } from 'vitest'
import {
  AI_SERVICE_FLAGS,
  shouldUseGateway,
  enableAllGatewayFeatures,
  disableAllGatewayFeatures
} from './feature-flags'

describe('AI service feature flags', () => {
  beforeEach(() => {
    enableAllGatewayFeatures()
  })

  it('returns true when master switch and feature flag are enabled', () => {
    expect(shouldUseGateway('USE_GATEWAY_FOR_CHAT')).toBe(true)
  })

  it('returns false when master switch is disabled', () => {
    disableAllGatewayFeatures()
    expect(shouldUseGateway('USE_GATEWAY_FOR_CHAT')).toBe(false)
  })

  it('returns false when an individual feature flag is disabled', () => {
    AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE = true
    AI_SERVICE_FLAGS.USE_GATEWAY_FOR_CHAT = false
    expect(shouldUseGateway('USE_GATEWAY_FOR_CHAT')).toBe(false)
  })

  it('toggles all flags with enable/disable helpers', () => {
    disableAllGatewayFeatures()
    expect(AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE).toBe(false)
    expect(AI_SERVICE_FLAGS.USE_GATEWAY_FOR_BROWSER).toBe(false)

    enableAllGatewayFeatures()
    expect(AI_SERVICE_FLAGS.USE_UNIFIED_AI_SERVICE).toBe(true)
    expect(AI_SERVICE_FLAGS.USE_GATEWAY_FOR_NOTEBOOK).toBe(true)
  })
})
