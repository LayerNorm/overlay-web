import assert from 'node:assert/strict'
import test from 'node:test'
import { byoModelId, codexModelId, parseByoModelId, parseCodexModel } from './agent-model'

test('a connected agent keeps its model after the byo sentinel', () => {
  assert.equal(byoModelId('codex'), 'byo/codex')
  assert.equal(byoModelId('codex', ''), 'byo/codex')
  assert.equal(byoModelId('codex', 'gpt-6-sol[high]'), 'byo/codex#gpt-6-sol[high]')
  assert.deepEqual(parseByoModelId('byo/codex'), { adapterId: 'codex', model: null })
  assert.deepEqual(parseByoModelId('byo/claude-code#opus[1m]'), { adapterId: 'claude-code', model: 'opus[1m]' })
  assert.equal(parseByoModelId('anthropic/claude-sonnet'), null)
})

test('a Codex model id carries its reasoning effort', () => {
  assert.equal(codexModelId('gpt-6-sol', 'high'), 'gpt-6-sol[high]')
  assert.deepEqual(parseCodexModel('gpt-6-sol[high]'), { slug: 'gpt-6-sol', effort: 'high' })
  assert.deepEqual(parseCodexModel('gpt-5.5'), { slug: 'gpt-5.5', effort: 'medium' })
  assert.equal(parseCodexModel(null), null)
})
