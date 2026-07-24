const DEFAULT_MAX_JSON_BYTES = 256 * 1024

export async function readBoundedJson(
  response: Response,
  maxBytes = DEFAULT_MAX_JSON_BYTES
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('invalid_json_response_limit')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('json_response_too_large')
  }
  if (!response.body) throw new Error('json_response_missing_body')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel('json_response_too_large')
        throw new Error('json_response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const payload = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    payload.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown
  } catch {
    throw new Error('invalid_json_response')
  }
}
