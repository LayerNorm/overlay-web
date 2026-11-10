import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { ResolvedBillingPayer } from '@/shared/billing/billing-payer'
import { ComputerAdmission, type ComputerBudgetCheck } from './ComputerAdmission'
import { ComputerServiceError } from './ComputerService'

const workspacePayer: ResolvedBillingPayer = {
  billingAccountId: 'wallet', scope: 'workspace', workspaceId: 'ws-1', subject: { id: 'user-1', kind: 'member' },
}
const input = { workspaceId: 'ws-1', userId: 'user-1', agentId: 'agent-1' }
const paid = { tier: 'pro', planKind: 'paid', budgetRemainingCents: 10_000, budgetTotalCents: 10_000 } as Entitlements
const allow: ComputerBudgetCheck = async () => ({ ok: true })

test('Computer admission requires the target workspace wallet, not personal paid credit', async () => {
  for (const payer of [
    { ...workspacePayer, scope: 'personal', userId: 'user-1' } as ResolvedBillingPayer,
    { ...workspacePayer, workspaceId: 'other' } as ResolvedBillingPayer,
  ]) {
    const admission = new ComputerAdmission({
      payerResolver: { resolve: async () => payer },
      getEntitlements: async () => { throw new Error('Must reject before reading credit') },
      ensureBudgetNotLow: allow,
    })
    await assert.rejects(admission.assertCanRun(input),
      (error) => error instanceof ComputerServiceError && error.code === 'paid_plan_required')
  }
})

test('Computer admission denies missing and free plans', async () => {
  for (const entitlements of [null, { tier: 'free', planKind: 'free', budgetRemainingCents: 10000 }]) {
    const admission = new ComputerAdmission({
      payerResolver: { resolve: async () => workspacePayer },
      getEntitlements: async () => entitlements as Entitlements | null,
      ensureBudgetNotLow: async () => { throw new Error('Must reject before the budget check') },
    })
    await assert.rejects(admission.assertCanRun(input),
      (error) => error instanceof ComputerServiceError && error.code === 'paid_plan_required')
  }
})

test('a computer starts when the workspace has at least 2% left, checked for the member and agent', async () => {
  const checks: Array<Parameters<ComputerBudgetCheck>[0]> = []
  const admission = new ComputerAdmission({
    payerResolver: { resolve: async (args) => {
      assert.deepEqual(args, { workspaceId: 'ws-1', userId: 'user-1', programmaticSubjectId: 'agent:agent-1' })
      return workspacePayer
    } },
    getEntitlements: async (id) => {
      assert.equal(id, 'wallet')
      // A small balance is fine: there is no fixed-cent start floor, only the 2% rule.
      return { ...paid, budgetRemainingCents: 50 } as Entitlements
    },
    ensureBudgetNotLow: async (args) => { checks.push(args); return { ok: true } },
  })
  await admission.assertCanRun(input)
  assert.equal(checks.length, 1)
  assert.equal(checks[0]?.programmaticSubjectId, 'agent:agent-1')
  assert.equal(checks[0]?.workspaceId, 'ws-1')
})

test('a computer is refused under 2% after the automatic top-up fails', async () => {
  const admission = new ComputerAdmission({
    payerResolver: { resolve: async () => workspacePayer },
    getEntitlements: async () => ({ ...paid, budgetRemainingCents: 100 }) as Entitlements,
    ensureBudgetNotLow: async () => ({ ok: false, payload: { message: 'Your workspace has less than 2% of its budget left.' } }),
  })
  await assert.rejects(admission.assertCanRun(input), (error) => error instanceof ComputerServiceError
    && error.code === 'insufficient_credit' && error.status === 402 && /less than 2%/.test(error.message))
})
