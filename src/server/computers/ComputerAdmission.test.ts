import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { ResolvedBillingPayer } from '@/shared/billing/billing-payer'
import { minimumBudgetToStartMachineCents } from '@/server/agents/ManagedAgentSandboxBilling'
import { ComputerAdmission } from './ComputerAdmission'
import { ComputerServiceError } from './ComputerService'

const workspacePayer: ResolvedBillingPayer = {
  billingAccountId: 'wallet', scope: 'workspace', workspaceId: 'ws-1', subject: { id: 'user-1', kind: 'member' },
}
const input = { workspaceId: 'ws-1', userId: 'user-1', agentId: 'agent-1' }

test('Computer admission requires the target workspace wallet, not personal paid credit', async () => {
  for (const payer of [
    { ...workspacePayer, scope: 'personal', userId: 'user-1' } as ResolvedBillingPayer,
    { ...workspacePayer, workspaceId: 'other' } as ResolvedBillingPayer,
  ]) {
    const admission = new ComputerAdmission({
      payerResolver: { resolve: async () => payer },
      getEntitlements: async () => { throw new Error('Must reject before reading credit') },
    })
    await assert.rejects(admission.assertCanRun(input),
      (error) => error instanceof ComputerServiceError && error.code === 'paid_plan_required')
  }
})

test('Computer admission denies missing/free plans and below-floor or invalid balances', async () => {
  const needed = minimumBudgetToStartMachineCents()
  for (const [entitlements, code] of [
    [null, 'paid_plan_required'],
    [{ tier: 'free', planKind: 'free', budgetRemainingCents: 10000 }, 'paid_plan_required'],
    [{ tier: 'pro', planKind: 'paid', budgetRemainingCents: 0 }, 'insufficient_credit'],
    [{ tier: 'pro', planKind: 'paid', budgetRemainingCents: needed - 1 }, 'insufficient_credit'],
    [{ tier: 'pro', planKind: 'paid', budgetRemainingCents: Number.NaN }, 'insufficient_credit'],
  ] as const) {
    const admission = new ComputerAdmission({
      payerResolver: { resolve: async () => workspacePayer },
      getEntitlements: async () => entitlements as Entitlements | null,
    })
    await assert.rejects(admission.assertCanRun(input),
      (error) => error instanceof ComputerServiceError && error.code === code)
  }
})

test('Computer admission resolves the workspace and agent payer and admits at the start floor', async () => {
  const admission = new ComputerAdmission({
    payerResolver: { resolve: async (args) => {
      assert.deepEqual(args, { workspaceId: 'ws-1', userId: 'user-1', programmaticSubjectId: 'agent-1' })
      return workspacePayer
    } },
    getEntitlements: async (id) => {
      assert.equal(id, 'wallet')
      return { tier: 'pro', planKind: 'paid', budgetRemainingCents: minimumBudgetToStartMachineCents() } as Entitlements
    },
  })
  await admission.assertCanRun(input)
})
