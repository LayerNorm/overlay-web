import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText } from 'ai'

import { ByokGateway } from './adapters/byok-gateway'
import { BYOK_PROVIDER_PRESETS, getByokPreset } from './adapters/byok-presets'

function fixtureResponse(url: string): Response {
  const pathname = new URL(url).pathname
  if (pathname.endsWith('/responses')) {
    return new Response(JSON.stringify({
      id: 'resp_fixture',
      object: 'response',
      status: 'completed',
      output: [{
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  if (pathname.endsWith('/messages')) {
    return new Response(JSON.stringify({
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'OK' }],
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({
    id: 'chat_fixture',
    object: 'chat.completion',
    choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

test('BYOK provider registry locks vendor endpoints and explicitly marks the custom preset', () => {
  assert.ok(BYOK_PROVIDER_PRESETS.length > 0)
  for (const preset of BYOK_PROVIDER_PRESETS) {
    if (preset.allowsCustomEndpoint) {
      assert.equal(preset.defaultBaseURL, '')
    } else {
      assert.equal(new URL(preset.defaultBaseURL).protocol, 'https:')
    }
    assert.equal(getByokPreset(preset.id), preset)
  }
})

test('BYOK gateway rejects unknown providers, missing keys, and endpoint overrides', () => {
  assert.throws(() => new ByokGateway({
    connection: { providerId: 'unknown', endpoint: 'https://attacker.example/v1' },
    apiKey: 'secret',
  }), /Unknown BYOK provider preset/)

  assert.throws(() => new ByokGateway({
    connection: { providerId: 'openrouter', endpoint: 'https://attacker.example/v1' },
    apiKey: 'secret',
  }), /locked provider endpoint/)

  assert.throws(() => new ByokGateway({
    connection: { providerId: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
    apiKey: null,
  }), /requires an API key/)

  assert.throws(() => new ByokGateway({
    connection: { providerId: 'custom-openai-compatible', endpoint: 'https://models.example.com/v1' },
    apiKey: 'secret',
  }), /requires a guarded fetch/)

  assert.doesNotThrow(() => new ByokGateway({
    connection: { providerId: 'custom-openai-compatible', endpoint: 'https://models.example.com/v1' },
    apiKey: 'secret',
    fetch: async () => new Response(),
  }))

  // Custom endpoints may be keyless (free / IP-authed gateways) — no
  // Authorization header is sent when no key is configured.
  assert.doesNotThrow(() => new ByokGateway({
    connection: { providerId: 'custom-openai-compatible', endpoint: 'https://models.example.com/v1' },
    apiKey: null,
    fetch: async () => new Response(),
  }))
})

test('OpenCode Go locks its endpoint and resolves model protocols', async () => {
  const { getByokModelProtocol, getByokPreset } = await import('./adapters/byok-presets')
  const preset = getByokPreset('opencode-go')
  assert.ok(preset)
  assert.equal(preset.defaultBaseURL, 'https://opencode.ai/zen/go/v1')
  assert.equal(preset.sessionHeader, 'x-opencode-session')
  assert.equal(getByokModelProtocol(preset, 'glm-5.3-flash'), 'chat')
  assert.equal(getByokModelProtocol(preset, 'grok-4.7'), 'responses')
  assert.equal(getByokModelProtocol(preset, 'gpt-luna'), 'responses')
  assert.equal(getByokModelProtocol(preset, 'claude-haiku-5-5'), 'messages')
  assert.equal(getByokModelProtocol(preset, 'other-model'), 'chat')
})

test('OpenCode Go sends stable session headers and selects protocol routes', async () => {
  const requests: Request[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    return fixtureResponse(request.url)
  }
  const gateway = new ByokGateway({
    connection: { providerId: 'opencode-go', endpoint: 'https://opencode.ai/zen/go/v1' },
    apiKey: 'secret',
    fetch: fetcher,
  })

  const chatModel = await gateway.createLanguageModel('glm-5.3-flash', { sessionId: 'session-1' })
  await generateText({
    model: chatModel.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.equal(new URL(requests[0].url).pathname, '/zen/go/v1/chat/completions')
  assert.equal(requests[0].headers.get('x-opencode-session'), 'session-1')
  assert.match(requests[0].headers.get('user-agent') ?? '', /overlay\/1\.0/)
  assert.equal(requests[0].headers.get('authorization'), 'Bearer secret')

  const stableChatModel = await gateway.createLanguageModel('glm-5.3-flash', {
    headers: { authorization: 'Bearer attacker' },
    sessionId: 'session-1',
  })
  await generateText({
    model: stableChatModel.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.equal(new URL(requests[1].url).pathname, '/zen/go/v1/chat/completions')
  assert.equal(requests[1].headers.get('x-opencode-session'), 'session-1')
  assert.equal(requests[1].headers.get('authorization'), 'Bearer secret')

  const responsesModel = await gateway.createLanguageModel('grok-4.7', { sessionId: 'session-1' })
  await generateText({
    model: responsesModel.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.equal(new URL(requests[2].url).pathname, '/zen/go/v1/responses')
  assert.equal(requests[2].headers.get('x-opencode-session'), 'session-1')

  const messagesModel = await gateway.createLanguageModel('claude-haiku-5-5', { sessionId: 'session-1' })
  await generateText({
    model: messagesModel.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.equal(new URL(requests[3].url).pathname, '/zen/go/v1/messages')
  assert.equal(requests[3].headers.get('x-opencode-session'), 'session-1')
  assert.equal(requests[3].headers.get('x-api-key'), 'secret')
})

test('OpenCode Go generates a session when none is supplied and preserves auth headers', async () => {
  const requests: Request[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    return fixtureResponse(request.url)
  }
  const gateway = new ByokGateway({
    connection: { providerId: 'opencode-go', endpoint: 'https://opencode.ai/zen/go/v1' },
    apiKey: 'secret',
    fetch: fetcher,
  })
  const model = await gateway.createLanguageModel('glm-5.3-flash')
  await generateText({
    model: model.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.match(requests[0].headers.get('x-opencode-session') ?? '', /^[0-9a-f-]{36}$/)
  assert.equal(requests[0].headers.get('authorization'), 'Bearer secret')
})

test('existing custom OpenAI-compatible providers do not receive session headers', async () => {
  const requests: Request[] = []
  const gateway = new ByokGateway({
    connection: { providerId: 'custom-openai-compatible', endpoint: 'https://models.example.com/v1' },
    apiKey: 'secret',
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return fixtureResponse(request.url)
    },
  })
  const model = await gateway.createLanguageModel('model')
  await generateText({
    model: model.implementation as never,
    prompt: 'Hello',
    maxOutputTokens: 8,
    maxRetries: 0,
  })
  assert.equal(requests[0].headers.has('x-opencode-session'), false)
  assert.equal(requests[0].headers.get('authorization'), 'Bearer secret')
})
