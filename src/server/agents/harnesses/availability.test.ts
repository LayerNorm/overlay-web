import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import { MANAGED_HARNESS_CATALOG } from '@/shared/agents/harness-catalog'
import { managedHarnessCatalogFor } from './availability'

const ALL_ON = { featureEnabled: true, rolloutEligible: true, providers: ['vercel'] } as const

test('managed harness catalog is enabled when every gate passes', () => {
  const result = managedHarnessCatalogFor(ALL_ON)
  assert.equal(result.enabled, true)
  assert.equal(result.harnesses.length, MANAGED_HARNESS_CATALOG.length)
  assert.equal(result.provider, 'vercel')
})

test('each gate independently closes the picker', () => {
  for (const args of [
    { ...ALL_ON, featureEnabled: false },
    { ...ALL_ON, rolloutEligible: false },
    { ...ALL_ON, providers: [] },
  ]) {
    const result = managedHarnessCatalogFor(args)
    assert.equal(result.enabled, false)
    assert.deepEqual(result.harnesses, [])
  }
})

test('workspace allowlists filter the catalog to permitted harnesses', () => {
  const result = managedHarnessCatalogFor({ ...ALL_ON, allowedHarnesses: ['claude-code', 'pi'] })
  assert.equal(result.enabled, true)
  assert.deepEqual(result.harnesses.map((entry) => entry.id), ['claude-code', 'pi'])
})

test('an allowlist that permits nothing closes the picker', () => {
  const result = managedHarnessCatalogFor({ ...ALL_ON, allowedHarnesses: ['not-a-harness'] })
  assert.equal(result.enabled, false)
  assert.deepEqual(result.harnesses, [])
})
