import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeRelayJson, encodeRelayJson } from './index'

test('the private model relay keeps bytes, URLs and dates and drops signals', () => {
  const options = {
    prompt: [{
      role: 'user',
      content: [
        { type: 'file', mediaType: 'image/png', data: new Uint8Array([0, 1, 2, 255]) },
        { type: 'file', mediaType: 'image/png', data: new URL('https://example.com/a.png') },
      ],
    }],
    abortSignal: new AbortController().signal,
    maxOutputTokens: 100,
    skipped: undefined,
  }
  const decoded = decodeRelayJson<typeof options>(encodeRelayJson(options))
  const [bytes, url] = decoded.prompt[0]!.content
  assert.deepEqual(Array.from(bytes!.data as Uint8Array), [0, 1, 2, 255])
  assert.ok(url!.data instanceof URL)
  assert.equal((url!.data as URL).href, 'https://example.com/a.png')
  assert.equal('abortSignal' in decoded, false)
  assert.equal('skipped' in decoded, false)
  assert.equal(decoded.maxOutputTokens, 100)
})

test('stream parts keep their dates and errors keep only their message', () => {
  const part = decodeRelayJson<{ timestamp: Date }>(encodeRelayJson({ type: 'response-metadata', timestamp: new Date(5) }))
  assert.equal(part.timestamp.getTime(), 5)
  const error = decodeRelayJson<{ error: Record<string, unknown> }>(encodeRelayJson({ type: 'error', error: new TypeError('nope') }))
  assert.deepEqual(error.error, { name: 'TypeError', message: 'nope' })
})

test('large byte arrays survive the round trip', () => {
  const big = new Uint8Array(200_000).map((_, index) => index % 251)
  const decoded = decodeRelayJson<{ data: Uint8Array }>(encodeRelayJson({ data: big }))
  assert.equal(decoded.data.length, big.length)
  assert.equal(decoded.data[199_999], big[199_999])
})
