import type { NextRequest } from 'next/server'

export async function requestExceedsByteLimit(
  request: NextRequest,
  maxBytes: number,
): Promise<boolean> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return true

  const body = request.clone().body
  if (!body) return false

  const reader = body.getReader()
  let bytesRead = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return false
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        // A cloned request body is backed by a tee. Awaiting cancellation can
        // block until the untouched downstream branch is consumed.
        void reader.cancel()
        return true
      }
    }
  } finally {
    reader.releaseLock()
  }
}
