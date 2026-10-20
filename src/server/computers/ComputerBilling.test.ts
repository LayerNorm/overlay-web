import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentSandboxLease, Computer } from '@overlay/workspace-contracts'
import type { ConnectedAgentRepository, ConnectedAgentSandboxLeasePayer } from '@/server/agents/ConnectedAgentRepository'
import { ComputerBilling } from './ComputerBilling'

const now = 1_800_000_000_000

const computer: Computer = {
  id: 'computer-1', workspaceId: 'ws-1', ownerType: 'user', ownerId: 'user-1',
  provider: 'box', providerRef: null, size: 'default', status: 'provisioning',
  name: null, createdBy: 'user-1', createdAt: now, updatedAt: now, lastActiveAt: null,
}

const payer: ConnectedAgentSandboxLeasePayer = {
  scope: 'workspace', workspaceId: 'ws-1', billingAccountId: 'billing-1', userId: 'user-1',
  spendSubjectKind: 'member', spendSubjectId: 'user-1',
}

function billingFor(usage: Record<string, unknown>) {
  const lease: AgentSandboxLease = {
    id: 'computer:computer-1', workspaceId: 'ws-1', computerId: 'computer-1', provider: 'box',
    status: 'reserved', reservedUntil: now + 60_000, usage, cleanupAttempts: 0, createdAt: now, updatedAt: now,
  }
  const calls: Parameters<ConnectedAgentRepository['meterSandboxLease']>[0][] = []
  const repository = {
    async getSandboxLease() { return lease },
    async meterSandboxLease(args: Parameters<ConnectedAgentRepository['meterSandboxLease']>[0]) {
      calls.push(args)
      return { applied: true, meterVersion: 2 }
    },
  } as unknown as Pick<ConnectedAgentRepository, 'getSandboxLease' | 'meterSandboxLease'>
  const billing = new ComputerBilling({
    repository,
    payerResolver: {} as never,
    meter: {} as never,
    now: () => now,
  })
  return { billing, calls }
}

test('pre-request reservation release uses the shared lease meter with zero debit and hold', async () => {
  const { billing, calls } = billingFor({
    meterVersion: 1, meteredUsage: {}, runtimeHoldMicros: 125_000, runtimeHoldPayer: payer,
  })
  await billing.releaseReservation(computer)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.runtimeHoldCents, 0)
  assert.equal(calls[0]?.charge, undefined)
  assert.equal(calls[0]?.payer, payer)
  assert.equal(calls[0]?.minRemainingCents, 0)
})

test('pre-request reservation release refuses leases with persisted allocation evidence', async () => {
  const { billing, calls } = billingFor({
    meterVersion: 1, meteredUsage: {}, runtimeHoldMicros: 125_000, runtimeHoldPayer: payer, requestedAt: now,
  })
  await assert.rejects(billing.releaseReservation(computer), /COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION/)
  assert.equal(calls.length, 0)
})
