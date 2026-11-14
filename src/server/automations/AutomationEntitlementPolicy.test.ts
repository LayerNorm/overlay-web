import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutomationEntitlementError,
  ConfiguredAutomationEntitlementPolicy,
  MAX_ENABLED_AUTOMATIONS,
  PaidPlanAutomationEntitlementPolicy,
  UnlimitedAutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'

test('billing-disabled automation policy allows enablement within the configured cap', async () => {
  const policy = new UnlimitedAutomationEntitlementPolicy()
  await policy.assertCanEnable({ enabledCount: MAX_ENABLED_AUTOMATIONS - 1, userId: 'user_1' })
  await assert.rejects(
    () => policy.assertCanEnable({ enabledCount: MAX_ENABLED_AUTOMATIONS, userId: 'user_1' }),
    (error) => error instanceof AutomationEntitlementError &&
      error.publicMessage === `You can enable up to ${MAX_ENABLED_AUTOMATIONS} automations.`,
  )
})

test('billing-backed automation policy preserves the paid-plan gate', async () => {
  const policy = new PaidPlanAutomationEntitlementPolicy(async () => 'free')
  await assert.rejects(
    () => policy.assertCanEnable({ enabledCount: 0, userId: 'user_1' }),
    (error) => error instanceof AutomationEntitlementError &&
      error.publicMessage === 'Enabled automations require a paid plan.',
  )
})

test('configured automation policy selects unlimited only when billing is disabled', async () => {
  let billingDisabled = true
  let paidLookups = 0
  const policy = new ConfiguredAutomationEntitlementPolicy({
    billingDisabled: () => billingDisabled,
    getPlanKind: async () => {
      paidLookups += 1
      return 'free'
    },
  })
  await policy.assertCanEnable({ enabledCount: 0, userId: 'user_1' })
  assert.equal(paidLookups, 0)

  billingDisabled = false
  await assert.rejects(() => policy.assertCanEnable({ enabledCount: 0, userId: 'user_1' }))
  assert.equal(paidLookups, 1)
})

test('the plan of the workspace the automation is enabled in decides', async () => {
  const asked: Array<[string, string | undefined]> = []
  const policy = new PaidPlanAutomationEntitlementPolicy(async (userId, workspaceId) => {
    asked.push([userId, workspaceId])
    return workspaceId === 'paid_team' ? 'paid' : 'free'
  })
  await policy.assertCanEnable({ enabledCount: 0, userId: 'user_1', workspaceId: 'paid_team' })
  await assert.rejects(
    policy.assertCanEnable({ enabledCount: 0, userId: 'user_1', workspaceId: 'free_personal' }),
    /require a paid plan/,
  )
  assert.deepEqual(asked, [['user_1', 'paid_team'], ['user_1', 'free_personal']])
})
