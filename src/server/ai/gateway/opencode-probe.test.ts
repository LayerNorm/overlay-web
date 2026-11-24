import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkOpenCodeZenKey,
  isOpenCodeChatModel,
  isOpenCodeProviderId,
  sanitizeOpenCodeGoProbeError,
  selectOpenCodeGoProbeModel,
} from './opencode-probe'

test('OpenCode Go probe prefers a free chat model', () => {
  assert.deepEqual(
    selectOpenCodeGoProbeModel([
      { id: 'grok-4.7' },
      { id: 'glm-5.3-flash-free' },
      { id: 'claude-haiku-5-5' },
      { id: 'glm-5.3-flash' },
    ]),
    { id: 'glm-5.3-flash-free' },
  )
})

test('OpenCode Go probe falls back to the first chat model', () => {
  assert.deepEqual(
    selectOpenCodeGoProbeModel([
      { id: 'grok-4.7' },
      { id: 'claude-haiku-5-5' },
      { id: 'glm-5.3-flash' },
    ]),
    { id: 'glm-5.3-flash' },
  )
  assert.equal(selectOpenCodeGoProbeModel([{ id: 'grok-4.7' }]), null)
})

test('OpenCode Go probe failures expose safe categories without secrets', () => {
  const key = 'test-secret'
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('MissingSessionID test-secret'), { statusCode: 400 }),
      key,
    ),
    /MissingSessionID/,
  )
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('invalid api key test-secret'), { statusCode: 401 }),
      key,
    ),
    /rejected the API key/,
  )
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('subscription required test-secret'), { statusCode: 402 }),
      key,
    ),
    /subscription or billing/,
  )
  assert.doesNotMatch(
    sanitizeOpenCodeGoProbeError(new Error('test-secret'), key),
    /test-secret/,
  )
})

test('OpenCode catalog filter keeps only chat models', () => {
  assert.equal(isOpenCodeChatModel({ id: 'kimi-k3', type: 'chat', recommended_api: 'chat-completions' }), true)
  assert.equal(isOpenCodeChatModel({ id: 'gemini-4-argon', type: 'chat', recommended_api: 'interactions' }), true)
  assert.equal(isOpenCodeChatModel({ id: 'legacy' }), true)
  assert.equal(isOpenCodeChatModel({ id: 'voyage-4', type: 'embedding', recommended_api: 'embeddings' }), false)
  assert.equal(isOpenCodeChatModel({ id: 'jev-1.13', type: 'decision', recommended_api: 'systemone' }), false)
  assert.equal(isOpenCodeChatModel({ id: 'gpt-live-1', type: 'realtime', recommended_api: 'live' }), false)
  assert.equal(isOpenCodeProviderId('opencode-zen'), true)
  assert.equal(isOpenCodeProviderId('openrouter'), false)
})

test('OpenCode Zen key check spends nothing and maps auth failures', async () => {
  const requests: Request[] = []
  const respond = (status: number): typeof fetch => async (input, init) => {
    requests.push(new Request(input, init))
    return new Response('{}', { status })
  }
  const args = { endpoint: 'https://opencode.ai/zen/v1/', apiKey: 'test-secret', sessionId: 's1' }
  assert.equal(await checkOpenCodeZenKey({ ...args, fetch: respond(400) }), null)
  const body = await requests[0].json() as { model: string; max_tokens: number }
  assert.equal(new URL(requests[0].url).pathname, '/zen/v1/chat/completions')
  assert.equal(body.model, 'overlay-key-check')
  assert.equal(requests[0].headers.get('authorization'), 'Bearer test-secret')
  assert.equal(requests[0].headers.get('x-opencode-session'), 's1')
  assert.match(await checkOpenCodeZenKey({ ...args, fetch: respond(401) }) ?? '', /rejected the API key/)
  assert.match(await checkOpenCodeZenKey({ ...args, fetch: respond(503) }) ?? '', /HTTP 503/)
  assert.doesNotMatch(await checkOpenCodeZenKey({ ...args, fetch: respond(401) }) ?? '', /test-secret/)
})
