import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentSandboxLease, Computer } from '@overlay/workspace-contracts'
import type { ResolvedBillingPayer } from '@/shared/billing/billing-payer'
import { ComputerBilling } from './ComputerBilling'
import { ComputerServiceError } from './ComputerService'

const now = 1_800_000_000_000

const computer: Computer = {
  id: 'computer-1', workspaceId: 'ws-1', ownerType: 'agent', ownerId: 'agent-1',
  provider: 'box', providerRef: null, size: 'default', status: 'provisioning',
  name: null, createdBy: 'user-1', createdAt: now, updatedAt: now, lastActiveAt: null,
}

const workspacePayer: ResolvedBillingPayer = {
  billingAccountId: 'billing-1', scope: 'workspace', workspaceId: 'ws-1', subject: { id: 'agent:agent-1', kind: 'programmatic' },
}

function billingFor(meterResult: Record<string, unknown> = { applied: true, usage: {} }) {
  const lease: AgentSandboxLease = {
    id: 'computer:computer-1', workspaceId: 'ws-1', computerId: 'computer-1', provider: 'box',
    status: 'reserved', reservedUntil: now + 60_000, usage: { meterVersion: 1, meteredUsage: {} },
    cleanupAttempts: 0, createdAt: now, updatedAt: now,
  }
  const patches: Array<Record<string, unknown>> = []
  const meterOptions: unknown[] = []
  const billing = new ComputerBilling({
    repository: {
      async getSandboxLease() { return lease },
      async patchSandboxLeaseUsage(args: { patch: Record<string, unknown> }) { patches.push(args.patch); return lease },
    } as never,
    payerResolver: { resolve: async () => workspacePayer },
    meter: { meterLeaseWithRetry: async (_lease: AgentSandboxLease, options?: unknown) => { meterOptions.push(options); return meterResult } } as never,
    now: () => now,
  })
  return { billing, patches, meterOptions }
}

test('a computer starts with no hold: binding records only who pays', async () => {
  const { billing, patches } = billingFor()
  await billing.bindPayer(computer, 'user-1')
  assert.deepEqual(patches, [{ lastPayer: {
    scope: 'workspace', workspaceId: 'ws-1', billingAccountId: 'billing-1', userId: 'user-1',
    spendSubjectKind: 'programmatic', spendSubjectId: 'agent:agent-1',
  } }])
  assert.equal('releaseReservation' in billing, false)
  assert.equal('reserve' in billing, false)
})

test('a running computer whose metered charge leaves the workspace under 2% is refused', async () => {
  const { billing, meterOptions } = billingFor({ applied: true, usage: {}, budgetLow: true })
  await assert.rejects(billing.meter({ ...computer, providerRef: 'box-ref' }),
    (error) => error instanceof ComputerServiceError && error.code === 'insufficient_credit')
  assert.deepEqual(meterOptions, [{ idleStop: 'none' }])
  // Final settlement of a stopped computer always goes through.
  await billing.meter({ ...computer, providerRef: 'box-ref' }, true)
})

test('a running computer whose charge uses up an admin spend limit is refused', async () => {
  const { billing } = billingFor({ applied: true, usage: {}, spendLimitReached: true })
  await assert.rejects(billing.meter({ ...computer, providerRef: 'box-ref' }),
    (error) => error instanceof ComputerServiceError && error.code === 'insufficient_credit')
})
