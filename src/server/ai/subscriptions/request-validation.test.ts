import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSupportedCodexRequest } from './request-validation'

test('rejects media, hosted tools, ZDR, and unsupported semantic options', () => {
  for (const body of [
    { model: 'm', input: [{ type: 'input_image', image_url: 'https://example.test/a.png' }] },
    { model: 'm', tools: [{ type: 'web_search' }] },
    { model: 'm', zero_data_retention: true },
  ]) {
    assert.throws(() => assertSupportedCodexRequest(body, 'm'))
  }
  for (const option of ['truncation', 'user', 'previous_response_id', 'prompt_cache_retention']) {
    assert.throws(
      () => assertSupportedCodexRequest({ model: 'm', [option]: 'unsupported' }, 'm'),
      new RegExp(`Codex subscription requests do not support ${option}`),
    )
  }
})

test('validates tool schemas without mistaking property names for media input', () => {
  assert.doesNotThrow(() => assertSupportedCodexRequest({
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
  assert.throws(() => assertSupportedCodexRequest({
    model: 'm',
    input: [{ type: 'input_image', image_url: 'https://example.test/a.png' }],
  }, 'm'), /text-only/)
  assert.throws(() => assertSupportedCodexRequest({ model: 'other' }, 'm'), /model mismatch/)
})
