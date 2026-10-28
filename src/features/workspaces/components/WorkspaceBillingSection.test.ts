import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { isPaidWorkspaceBilling } from './WorkspaceBillingSection'

function billingSummary({
  initialized,
  planKind = 'free',
  topUpBalance = 0,
}: {
  initialized: boolean
  planKind?: 'free' | 'paid'
  topUpBalance?: number
}): WorkspaceBillingSummaryResponse {
  return {
    workspaceId: 'workspace-1',
    canManage: true,
    canTopUp: true,
    initialized,
    pricingVersion: 'markup_25_v1',
    credits: { total: 0, used: 0, remaining: 0, allowancePercentUsed: 0, topUpBalance },
    subscription: { planKind, planAmountCents: 0 },
  }
}

test('workspace billing is paid only after initialization and a paid plan or top-up', () => {
  assert.equal(isPaidWorkspaceBilling(billingSummary({ initialized: false, planKind: 'paid' })), false)
  assert.equal(isPaidWorkspaceBilling(billingSummary({ initialized: true })), false)
  assert.equal(isPaidWorkspaceBilling(billingSummary({ initialized: true, planKind: 'paid' })), true)
  assert.equal(isPaidWorkspaceBilling(billingSummary({ initialized: true, topUpBalance: 1 })), true)
})
