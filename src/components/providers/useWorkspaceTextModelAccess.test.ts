import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { FREE_TIER_AUTO_MODEL_ID, isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import {
  buildPickerTextModels,
  buildSelectableTextModels,
  isTextModelLocked,
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

test('picker models include paid models for restricted workspaces and keep Auto first', () => {
  const pickerModels = buildPickerTextModels({
    effectiveOnlyAllowZdrModels: false,
    isModelAccessRestricted: true,
  })

  assert.equal(pickerModels[0]?.id, FREE_TIER_AUTO_MODEL_ID)
  assert.ok(pickerModels.some((model) => !isFreeTierChatModelId(model.id)))
  assert.ok(pickerModels.every((model) => model.id !== 'nvidia/nemotron-nano-9b-v2'))
})

test('picker models apply the effective ZDR filter without changing ordering', () => {
  const pickerModels = buildPickerTextModels({
    effectiveOnlyAllowZdrModels: true,
    isModelAccessRestricted: true,
  })
  const expectedModels = getModelsByIntelligence(true)
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    .filter((model) => model.supportsZeroDataRetention)

  assert.ok(pickerModels.length > 0)
  assert.ok(pickerModels.every((model) => model.supportsZeroDataRetention))
  assert.deepEqual(pickerModels.map((model) => model.id), expectedModels.map((model) => model.id))
})

test('premium text models lock only when access is restricted and are exempt for BYOK and free models', () => {
  assert.equal(isTextModelLocked('anthropic/claude-opus-4.7', true), true)
  assert.equal(isTextModelLocked(FREE_TIER_AUTO_MODEL_ID, true), false)
  assert.equal(isTextModelLocked('byok/personal/gpt-5', true), false)
  assert.equal(isTextModelLocked('anthropic/claude-opus-4.7', false), false)
})
