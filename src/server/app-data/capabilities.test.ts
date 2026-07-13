import assert from 'node:assert/strict'
import test from 'node:test'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { deriveAppDataCapabilities } from './capabilities'

function postgresConfig(args: {
  backgroundRuntimeEnabled: boolean
  serviceAuthSecret?: string
}): OverlayRuntimeConfig {
  return {
    capabilities: { vectorSearch: false },
    database: {
      internalServiceAuthSecret: args.serviceAuthSecret,
      postgres: { backgroundRuntimeEnabled: args.backgroundRuntimeEnabled },
      provider: 'postgres',
    },
    providers: {},
  } as unknown as OverlayRuntimeConfig
}

test('Postgres operational capabilities require the declared background runtime', () => {
  const disabled = deriveAppDataCapabilities(postgresConfig({
    backgroundRuntimeEnabled: false,
    serviceAuthSecret: 'service-secret',
  }))
  assert.equal(disabled.supportsAutomations, false)
  assert.equal(disabled.supportsWebhooks, false)

  const missingSecret = deriveAppDataCapabilities(postgresConfig({
    backgroundRuntimeEnabled: true,
  }))
  assert.equal(missingSecret.supportsAutomations, false)
  assert.equal(missingSecret.supportsWebhooks, true)

  const operational = deriveAppDataCapabilities(postgresConfig({
    backgroundRuntimeEnabled: true,
    serviceAuthSecret: 'service-secret',
  }))
  assert.equal(operational.supportsAutomations, true)
  assert.equal(operational.supportsWebhooks, true)
  assert.equal(operational.supportsUsageAccounting, true)
  assert.equal(operational.supportsBillingRecords, false)
})
