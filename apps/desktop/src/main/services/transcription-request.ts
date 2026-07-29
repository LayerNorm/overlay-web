import { randomUUID } from 'node:crypto'

export function createTranscriptionIdempotencyKey(): string {
  return `desktop-transcription:${randomUUID()}`
}

export function createTranscriptionRequestHeaders(
  accessToken: string,
  idempotencyKey: string,
  contentType?: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Idempotency-Key': idempotencyKey,
    ...(contentType ? { 'Content-Type': contentType } : {})
  }
}

export async function encodeTranscriptionMultipart(
  audio: Uint8Array,
  mime: string,
  extension: string,
  prompt?: string
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const formData = new FormData()
  const audioCopy = new ArrayBuffer(audio.byteLength)
  new Uint8Array(audioCopy).set(audio)
  formData.append('audio', new Blob([audioCopy], { type: mime }), `audio.${extension}`)
  if (prompt) formData.append('prompt', prompt)

  // Serialize once so every transport retry uses identical bytes and the same
  // multipart boundary. Otherwise a stable Idempotency-Key is rejected because
  // each new FormData serialization has a different request fingerprint.
  const request = new Request('https://overlay.invalid/transcribe', {
    method: 'POST',
    body: formData
  })
  const contentType = request.headers.get('content-type')
  if (!contentType) throw new Error('transcription_multipart_content_type_missing')
  return {
    body: await request.arrayBuffer(),
    contentType
  }
}
