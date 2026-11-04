import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

import { resolveDefaultChatModelSelection } from './default-chat-model'

const byokModelId = 'byok/connection_1/vendor/model-a'

test('defaults retain valid BYOK model selections', () => {
  assert.deepEqual(resolveDefaultChatModelSelection({
    defaultActModelId: byokModelId,
    defaultAskModelIds: [byokModelId],
  }), {
    actModelId: byokModelId,
    askModelIds: [byokModelId],
  })
})

test('ZDR-only defaults reject BYOK models with unknown retention guarantees', () => {
  const result = resolveDefaultChatModelSelection({
    defaultActModelId: byokModelId,
    defaultAskModelIds: [byokModelId],
    onlyAllowZdrModels: true,
  })
  assert.notEqual(result.actModelId, byokModelId)
  assert.equal(result.askModelIds.includes(byokModelId), false)
})

test('malformed BYOK defaults use the paid model default', () => {
  const result = resolveDefaultChatModelSelection({
    defaultActModelId: 'byok/missing-model',
    defaultAskModelIds: ['byok/missing-model'],
  })
  assert.equal(result.actModelId, DEFAULT_MODEL_ID)
  assert.deepEqual(result.askModelIds, [DEFAULT_MODEL_ID])
})
