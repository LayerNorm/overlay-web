import 'server-only'

import { createHash } from 'node:crypto'

export type ArtifactObjectVerification =
  | { kind: 'missing' }
  | { kind: 'verified'; checksumSha256: string; sizeBytes: number; mimeType: string }

export async function verifyArtifactObject(args: {
  key: string
  sizeBytes: number
  mimeType: string
  checksumSha256: string
  maxBytes: number
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>
  generatePresignedDownloadUrl(key: string): Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<ArtifactObjectVerification> {
  const expectedMimeType = args.mimeType.toLowerCase().split(';')[0]!.trim()
  let head: Awaited<ReturnType<typeof args.headObject>>
  try {
    head = await args.headObject(args.key)
  } catch (_error) {
    throw new Error('ARTIFACT_HEAD_FAILED')
  }
  if (!head) return { kind: 'missing' }
  if (head.sizeBytes !== args.sizeBytes
    || (head.contentType ?? '').toLowerCase().split(';')[0]!.trim() !== expectedMimeType) {
    throw new Error('ARTIFACT_HEAD_MISMATCH')
  }

  let url: string
  try {
    url = await args.generatePresignedDownloadUrl(args.key)
  } catch (_error) {
    throw new Error('ARTIFACT_READBACK_FAILED')
  }

  const fetchImpl = args.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    })
  } catch (_error) {
    throw new Error('ARTIFACT_READBACK_FAILED')
  }
  if (response.status === 404) {
    await response.body?.cancel().catch((_error) => undefined)
    return { kind: 'missing' }
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch((_error) => undefined)
    throw new Error('ARTIFACT_READBACK_FAILED')
  }

  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let totalBytes = 0
  let completed = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > args.maxBytes || totalBytes > args.sizeBytes) {
        throw new Error('ARTIFACT_READBACK_OVERSIZE')
      }
      hash.update(value)
    }
    if (totalBytes !== args.sizeBytes) throw new Error('ARTIFACT_READBACK_TRUNCATED')
    const checksumSha256 = hash.digest('hex')
    if (checksumSha256 !== args.checksumSha256) throw new Error('ARTIFACT_CHECKSUM_MISMATCH')
    return {
      kind: 'verified',
      checksumSha256,
      sizeBytes: totalBytes,
      mimeType: expectedMimeType,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ARTIFACT_')) throw error
    throw new Error('ARTIFACT_READBACK_FAILED')
  } finally {
    if (!completed) await reader.cancel().catch((_error) => undefined)
    reader.releaseLock()
  }
}
