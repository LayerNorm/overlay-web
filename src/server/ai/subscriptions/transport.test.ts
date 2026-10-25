import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedStream, completedResponse } from './transport'

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
