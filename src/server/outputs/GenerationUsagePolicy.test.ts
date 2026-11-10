import assert from 'node:assert/strict'
import test from 'node:test'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { UnlimitedGenerationUsagePolicy } from './GenerationUsagePolicy'

test('unlimited generation usage policy never refuses and charges nothing', async () => {
  const policy = new UnlimitedGenerationUsagePolicy(new UnlimitedUsagePolicy())
  const entitlements = await policy.getEntitlements({ userId: 'user_1' })
  assert.deepEqual(await policy.ensureBudgetNotLow({
    entitlements, kind: 'generation', operationId: 'media.generate-image', userId: 'user_1',
  }), { ok: true, entitlements })
  assert.deepEqual(await policy.charge(), { budgetLow: false })
  assert.equal(policy.mode, 'unlimited')
  assert.equal('reserve' in policy, false)
})
