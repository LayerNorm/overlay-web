import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentDriveTokenClaims } from './agent-drive-token'
import { driveUploadBodySchema, driveCommitBodySchema, driveContentResultSchema } from '@layernorm/overlay-agent-bridge-protocol'
export { driveUploadBodySchema, driveCommitBodySchema, driveContentResultSchema }
import { verifyDriveMetadataMac } from './agent-drive-entry-grants'
import { drivePathSegments } from '../../../packages/overlay-agent-bridge-protocol/src/drive-path'

const id = z.string().min(1).max(200)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const bytes = z.number().int().nonnegative().max(16 * 1024 * 1024)
const create = z.object({ kind: z.literal('create'), name: z.string().min(1).max(255), parentId: id.optional() }).strict()
const operation = z.discriminatedUnion('kind', [create,
  z.object({ kind: z.literal('replace'), fileId: id, path: z.string().min(1).max(4096), updatedAt: z.number().int().nonnegative() }).strict()])
export const driveUploadRecordSchema = z.object({ uploadId: z.string().uuid(), operation,
  ownerUserId: id, name: z.string(), parentId: id.optional(), sha256: hash, sizeBytes: bytes, mimeType: z.string(),
  stagingKey: z.string().min(1), finalKey: z.string().min(1), expiresAt: z.number().int(),
  state: z.discriminatedUnion('kind', [z.object({ kind: z.literal('pending') }),
    z.object({ kind: z.literal('committed'), result: driveContentResultSchema })]),
})
export type DriveUploadRecord = z.infer<typeof driveUploadRecordSchema>
export type DriveContentResult = z.infer<typeof driveContentResultSchema>
type Intent = Pick<z.infer<typeof driveUploadBodySchema>, 'requestId' | 'sha256' | 'sizeBytes' | 'mimeType'> & {
  uploadId: string; operation: z.infer<typeof operation>
}
export type AgentDriveContentRepository = {
  authorize(): Promise<void>
  intent(input: Intent): Promise<DriveUploadRecord>
  read(uploadId: string): Promise<DriveUploadRecord>
  commit(input: { uploadId: string; verifiedSha256: string; verifiedSizeBytes: number; textPrefix?: string }): Promise<DriveContentResult>
}

/** Full staging bytes are verified once, then copied through the server's own credentials. */
export class AgentDriveContentService {
  constructor(private readonly dependencies: {
    secret: string
    verifyToken(token: string | null): AgentDriveTokenClaims | null
    repository(claims: AgentDriveTokenClaims): AgentDriveContentRepository
    storage: {
      checkBudget(bytes: number): Promise<unknown>
      uploadUrl(key: string, mime: string, bytes: number, sha256: string, ttlSeconds: number): Promise<string>
      read(key: string, maximumBytes: number): Promise<Uint8Array>
      seal(key: string, bytes: Uint8Array, mime: string): Promise<void>
      discard?(key: string): Promise<void>
    }
    now?: () => number
  }) {}

  async intent(token: string | null, body: z.infer<typeof driveUploadBodySchema>) {
    const input = driveUploadBodySchema.parse(body)
    const { claims, repository } = await this.authorize(token)
    let op: Intent['operation']
    if (input.operation.kind === 'replace') {
      const { entry, metadataMac } = input.operation
      if (entry.kind !== 'file') throw Error('DRIVE_INVALID_UPLOAD')
      drivePathSegments(entry.path)
      verifyDriveMetadataMac(this.dependencies.secret, claims, entry, metadataMac)
      op = { kind: 'replace', fileId: entry.fileId, path: entry.path, updatedAt: entry.updatedAt }
    } else {
      if (drivePathSegments(input.operation.name).length !== 1) throw Error('DRIVE_UNSAFE_PATH')
      op = input.operation
    }
    const upload = await repository.intent({ requestId: input.requestId, operation: op,
      uploadId: randomUUID(), sha256: input.sha256, sizeBytes: input.sizeBytes, mimeType: input.mimeType })
    if (upload.state.kind === 'committed') return { uploadId: upload.uploadId, state: 'committed' as const, result: upload.state.result }
    const ttl = Math.min(120, Math.floor((upload.expiresAt - (this.dependencies.now ?? Date.now)()) / 1000))
    if (ttl < 1) throw Error('DRIVE_UPLOAD_EXPIRED')
    if (upload.stagingKey === upload.finalKey) throw Error('DRIVE_INVALID_UPLOAD')
    await this.dependencies.storage.checkBudget(upload.sizeBytes)
    const url = await this.dependencies.storage.uploadUrl(upload.stagingKey, upload.mimeType, upload.sizeBytes, upload.sha256, ttl)
    await repository.authorize()
    return { uploadId: upload.uploadId, state: 'pending' as const, url,
      headers: { 'content-type': upload.mimeType, 'x-amz-checksum-sha256': Buffer.from(upload.sha256, 'hex').toString('base64') },
      sizeBytes: upload.sizeBytes, expiresIn: ttl }
  }

  async commit(token: string | null, body: z.infer<typeof driveCommitBodySchema>): Promise<DriveContentResult> {
    const input = driveCommitBodySchema.parse(body)
    const { repository } = await this.authorize(token)
    const upload = await repository.read(input.uploadId)
    if (upload.state.kind === 'committed') return this.finish(upload, upload.state.result)
    if (upload.expiresAt <= (this.dependencies.now ?? Date.now)()) throw Error('DRIVE_UPLOAD_EXPIRED')
    const content = await this.dependencies.storage.read(upload.stagingKey, Math.max(1, upload.sizeBytes))
    if (content.byteLength !== upload.sizeBytes || createHash('sha256').update(content).digest('hex') !== upload.sha256) throw Error('DRIVE_UPLOAD_CHANGED')
    const textPrefix = contentPrefix(content, upload.mimeType)
    await repository.authorize()
    // Never copy directly from the mutable staging key. Seal the exact verified
    // byte buffer so a concurrent client PUT cannot change the published version.
    await this.dependencies.storage.seal(upload.finalKey, content, upload.mimeType)
    await repository.authorize()
    const result = await repository.commit({ uploadId: upload.uploadId, verifiedSha256: upload.sha256,
      verifiedSizeBytes: upload.sizeBytes, ...(textPrefix === undefined ? {} : { textPrefix }) })
    return this.finish(upload, result)
  }

  private async finish(upload: DriveUploadRecord, result: DriveContentResult) {
    // Inline notes do not reference the sealed object. Only a confirmed commit
    // can discard it; an ambiguous/lost acknowledgement must leave it intact.
    if (!result.objectStored) await this.dependencies.storage.discard?.(upload.finalKey).catch((_error) => undefined)
    return result
  }

  private async authorize(token: string | null) {
    const claims = this.dependencies.verifyToken(token)
    if (!claims) throw Error('DRIVE_UNAUTHORIZED')
    const repository = this.dependencies.repository(claims)
    await repository.authorize()
    return { claims, repository }
  }
}

function contentPrefix(content: Uint8Array, mime: string): string | undefined {
  if (!mime.startsWith('text/') && !['application/json', 'application/xml', 'application/javascript', 'image/svg+xml'].includes(mime)) return undefined
  try { new TextDecoder('utf-8', { fatal: true }).decode(content) }
  catch (_error) { throw Error('DRIVE_INVALID_UPLOAD') }
  // A streaming prefix decoder omits an incomplete final UTF-8 code point.
  return new TextDecoder('utf-8').decode(content.slice(0, 128 * 1024), { stream: true })
}
