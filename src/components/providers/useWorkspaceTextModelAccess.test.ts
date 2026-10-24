import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import {
  buildSelectableTextModels,
  resolveEntitlementDerived,
} from './useWorkspaceTextModelAccess'

test('free workspaces see only free models, while paid workspaces retain the full list', () => {
  const freeAccess = resolveEntitlementDerived({
    tier: 'free',
    creditsUsed: 0,
    creditsTotal: 0,
  }, true, false)
  const paidAccess = resolveEntitlementDerived({
    tier: 'pro',
    planKind: 'paid',
    creditsUsed: 0,
    creditsTotal: 100,
    budgetTotalCents: 10_000,
    budgetRemainingCents: 10_000,
  }, true, false)
  const freeModels = buildSelectableTextModels(freeAccess)
  const paidModels = buildSelectableTextModels(paidAccess)

  assert.deepEqual(
    freeModels.map((model) => model.id),
    getModelsByIntelligence(true)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .filter((model) => isFreeTierChatModelId(model.id))
      .map((model) => model.id),
  )
  assert.ok(freeModels.every((model) => isFreeTierChatModelId(model.id)))
  assert.deepEqual(
    paidModels.map((model) => model.id),
    getModelsByIntelligence(false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => model.id),
  )
  assert.ok(paidModels.length > freeModels.length)
})

test('ZDR-only access excludes models without zero-data-retention support', () => {
  const paidZdrAccess = resolveEntitlementDerived({
    tier: 'pro',
    planKind: 'paid',
    creditsUsed: 0,
    creditsTotal: 100,
    budgetTotalCents: 10_000,
    budgetRemainingCents: 10_000,
  }, true, true)
  const zdrModels = buildSelectableTextModels(paidZdrAccess)

  assert.ok(zdrModels.length > 0)
  assert.ok(zdrModels.every((model) => model.supportsZeroDataRetention))
})
