import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSupportedCodexRequest, assertSupportedSubscriptionRequest } from './request-validation'

test('accepts inline and URL images in messages', () => {
  for (const imageUrl of ['https://example.test/a.png', 'data:image/png;base64,AQID']) {
    for (const provider of [assertSupportedCodexRequest, assertSupportedSubscriptionRequest]) {
      assert.doesNotThrow(() => provider({
        model: 'm',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'What is in this picture?' },
          { type: 'input_image', image_url: imageUrl },
        ] }],
      }, 'm'))
    }
  }
})

test('rejects other media, stored image ids, hosted tools, ZDR, and unsupported semantic options', () => {
  for (const body of [
    { model: 'm', input: [{ type: 'input_file', file_data: 'data:application/pdf;base64,AQID' }] },
    { model: 'm', input: [{ type: 'input_audio', input_audio: { data: 'AQID', format: 'wav' } }] },
    { model: 'm', input: [{ type: 'input_image', file_id: 'file-1' }] },
    { model: 'm', tools: [{ type: 'web_search' }] },
    { model: 'm', zero_data_retention: true },
  ]) {
    assert.throws(() => assertSupportedCodexRequest(body, 'm'))
  }
  for (const option of ['truncation', 'user', 'previous_response_id', 'prompt_cache_retention']) {
    assert.throws(
      () => assertSupportedCodexRequest({ model: 'm', [option]: 'unsupported' }, 'm'),
      new RegExp(`Subscription requests do not support ${option}`),
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
    input: [{ role: 'user', content: [{ type: 'input_file', file_data: 'data:application/pdf;base64,AQID' }] }],
  }, 'm'), /text and image requests only/)
  assert.throws(() => assertSupportedCodexRequest({ model: 'other' }, 'm'), /model mismatch/)
})

test('Codex accepts custom text tools while unsupported providers reject that shape', () => {
  const body = {
    model: 'm',
    input: [{ role: 'user', content: 'run the text tool' }],
    tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch', format: { type: 'text' } }],
  }
  assert.doesNotThrow(() => assertSupportedCodexRequest(body, 'm'))
  assert.throws(() => assertSupportedSubscriptionRequest(body, 'm'), /Only function tools/)
  assert.throws(() => assertSupportedCodexRequest({
    ...body,
    tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'json_schema' } }],
  }, 'm'), /Invalid Codex custom text tool/)
})
