import 'server-only'

import { createHash } from 'node:crypto'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { headObject } from '@/server/storage/object-store'
import { readBoundedStorageBody } from '@/server/storage/read-bounded-storage-body'
import type { AgentDriveAuthorityClaims } from '@/shared/agents/agent-drive-authority'
import type { AgentDriveSourceReader } from './AgentDriveMaterializer'

type StoredSource = Parameters<AgentDriveSourceReader['size']>[0]
type ConvexSource = Extract<StoredSource, { kind: 'convex' }>
type ConvexStorageMetadata = { url: string; sizeBytes: number; sha256: string }

export class AgentDriveStorageReader implements AgentDriveSourceReader {
  constructor(private readonly dependencies: {
    objectSize(key: string): Promise<number | null>
    readObject(key: string, maximumBytes: number): Promise<Uint8Array>
    convexSource(source: ConvexSource): Promise<ConvexStorageMetadata>
    fetch?: typeof fetch
  }) {}

  async size(source: StoredSource): Promise<number> {
    const size = source.kind === 'object' ? await this.dependencies.objectSize(source.key)
      : (await this.dependencies.convexSource(source)).sizeBytes
    if (size === null) throw Error('DRIVE_FILE_UNAVAILABLE')
    if (!Number.isSafeInteger(size) || size < 0) throw Error('DRIVE_INVALID_SOURCE_SIZE')
    return size
  }

  async read(source: StoredSource, maximumBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw Error('DRIVE_LIMIT_INVALID')
    if (source.kind === 'object') {
      const bytes = await this.dependencies.readObject(source.key, maximumBytes)
      if (bytes.byteLength > maximumBytes) throw Error('DRIVE_FILE_TOO_LARGE')
      return bytes
    }
    // This call repeats run and file authorization; cached metadata cannot keep a revoked grant alive.
    const metadata = await this.dependencies.convexSource(source)
    if (!Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 0) throw Error('DRIVE_INVALID_SOURCE_SIZE')
    if (metadata.sizeBytes > maximumBytes) throw Error('DRIVE_FILE_TOO_LARGE')
    if (new URL(metadata.url).protocol !== 'https:') throw Error('DRIVE_INVALID_STORAGE_URL')
    const response = await (this.dependencies.fetch ?? fetch)(metadata.url, {
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000),
    })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch((_error) => undefined)
      throw Error('DRIVE_FILE_UNAVAILABLE')
    }
    const bytes = await readBoundedStorageBody(response.body, maximumBytes, metadata.sizeBytes)
    if (createHash('sha256').update(bytes).digest('base64') !== metadata.sha256) throw Error('DRIVE_SOURCE_CHANGED')
    return bytes
  }
}

/** Scoped server adapter. Neither storage credentials nor storage URLs become host manifest fields. */
export function createAgentDriveStorageReader(claims: AgentDriveAuthorityClaims): AgentDriveStorageReader {
  return new AgentDriveStorageReader({
    async objectSize(key) { return (await headObject(key))?.sizeBytes ?? null },
    async readObject(key, maximumBytes) {
      const store = getOverlayServerContext().objectStore
      if (!store.downloadBuffer) throw Error('DRIVE_BOUNDED_STORAGE_UNAVAILABLE')
      return store.downloadBuffer(key, maximumBytes)
    },
    async convexSource(source) {
      const metadata = await lazyConvex.query<ConvexStorageMetadata>('agents/agentDrive:storageSourceByServer', {
        actorUserId: claims.actorUserId, agentId: claims.agentId, environmentId: claims.environmentId,
        bindingId: claims.bindingId, runId: claims.runId, sessionId: claims.sessionId, expiresAt: claims.expiresAt,
        scope: claims.scope, ...(claims.execution ? { execution: claims.execution } : {}),
        serverSecret: getInternalApiSecret(), fileId: source.fileId, storageId: source.storageId, updatedAt: source.updatedAt,
      }, { throwOnError: true })
      if (!metadata) throw Error('DRIVE_FILE_UNAVAILABLE')
      return metadata
    },
  })
}
