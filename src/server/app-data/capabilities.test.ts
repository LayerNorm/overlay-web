import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONVEX_APP_DATA_CAPABILITIES,
  deriveAppDataCapabilities,
  selectedDatabaseProvider,
} from './capabilities'

test('App-data capabilities are always the Convex capability set', () => {
  assert.deepEqual(deriveAppDataCapabilities(null), CONVEX_APP_DATA_CAPABILITIES)
  assert.equal(deriveAppDataCapabilities(null).provider, 'convex')
  assert.equal(deriveAppDataCapabilities(null).supportsAutomations, true)
  assert.equal(deriveAppDataCapabilities(null).supportsWebhooks, true)
  assert.equal(deriveAppDataCapabilities(null).supportsUsageAccounting, true)
  assert.equal(deriveAppDataCapabilities(null).supportsBillingRecords, true)
  assert.equal(deriveAppDataCapabilities(null).requiresConvexClient, true)
})

test('selectedDatabaseProvider always resolves convex', () => {
  assert.equal(selectedDatabaseProvider(null), 'convex')
})
