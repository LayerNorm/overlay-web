import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, streamText } from 'ai'
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
  const result = await generateText({ model, prompt: 'say hello', maxRetries: 0 })
  assert.equal(result.text, 'fixture response')
  assert.equal(requestBody?.stream, true)
  assert.equal(requestBody?.store, false)
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
