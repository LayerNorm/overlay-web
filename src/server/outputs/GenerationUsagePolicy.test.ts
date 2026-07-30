import assert from 'node:assert/strict'
import test from 'node:test'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { UnlimitedGenerationUsagePolicy } from './GenerationUsagePolicy'

test('unlimited generation usage policy explicitly permits provider work without reservations', async () => {
  const policy = new UnlimitedGenerationUsagePolicy(new UnlimitedUsagePolicy())
  const entitlements = await policy.getEntitlements({ userId: 'user_1' })
  const reservation = await policy.reserve({
    entitlements,
    kind: 'generation',
    modelId: 'image/model',
    operationId: 'media.generate-image',
    providerCostUsd: 1,
    requestFingerprint: 'generation-policy-test',
    userId: 'user_1',
  })
  assert.equal(policy.mode, 'unlimited')
  assert.equal(entitlements.planKind, 'paid')
  assert.deepEqual(reservation, {
    ok: true,
    reservationId: null,
    reservedCents: 0,
    entitlements,
  })
  assert.deepEqual(await policy.finalize(), { success: true, skipped: true })
})
