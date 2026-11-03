import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { resolveConversationModelSelection } from './conversation-model-selection'

test('conversation selection preserves valid BYOK act and ask models', () => {
  const modelId = 'byok/connection_123/gpt-5.6-luna'
  assert.deepEqual(resolveConversationModelSelection({
    askModelIds: [modelId],
    actModelId: modelId,
  }), {
    askModelIds: [modelId],
    actModelId: modelId,
  })
})

test('conversation selection retains paid defaults and uses the paid default for malformed BYOK ids', () => {
  assert.deepEqual(resolveConversationModelSelection({
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  }), {
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  })
  assert.deepEqual(resolveConversationModelSelection({
    askModelIds: ['byok/invalid'],
    actModelId: 'byok/invalid',
  }), {
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  })
})

test('paid-tier conversation selection keeps the selected catalog model', () => {
  assert.deepEqual(resolveConversationModelSelection({
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  }), {
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
  })
})

test('retired hosted models require explicit selection rather than silently switching', () => {
  assert.throws(() => resolveConversationModelSelection({
    askModelIds: ['openrouter/free'],
    actModelId: 'openrouter/free',
  }), /Choose a supported paid model before sending/)
})
