import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { isRetiredHarnessModelId, nativeAgentModelId } from './agent-model'

test('agents saved with a retired third-party harness model run on the default model', () => {
  assert.equal(isRetiredHarnessModelId('byo/codex#gpt-5'), true)
  assert.equal(nativeAgentModelId('byo/codex#gpt-5'), DEFAULT_MODEL_ID)
  assert.equal(nativeAgentModelId('byo/claude-code'), DEFAULT_MODEL_ID)
})

test('ordinary model ids are kept', () => {
  assert.equal(isRetiredHarnessModelId('anthropic/claude-sonnet-4.6'), false)
  assert.equal(nativeAgentModelId('anthropic/claude-sonnet-4.6'), 'anthropic/claude-sonnet-4.6')
})
