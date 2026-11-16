import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { withObservabilityProviderCapabilities } from './capabilities'

test('analytics and error reporting capabilities are disabled when their provider is none', () => {
  const capabilities = withObservabilityProviderCapabilities(
    DEFAULT_OVERLAY_CAPABILITIES,
    {
      providers: {
        analytics: { provider: 'none' },
        errorReporting: { provider: 'none' },
      },
    } as OverlayRuntimeConfig,
  )

  assert.equal(capabilities.analytics, false)
  assert.equal(capabilities.errorReporting, false)
})

test('computers follow their feature flag and provider configuration', () => {
  const previousBoatApiKey = process.env.BOAT_API_KEY
  const previousComputerProvider = process.env.OVERLAY_COMPUTER_PROVIDER
  process.env.BOAT_API_KEY = 'synthetic-computer-provider-key'
  process.env.OVERLAY_COMPUTER_PROVIDER = 'box'
  try {
    const runtimeConfig = {
      features: { computers: true },
      providers: { analytics: { provider: 'posthog' }, errorReporting: { provider: 'sentry' } },
    } as unknown as OverlayRuntimeConfig
    assert.equal(withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, runtimeConfig).computers, true)
    const computersDisabled = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, {
      ...runtimeConfig,
      features: { ...runtimeConfig.features, computers: false },
    })
    assert.equal(computersDisabled.computers, false)
  } finally {
    if (previousBoatApiKey === undefined) delete process.env.BOAT_API_KEY
    else process.env.BOAT_API_KEY = previousBoatApiKey
    if (previousComputerProvider === undefined) delete process.env.OVERLAY_COMPUTER_PROVIDER
    else process.env.OVERLAY_COMPUTER_PROVIDER = previousComputerProvider
  }
})
