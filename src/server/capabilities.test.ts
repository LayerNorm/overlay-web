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
