import assert from 'node:assert/strict'
import test from 'node:test'
import {
  POSTGRES_APP_DATA_V1_CAPABILITIES,
  type AppDataCapabilities,
} from './capabilities'
import { ON_PREM_PARITY_MATRIX, type AppDataCapabilityKey } from './parity-matrix'
import { POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES } from './route-support'

const capabilityKeys = Object.keys(POSTGRES_APP_DATA_V1_CAPABILITIES)
  .filter((key): key is AppDataCapabilityKey => key !== 'provider')
  .sort()

test('parity matrix owns every app-data capability exactly once', () => {
  const owned = ON_PREM_PARITY_MATRIX.flatMap((domain) =>
    domain.capabilities.map((capability) => capability.key),
  )
  assert.deepEqual([...owned].sort(), capabilityKeys)
  assert.equal(new Set(owned).size, owned.length)
})

test('parity matrix owns every Postgres route-support rule exactly once', () => {
  const owned = ON_PREM_PARITY_MATRIX.flatMap((domain) => domain.routeRuleIds)
  const routeRuleIds = POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES.map((rule) => rule.id).sort()
  assert.deepEqual([...owned].sort(), routeRuleIds)
  assert.equal(new Set(owned).size, owned.length)
})

test('parity matrix records current capability gaps without treating Convex isolation as a gap', () => {
  const gaps = ON_PREM_PARITY_MATRIX.flatMap((domain) =>
    domain.capabilities
      .filter(({ key, expectedAtParity }) => POSTGRES_APP_DATA_V1_CAPABILITIES[key] !== expectedAtParity)
      .map(({ key }) => `${domain.id}:${key}`),
  )

  assert.equal(gaps.includes('runtime-isolation:requiresConvexClient'), false)
  assert.equal(gaps.includes('chat:supportsRealtime'), false)
  assert.equal(gaps.includes('projects:supportsProjects'), false)
  assert.equal(gaps.includes('background-runtime:supportsPersistentIdempotency'), false)
})

test('parity matrix targets are valid boolean capability values', () => {
  for (const domain of ON_PREM_PARITY_MATRIX) {
    assert.ok(domain.exitGate.trim(), `${domain.id} must define an exit gate`)
    for (const capability of domain.capabilities) {
      assert.equal(
        typeof POSTGRES_APP_DATA_V1_CAPABILITIES[capability.key as keyof AppDataCapabilities],
        'boolean',
      )
    }
  }
})
