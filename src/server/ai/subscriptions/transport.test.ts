import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, jsonSchema, streamText } from 'ai'
import { boundedStream, completedResponse, createSubscriptionLanguageModel } from './transport'

test('non-stream Responses completion accepts CRLF SSE and returns the completed response', async () => {
  const response = await completedResponse(new Response(
    'data: {"type":"response.completed","response":{"id":"response-1"}}\r\n\r\ndata: [DONE]\r\n\r\n',
    { headers: { 'content-type': 'text/event-stream' } },
  ))
  assert.deepEqual(await response.json(), { id: 'response-1' })
})

test('streaming errors are sanitized while preserving SSE error framing', async () => {
  const source = new Response(
    'event: error\ndata: {"type":"error","error":{"message":"private provider detail"}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
  const text = await new Response(boundedStream(source.body!)).text()
  assert.match(text, /Codex subscription request failed/)
  assert.doesNotMatch(text, /private provider detail/)
})

test('non-stream errors fail with a sanitized message', async () => {
  await assert.rejects(
    completedResponse(new Response(
      'data: {"type":"response.failed","response":{"error":{"message":"private detail"}}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )),
    /Codex did not complete the response/,
  )
})

test('non-stream incomplete responses are not reported as completed', async () => {
  await assert.rejects(
    completedResponse(new Response(
      'data: {"type":"response.incomplete","response":{"error":{"message":"private detail"}}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )),
    /Codex did not complete the response/,
  )
})

const responseBody = {
  id: 'resp-1',
  model: 'account-model',
  output: [{
    id: 'msg-1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'fixture response', annotations: [] }],
  }],
  usage: {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
  },
}

function modelWithFetch(fetcher: typeof fetch) {
  return createSubscriptionLanguageModel({
    ownerId: 'user-1',
    connectionId: 'connection-1',
    providerId: 'codex',
    modelId: 'account-model',
    dispatchService: {
      credentialForDispatch: async () => ({
        v: 1,
        idToken: 'id-token',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        lastRefresh: Date.now(),
      }),
    } as never,
    fetcher,
  })
}

test('AI SDK generateText uses a completed JSON fixture and stateless storage', async () => {
  let requestBody: Record<string, unknown> | undefined
  const model = modelWithFetch(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      'data: {"type":"response.completed","response":' + JSON.stringify(responseBody) + '}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  const result = await generateText({
    model,
    prompt: 'say hello',
    maxRetries: 0,
    maxOutputTokens: 8192,
  })
  assert.equal(result.text, 'fixture response')
  assert.equal(requestBody?.stream, true)
  assert.equal(requestBody?.store, false)
  assert.equal(Object.hasOwn(requestBody ?? {}, 'max_output_tokens'), false)
})

test('AI SDK tool continuation sends complete history rather than stored item references', { timeout: 5_000 }, async () => {
  let requestBody: Record<string, unknown> | undefined
  const model = modelWithFetch(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: responseBody })}\n\n`)
  })
  await generateText({
    model, maxRetries: 0,
    tools: { lookup: { inputSchema: jsonSchema({ type: 'object', properties: {} }) } },
    messages: [
      { role: 'user', content: 'Look it up' },
      { role: 'assistant', content: [
        { type: 'text', text: 'Checking', providerOptions: { openai: { itemId: 'msg-old' } } },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: {},
          providerOptions: { openai: { itemId: 'fc-old' } } },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'text', value: 'found' } },
      ] },
    ],
  })
  const input = requestBody?.input as Array<Record<string, unknown>>
  assert.ok(input.some((item) => item.type === 'function_call' && item.call_id === 'call-1'))
  assert.ok(input.some((item) => item.type === 'function_call_output' && item.call_id === 'call-1'))
  assert.equal(input.some((item) => item.type === 'item_reference'), false)
})

test('AI SDK streaming failures are sanitized and truncated streams fail', { timeout: 5_000 }, async () => {
  for (const payload of [
    'data: {"type":"error","error":{"message":"private-provider-detail"}}\n\n',
    'data: {"type":"response.created","response":{"id":"resp-1","created_at":1,"model":"account-model"}}\n\n',
    'data: private-provider-detail\n\n',
  ]) {
    const model = modelWithFetch(async () => new Response(payload))
    const result = streamText({ model, prompt: 'hi', maxRetries: 0, onError: () => {} })
    const events = []
    for await (const event of result.fullStream) events.push(event)
    assert.ok(events.some((event) => event.type === 'error'))
    assert.doesNotMatch(JSON.stringify(events), /private-provider-detail/)
  }
})

test('AI SDK abort cancels the active upstream subscription stream', { timeout: 5_000 }, async () => {
  const abort = new AbortController()
  let signal: AbortSignal | null | undefined
  let cancelled = false
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  const model = modelWithFetch(async (_input, init) => {
    signal = init?.signal
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"resp-1","created_at":1,"model":"account-model"}}\n\n'))
        signal?.addEventListener('abort', () => { cancelled = true; controller.error(signal?.reason) }, { once: true })
        started()
      },
      cancel() { cancelled = true },
    }))
  })
  const result = streamText({ model, prompt: 'hi', abortSignal: abort.signal, maxRetries: 0, onError: () => {} })
  const consumed = result.consumeStream()
  await ready
  abort.abort()
  await consumed
  assert.equal(signal?.aborted, true)
  assert.equal(cancelled, true)
})

test('AI SDK streamText preserves Responses SSE mode and requires terminal completion', async () => {
  let requestBody: Record<string, unknown> | undefined
  const completion = {
    type: 'response.completed',
    response: responseBody,
  }
  const model = modelWithFetch(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response([
      'data: {"type":"response.created","response":{"id":"resp-stream","created_at":1,"model":"account-model"}}\n\n',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg-1","type":"message","role":"assistant","content":[]}}\n\n',
      'data: {"type":"response.output_text.delta","item_id":"msg-1","output_index":0,"content_index":0,"delta":"streamed"}\n\n',
      'data: {"type":"response.output_text.done","item_id":"msg-1","output_index":0,"text":"streamed"}\n\n',
      `data: ${JSON.stringify(completion)}\n\n`,
    ].join(''), { headers: { 'content-type': 'text/event-stream' } })
  })
  const result = await streamText({ model, prompt: 'say hello', maxRetries: 0 })
  assert.equal(await result.text, 'streamed')
  assert.equal(requestBody?.stream, true)
  assert.equal(requestBody?.store, false)
})
