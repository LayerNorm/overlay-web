import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core'
import type { OverlayRuntimeConfig } from '@/shared/config'
import {
  withObservabilityProviderCapabilities,
  withWorkspaceExternalAgentCapabilities,
} from './capabilities'

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

test('external agent capabilities require the master and all existing runtime gates without affecting computers', () => {
  const previousBoatApiKey = process.env.BOAT_API_KEY
  const previousComputerProvider = process.env.OVERLAY_COMPUTER_PROVIDER
  process.env.BOAT_API_KEY = 'synthetic-computer-provider-key'
  process.env.OVERLAY_COMPUTER_PROVIDER = 'box'
  try {
    const runtimeConfig = {
      features: {
        connectedAgentControlPlane: true,
        externalAgents: true,
        remoteAgentRuns: true,
        overlayCloudEnvironments: true,
        connectedAgentArtifacts: true,
        connectedAgentDrive: true,
        computers: true,
      },
      providers: { analytics: { provider: 'posthog' }, errorReporting: { provider: 'sentry' } },
    } as unknown as OverlayRuntimeConfig
    const capabilities = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, runtimeConfig)
    assert.equal(capabilities.connectedAgents, true)
    assert.equal(capabilities.externalAgents, true)
    assert.equal(capabilities.cloudAgents, true)
    assert.equal(capabilities.computers, true)

    const disabled = withObservabilityProviderCapabilities(DEFAULT_OVERLAY_CAPABILITIES, {
      ...runtimeConfig,
      features: { ...runtimeConfig.features, externalAgents: false },
    })
    assert.equal(disabled.connectedAgents, false)
    assert.equal(disabled.externalAgents, false)
    assert.equal(disabled.cloudAgents, false)
    assert.equal(disabled.computers, true)

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

test('workspace rollout hides external, connected, and cloud agents without hiding native computers', () => {
  const capabilities = {
    ...DEFAULT_OVERLAY_CAPABILITIES,
    connectedAgents: true,
    externalAgents: true,
    cloudAgents: true,
    computers: true,
  }
  const disabled = withWorkspaceExternalAgentCapabilities(capabilities, false)
  assert.equal(disabled.connectedAgents, false)
  assert.equal(disabled.externalAgents, false)
  assert.equal(disabled.cloudAgents, false)
  assert.equal(disabled.computers, true)
})
