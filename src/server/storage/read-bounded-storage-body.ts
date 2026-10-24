import 'server-only'

/** Enforce the allocation cap while reading, even when the server omits or lies about its length. */
export async function readBoundedStorageBody(
  stream: ReadableStream<Uint8Array>, maximumBytes: number, declaredBytes?: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw Error('STORAGE_INVALID_READ_LIMIT')
  const reader = stream.getReader()
  let complete = false
  try {
    if (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maximumBytes)) {
      throw Error('STORAGE_READ_LIMIT_EXCEEDED')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maximumBytes) throw Error('STORAGE_READ_LIMIT_EXCEEDED')
      chunks.push(Uint8Array.from(result.value))
    }
    if (declaredBytes !== undefined && size !== declaredBytes) throw Error('STORAGE_READ_SIZE_CHANGED')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    complete = true
    return bytes
  } finally {
    if (!complete) await reader.cancel().catch((_error) => undefined)
    reader.releaseLock()
  }
}
