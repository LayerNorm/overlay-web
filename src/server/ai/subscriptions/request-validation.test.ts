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
  ]) {
    assert.throws(() => normalizeCodexResponsesBody(body, 'm'))
  }
  for (const option of ['truncation', 'user', 'previous_response_id', 'prompt_cache_retention']) {
    assert.throws(
      () => normalizeCodexResponsesBody({ model: 'm', [option]: 'unsupported' }, 'm'),
      new RegExp(`Codex subscription requests do not support ${option}`),
    )
  }
})

test('strips unsupported output and sampling controls before Codex validation', () => {
  const normalized = normalizeCodexResponsesBody({
    model: 'm',
    input: 'hello',
    max_output_tokens: 8192,
    max_completion_tokens: 4096,
    temperature: 0.4,
    top_p: 0.9,
  }, 'm')
  for (const option of ['max_output_tokens', 'max_completion_tokens', 'temperature', 'top_p']) {
    assert.equal(Object.hasOwn(normalized, option), false)
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
