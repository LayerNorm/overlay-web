import { describe, expect, it } from 'vitest'
import { readBoundedJson } from './bounded-json-response'

describe('bounded JSON response', () => {
  it('parses JSON inside the configured bound', async () => {
    await expect(readBoundedJson(new Response('{"ok":true}'), 64)).resolves.toEqual({
      ok: true
    })
  })

  it('rejects declared, streamed, and malformed oversized responses', async () => {
    await expect(
      readBoundedJson(
        new Response('{"ok":true}', {
          headers: { 'content-length': '1024' }
        }),
        64
      )
    ).rejects.toThrow('json_response_too_large')
    await expect(readBoundedJson(new Response(`"${'x'.repeat(128)}"`), 64)).rejects.toThrow(
      'json_response_too_large'
    )
    await expect(readBoundedJson(new Response('{bad json}'), 64)).rejects.toThrow(
      'invalid_json_response'
    )
  })
})
