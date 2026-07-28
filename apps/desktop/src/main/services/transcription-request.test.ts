import { describe, expect, it } from 'vitest'
import {
  createTranscriptionIdempotencyKey,
  createTranscriptionRequestHeaders
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
    expect(createTranscriptionRequestHeaders('access-token', 'operation-id')).toEqual({
      Authorization: 'Bearer access-token',
      'Idempotency-Key': 'operation-id'
    })
  })
})
