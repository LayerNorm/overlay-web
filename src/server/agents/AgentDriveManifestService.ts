import 'server-only'
import type { AgentDriveDownloadCache } from './agent-drive-download-cache'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod/v3'
import { drivePathSegments } from '@layernorm/overlay-agent-bridge-protocol'
import { buildAgentDriveCandidates } from '@/shared/agents/agent-drive-manifest'
import type { AgentDriveTokenClaims } from './agent-drive-token'
import { driveMetadataBodySchema, driveMetadataEntrySchema, type DriveMetadataOperation, type DriveMetadataRequest, type DriveMetadataResult } from './agent-drive-metadata'
import { driveMetadataMac, verifyDriveMetadataMac, driveGrantAuthorityHash } from './agent-drive-entry-grants'
import type { AgentDriveManifestRepository } from './AgentDriveManifestRepository'
import { AgentDriveMaterializer, type AgentDriveManifestEntry } from './AgentDriveMaterializer'

const readyFileSchema = z.object({
  fileId: z.string().min(1).max(200), path: z.string().min(1).max(4096), updatedAt: z.number().int().nonnegative(),
  kind: z.literal('file'), hydration: z.literal('ready'), sizeBytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).extend({ metadataMac: z.string().optional() }).strict().transform(({ metadataMac: _metadataMac, ...entry }) => entry)
type ReadyFile = z.infer<typeof readyFileSchema>
export type AgentDriveHostManifestEntry = AgentDriveManifestEntry & { downloadMac?: string; metadataMac?: string }

/** Scoped read grants and metadata commits. Immutable content uploads use a separate write path. */
export class AgentDriveManifestService {
  constructor(private readonly dependencies: {
    secret: string
    downloads?: AgentDriveDownloadCache
    verifyToken(token: string | null): AgentDriveTokenClaims | null
    repository(claims: AgentDriveTokenClaims): AgentDriveManifestRepository
    materializer(claims: AgentDriveTokenClaims): AgentDriveMaterializer
  }) {
    if (dependencies.secret.trim().length < 32) throw Error('DRIVE_SIGNING_SECRET_UNAVAILABLE')
  }

  async manifest(token: string | null): Promise<{ entries: AgentDriveHostManifestEntry[] }> {
    const { claims, repository } = await this.authorize(token)
    const rows: unknown[] = []
    const cursors = new Set<string>()
    let metadataBytes = 0
    let cursor: string | null = null
    for (;;) {
      await repository.authorize()
      const page = await repository.page(cursor)
      if (page.scope.kind !== claims.scope.kind || page.scope.workspaceId !== claims.scope.workspaceId
        || (page.scope.kind === 'personal' && (claims.scope.kind !== 'personal' || page.scope.ownerUserId !== claims.scope.ownerUserId))
        || page.viewer.userId !== claims.actorUserId || !['owner', 'admin', 'member'].includes(page.viewer.role ?? '')) throw Error('DRIVE_SCOPE_CHANGED')
      metadataBytes += Buffer.byteLength(JSON.stringify(page.rows))
      if (metadataBytes > 32 * 1024 * 1024) throw Error('DRIVE_METADATA_LIMIT')
      rows.push(...page.rows)
      if (rows.length > 10000) throw Error('DRIVE_TOO_MANY_ENTRIES')
      cursor = page.nextCursor
      if (cursor === null) break
      if (cursors.has(cursor)) throw Error('DRIVE_SNAPSHOT_UNAVAILABLE')
      cursors.add(cursor)
    }
    const candidates = buildAgentDriveCandidates({ rows, scope: claims.scope, viewer: { userId: claims.actorUserId, role: 'member' } })
    const entries = await this.dependencies.materializer(claims).manifest(candidates)
    await repository.authorize()
    return { entries: entries.map(entry => ({ ...entry,
      ...(entry.kind === 'file' && entry.hydration === 'ready' ? { downloadMac: this.mac(claims, readyFileSchema.parse(entry)).toString('base64url') } : {}),
      ...(entry.kind === 'folder' || entry.hydration === 'ready' ? { metadataMac: driveMetadataMac(this.dependencies.secret, claims, driveMetadataEntrySchema.parse(entry)).toString('base64url') } : {}),
    })) }
  }

  async download(token: string | null, input: { entry: unknown; downloadMac: string }): Promise<Uint8Array> {
    const { claims, repository } = await this.authorize(token)
    const entry = readyFileSchema.parse(input.entry)
    drivePathSegments(entry.path)
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.downloadMac)) throw Error('DRIVE_INVALID_DOWNLOAD')
    const actual = Buffer.from(input.downloadMac, 'base64url')
    const expected = this.mac(claims, entry)
    if (actual.toString('base64url') !== input.downloadMac || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('DRIVE_INVALID_DOWNLOAD')
    const row = await repository.file(entry.fileId, entry.updatedAt)
    if (!row || typeof row !== 'object') throw Error('DRIVE_FILE_UNAVAILABLE')
    // Paths come from the authenticated snapshot. Source ownership/scope and current revision come from Files.
    const [candidate] = buildAgentDriveCandidates({ rows: [{ ...row, parentId: undefined }], scope: claims.scope,
      viewer: { userId: claims.actorUserId, role: 'member' } })
    if (!candidate || candidate.fileId !== entry.fileId || candidate.updatedAt !== entry.updatedAt) throw Error('DRIVE_SOURCE_CHANGED')
    const load = () => this.dependencies.materializer(claims).read(candidate, entry)
    const key = createHash('sha256').update(expected).update(JSON.stringify(candidate.source)).digest('hex')
    const bytes = this.dependencies.downloads
      ? await this.dependencies.downloads.read(key, entry.sizeBytes, load) : await load()
    await repository.authorize()
    return bytes
  }

  async metadata(token: string | null, input: DriveMetadataRequest): Promise<DriveMetadataResult> {
    const { claims, repository } = await this.authorize(token)
    const request = driveMetadataBodySchema.parse(input)
    const operation = request.operation
    let commit: DriveMetadataOperation
    if (operation.kind === 'mkdir') {
      if (drivePathSegments(operation.name).length !== 1) throw Error('DRIVE_UNSAFE_PATH')
      commit = operation
    } else {
      const entry = driveMetadataEntrySchema.parse(operation.entry)
      drivePathSegments(entry.path)
      verifyDriveMetadataMac(this.dependencies.secret, claims, entry, operation.metadataMac)
      commit = operation.kind === 'remove' ? { kind: 'remove', fileId: entry.fileId, path: entry.path, updatedAt: entry.updatedAt }
        : { kind: 'move', fileId: entry.fileId, path: entry.path, updatedAt: entry.updatedAt, name: operation.name, ...(operation.parentId ? { parentId: operation.parentId } : {}) }
    }
    // The mutation rechecks authority, edit policy and revision atomically with the receipt.
    return repository.metadata(request.requestId, commit)
  }

  private async authorize(token: string | null) {
    const claims = this.dependencies.verifyToken(token)
    if (!claims) throw Error('DRIVE_UNAUTHORIZED')
    const repository = this.dependencies.repository(claims)
    await repository.authorize()
    return { claims, repository }
  }

  private mac(claims: AgentDriveTokenClaims, entry: ReadyFile): Buffer {
    return createHmac('sha256', this.dependencies.secret).update('overlay-agent-drive-download:v2.').update(driveGrantAuthorityHash(claims)).update(JSON.stringify(entry)).digest()
  }
}
