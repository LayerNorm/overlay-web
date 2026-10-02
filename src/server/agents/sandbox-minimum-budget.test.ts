import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { minimumBudgetToStartMachineCents } from './ManagedAgentSandboxBilling'

test('a machine needs more than the meter\'s low-balance floor to start, so it is not deleted a minute later', () => {
  delete process.env.OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS
  assert.equal(minimumBudgetToStartMachineCents(), 101)
  process.env.OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS = '25'
  assert.equal(minimumBudgetToStartMachineCents(), 26)
  delete process.env.OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS
})
