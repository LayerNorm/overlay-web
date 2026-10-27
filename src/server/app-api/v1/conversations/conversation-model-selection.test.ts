import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { resolveConversationModelSelection } from './conversation-model-selection'

test('free-tier conversation selection preserves valid BYOK act and ask models', () => {
  const modelId = 'byok/connection_123/gpt-5.6-luna'
  assert.deepEqual(resolveConversationModelSelection({
    isFreeTier: true,
    askModelIds: [modelId],
    actModelId: modelId,
  }), {
    askModelIds: [modelId],
    actModelId: modelId,
  })
})

test('free-tier conversation selection clamps paid and malformed BYOK models to Auto', () => {
  assert.deepEqual(resolveConversationModelSelection({
    isFreeTier: true,
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  }), {
    askModelIds: [FREE_TIER_DEFAULT_MODEL_ID],
    actModelId: FREE_TIER_DEFAULT_MODEL_ID,
  })
  assert.deepEqual(resolveConversationModelSelection({
    isFreeTier: true,
    askModelIds: ['byok/invalid'],
    actModelId: 'byok/invalid',
  }), {
    askModelIds: [FREE_TIER_DEFAULT_MODEL_ID],
    actModelId: FREE_TIER_DEFAULT_MODEL_ID,
  })
})

test('paid-tier conversation selection keeps the selected catalog model', () => {
  assert.deepEqual(resolveConversationModelSelection({
    isFreeTier: false,
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  }), {
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  })
})
