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

test('external agent capability requires the master and existing runtime gates without affecting computers', () => {
  const runtimeConfig = {
    features: {
      connectedAgentControlPlane: true,
      externalAgents: true,
      remoteAgentRuns: true,
      overlayCloudEnvironments: true,
      computers: true,
    },
    providers: { analytics: { provider: 'posthog' }, errorReporting: { provider: 'sentry' } },
  } as unknown as OverlayRuntimeConfig
  const capabilities = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, runtimeConfig)
  assert.equal(capabilities.externalAgents, true)
  assert.equal(capabilities.cloudAgents, true)
  assert.equal(capabilities.computers, false)

  const disabled = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, {
    ...runtimeConfig,
    features: { ...runtimeConfig.features, externalAgents: false },
  })
  assert.equal(disabled.externalAgents, false)
  assert.equal(disabled.cloudAgents, false)
  assert.equal(disabled.computers, capabilities.computers)

  const computersDisabled = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, {
    ...runtimeConfig,
    features: { ...runtimeConfig.features, computers: false },
  })
  assert.equal(computersDisabled.computers, false)
})
