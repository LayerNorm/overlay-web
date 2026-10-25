import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCodexResponsesBody } from './request-validation'

test('normalizes supported Codex Responses requests without dropping tool history', () => {
  const input = [
    { role: 'system', content: 'You are helpful.' },
    { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-1', output: 'result' },
    { type: 'reasoning', encrypted_content: 'opaque' },
  ]
  const normalized = normalizeCodexResponsesBody({
    model: 'account-model',
    input,
    tools: [{
      type: 'function',
      name: 'lookup',
      parameters: { type: 'object', properties: {} },
    }],
  }, 'account-model')
  assert.deepEqual(normalized.input, [
    { role: 'developer', content: 'You are helpful.' },
    ...input.slice(1),
  ])
  assert.deepEqual(normalized.include, ['reasoning.encrypted_content'])
  assert.equal(normalized.instructions, '')
  assert.equal(normalized.stream, true)
  assert.equal(normalized.store, false)
})

test('rejects media, hosted tools, ZDR, and unsupported semantic options', () => {
  for (const body of [
    { model: 'm', input: [{ type: 'input_image', image_url: 'https://example.test/a.png' }] },
    { model: 'm', tools: [{ type: 'web_search' }] },
    { model: 'm', zero_data_retention: true },
    { model: 'm', temperature: 0.4 },
  ]) {
    assert.throws(() => normalizeCodexResponsesBody(body, 'm'))
  }
})

test('function JSON schema property names do not masquerade as media input', () => {
  assert.doesNotThrow(() => normalizeCodexResponsesBody({
    model: 'm',
    input: [{ role: 'user', content: 'describe the URL field' }],
    tools: [{
      type: 'function',
      name: 'lookup',
      parameters: {
        type: 'object',
        properties: { image_url: { type: 'string' } },
      },
    }],
  }, 'm'))
  assert.throws(() => normalizeCodexResponsesBody({
    model: 'm',
    input: [{ type: 'input_image', image_url: 'https://example.test/a.png' }],
  }, 'm'), /text-only/)
})
