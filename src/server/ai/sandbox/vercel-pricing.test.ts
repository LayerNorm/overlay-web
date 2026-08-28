import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateVercelSandboxCostUsd,
  estimateVercelSandboxReservationUsd,
} from './vercel-pricing'

const pricing = {
  activeCpuUsdPerHour: 0.128,
  creationUsd: 0.0000006,
  egressUsdPerGb: 0.15,
  memoryUsdPerGbHour: 0.0212,
}

test('Vercel sandbox cost uses metered vCPU time, wall-clock memory, egress, and creation', () => {
  const cost = calculateVercelSandboxCostUsd({
    includeCreation: true,
    memoryGb: 4,
    pricing,
    usage: {
      activeCpuTimeMs: 3_600_000,
      egressBytes: 1_000_000_000,
      wallTimeMs: 3_600_000,
    },
  })
  assert.equal(cost, 0.128 + (4 * 0.0212) + 0.15 + 0.0000006)
})

test('Vercel reservation assumes all vCPUs are active and applies a safety buffer', () => {
  const reservation = estimateVercelSandboxReservationUsd({
    includeCreation: true,
    maxEgressBytes: 1_000_000_000,
    maxRunTimeMs: 3_600_000,
    memoryGb: 4,
    pricing,
    reservationBufferPercent: 25,
    vcpus: 2,
  })
  const unbuffered = (2 * 0.128) + (4 * 0.0212) + 0.15 + 0.0000006
  assert.equal(reservation, unbuffered * 1.25)
})
