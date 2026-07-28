import { randomUUID } from 'node:crypto'

export function createTranscriptionIdempotencyKey(): string {
  return `desktop-transcription:${randomUUID()}`
}

export function createTranscriptionRequestHeaders(
  accessToken: string,
  idempotencyKey: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Idempotency-Key': idempotencyKey
  }
}
