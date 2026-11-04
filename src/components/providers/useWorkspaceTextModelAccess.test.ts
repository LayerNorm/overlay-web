import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelsByIntelligence, registerByokModels } from '@/shared/ai/gateway/model-data'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'
import {
  buildPickerTextModels,
  buildSelectableTextModels,
  isTextModelLocked,
  resolveEntitlementDerived,
} from './useWorkspaceTextModelAccess'

test('unsubscribed and exhausted workspaces browse the full catalog but cannot use models', () => {
  const unpaidAccess = resolveEntitlementDerived(null, true, false)
  const exhaustedAccess = resolveEntitlementDerived({
    tier: 'pro',
    planKind: 'paid',
    creditsUsed: 100,
    creditsTotal: 100,
    budgetTotalCents: 10_000,
    budgetRemainingCents: 0,
  }, true, false)
  const paidAccess = resolveEntitlementDerived({
    tier: 'pro',
    planKind: 'paid',
    creditsUsed: 0,
    creditsTotal: 100,
    budgetTotalCents: 10_000,
    budgetRemainingCents: 10_000,
  }, true, false)
  const unpaidModels = buildSelectableTextModels(unpaidAccess)
  const exhaustedModels = buildSelectableTextModels(exhaustedAccess)
  const paidModels = buildSelectableTextModels(paidAccess)
  const expected = getModelsByIntelligence()
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    .map((model) => model.id)

  assert.deepEqual(unpaidModels.map((model) => model.id), expected)
  assert.deepEqual(exhaustedModels.map((model) => model.id), expected)
  assert.deepEqual(paidModels.map((model) => model.id), expected)
  assert.equal(unpaidAccess.isModelAccessRestricted, true)
  assert.equal(exhaustedAccess.isModelAccessRestricted, true)
  assert.equal(isTextModelLocked('byok/personal/custom:free', true), true)
  assert.equal(isRetiredHostedModelId('byok/personal/custom:free'), false)
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

test('billing-disabled deployments keep the full list without subscription data', () => {
  const unknownAccess = resolveEntitlementDerived(null, false, false)
  assert.equal(unknownAccess.isModelAccessRestricted, false)
  assert.ok(buildSelectableTextModels(unknownAccess).length > 2)
})

test('picker models keep the complete paid catalog visible when access is restricted', () => {
  const pickerModels = buildPickerTextModels({
    effectiveOnlyAllowZdrModels: false,
  })

  assert.ok(pickerModels.length > 2)
  assert.ok(pickerModels.every((model) => model.id !== 'nvidia/nemotron-nano-9b-v2'))
})

test('picker models apply the effective ZDR filter without changing ordering', () => {
  const pickerModels = buildPickerTextModels({
    effectiveOnlyAllowZdrModels: true,
  })
  const expectedModels = getModelsByIntelligence()
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    .filter((model) => model.supportsZeroDataRetention)

  assert.ok(pickerModels.length > 0)
  assert.ok(pickerModels.every((model) => model.supportsZeroDataRetention))
  assert.deepEqual(pickerModels.map((model) => model.id), expectedModels.map((model) => model.id))
})

test('all text models, including BYOK, lock when access is restricted', () => {
  assert.equal(isTextModelLocked('anthropic/claude-opus-4.7', true), true)
  assert.equal(isTextModelLocked('byok/personal/gpt-5', true), true)
  assert.equal(isTextModelLocked('anthropic/claude-opus-4.7', false), false)
})

test('registered subscription models remain visible while respecting paid access', () => {
  registerByokModels([{ _id: 'personal', providerId: 'subscription:codex', authKind: 'subscription', subscriptionProvider: 'codex', endpoint: '', displayName: 'ChatGPT', enabledModelIds: ['sol'], status: 'active', isDefault: false, isDeletable: true }])
  try {
    const modelId = 'byok/personal/sol'
    const pickerModels = buildPickerTextModels({ effectiveOnlyAllowZdrModels: false })
    const restrictedAccess = resolveEntitlementDerived(null, true, false)
    const fundedAccess = resolveEntitlementDerived({
      tier: 'pro',
      planKind: 'paid',
      creditsUsed: 0,
      creditsTotal: 100,
      budgetTotalCents: 10_000,
      budgetRemainingCents: 10_000,
    }, true, false)

    assert.ok(pickerModels.some((model) => model.id === modelId))
    assert.equal(isTextModelLocked(modelId, restrictedAccess.isModelAccessRestricted), true)
    assert.equal(isTextModelLocked(modelId, fundedAccess.isModelAccessRestricted), false)
  } finally {
    registerByokModels([])
  }
})
