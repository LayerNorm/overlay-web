import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDefaultChatModelSelection } from './default-chat-model'

const byokModelId = 'byok/connection_1/vendor/model-a'

test('free-tier defaults retain user-funded BYOK model selections', () => {
  assert.deepEqual(resolveDefaultChatModelSelection({
    defaultActModelId: byokModelId,
    defaultAskModelIds: [byokModelId],
    isFreeTier: true,
  }), {
    actModelId: byokModelId,
    askModelIds: [byokModelId],
  })
})

test('ZDR-only defaults reject BYOK models with unknown retention guarantees', () => {
  const result = resolveDefaultChatModelSelection({
    defaultActModelId: byokModelId,
    defaultAskModelIds: [byokModelId],
    isFreeTier: false,
    onlyAllowZdrModels: true,
  })
  assert.notEqual(result.actModelId, byokModelId)
  assert.equal(result.askModelIds.includes(byokModelId), false)
})

test('malformed BYOK defaults are rejected before model selection', () => {
  const result = resolveDefaultChatModelSelection({
    defaultActModelId: 'byok/missing-model',
    defaultAskModelIds: ['byok/missing-model'],
    isFreeTier: true,
  })
  assert.equal(result.actModelId, 'openrouter/free')
  assert.deepEqual(result.askModelIds, ['openrouter/free'])
})
