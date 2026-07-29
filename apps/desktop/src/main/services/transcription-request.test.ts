import { describe, expect, it } from 'vitest'
import {
  createTranscriptionIdempotencyKey,
  createTranscriptionRequestHeaders,
  encodeTranscriptionMultipart
} from './transcription-request'

describe('hosted transcription request identity', () => {
  it('creates a unique valid key for each user-initiated transcription attempt', () => {
    const first = createTranscriptionIdempotencyKey()
    const second = createTranscriptionIdempotencyKey()

    expect(first).toMatch(
      /^desktop-transcription:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(second).not.toBe(first)
  })

  it('sends both the Overlay session and idempotency identity', () => {
    expect(
      createTranscriptionRequestHeaders(
        'access-token',
        'operation-id',
        'multipart/form-data; boundary=stable'
      )
    ).toEqual({
      Authorization: 'Bearer access-token',
      'Idempotency-Key': 'operation-id',
      'Content-Type': 'multipart/form-data; boundary=stable'
    })
  })

  it('serializes multipart audio once for byte-identical transport retries', async () => {
    const encoded = await encodeTranscriptionMultipart(
      new Uint8Array([1, 2, 3, 4]),
      'audio/wav',
      'wav',
      'context'
    )

    expect(encoded.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(encoded.body).toBeInstanceOf(ArrayBuffer)
    expect(encoded.body.byteLength).toBeGreaterThan(4)
    expect(new TextDecoder().decode(new Uint8Array(encoded.body))).toContain('context')
  })
})
